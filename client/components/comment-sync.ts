// Pure helpers for keeping the solo editor's comment anchors in step with the
// server — no page state, so test/client-comment-sync.test.mjs can pin them.
// Everything works on strings except placeAnchor, which is handed its root.
//
// An anchor is <span class="cmt" data-cid="…">the words</span> (12 hex chars,
// CID_RE in src/sanitize.js). The editor's rich DOM prunes dead anchors itself
// (pruneLocalAnchors in pages/write.ts); the HTML view is a textarea of raw
// source that nothing re-renders, so the same removals have to be done on the
// text — that is what the *InSource helpers are for.

const CID_ATTR = /data-cid="([0-9a-f]{12})"/g

/** Every anchor id in a piece of html, in document order. */
export function anchorCids(html: string): string[] {
	const out: string[] = []
	for (const m of String(html || "").matchAll(CID_ATTR)) if (!out.includes(m[1])) out.push(m[1])
	return out
}

// The span for one cid and where it ends, nesting-aware: an anchor may hold
// other spans (font sizes, another anchor) so a non-greedy </span> won't do.
function findAnchor(src: string, cid: string): { open: [number, number]; close: [number, number] } | null {
	const openRe = new RegExp(`<span\\b[^>]*\\bdata-cid="${cid}"[^>]*>`)
	const m = openRe.exec(src)
	if (!m) return null
	const start = m.index
	let depth = 1
	const tagRe = /<\/?span\b[^>]*>/g
	tagRe.lastIndex = start + m[0].length
	for (let t = tagRe.exec(src); t; t = tagRe.exec(src)) {
		depth += t[0].startsWith("</") ? -1 : 1
		if (depth === 0) return { open: [start, start + m[0].length], close: [t.index, t.index + t[0].length] }
	}
	return null // unbalanced: leave it alone rather than guess
}

/** Unwrap one anchor in raw source: the words stay, the span goes. No-op when absent or unbalanced. */
export function stripAnchorInSource(src: string, cid: string): string {
	const a = findAnchor(src, cid)
	if (!a) return src
	return src.slice(0, a.open[0]) + src.slice(a.open[1], a.close[0]) + src.slice(a.close[1])
}

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Replace one anchor's words with a suggestion (plain text, escaped) in raw source. No-op when absent. */
export function applySuggestionInSource(src: string, cid: string, text: string): string {
	const a = findAnchor(src, cid)
	if (!a) return src
	return src.slice(0, a.open[0]) + escText(String(text ?? "")) + src.slice(a.close[1])
}

/** Every anchor in `src` whose comment is gone, unwrapped. */
export function pruneSource(src: string, liveCids: Iterable<string>): string {
	const live = new Set(liveCids)
	let out = src
	for (const cid of anchorCids(src)) if (!live.has(cid)) out = stripAnchorInSource(out, cid)
	return out
}

// ---- putting an arriving underline into an editor that has unsaved typing ----
// A beta reader's comment reaches the author as a comment row plus the server's
// html for that chapter. An author who has typed since their last save can't
// take that html (it would cost them their words), so their editor underlines
// the commented words ITSELF, found by where they sat in the chapter's text.

export interface AnchorPos { start: number; text: string; before: string; after: string }

const BLOCK_TAGS = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|HR|TABLE|TR|TD)$/

const textNodes = (root: Node): Text[] => {
	const out: Text[] = []
	const walk = (n: Node) => {
		for (const c of Array.from(n.childNodes)) {
			if (c.nodeType === 3) out.push(c as Text)
			else walk(c)
		}
	}
	walk(root)
	return out
}

const sharedSuffix = (a: string, b: string) => {
	let n = 0
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
	return n
}
const sharedPrefix = (a: string, b: string) => {
	let n = 0
	while (n < a.length && n < b.length && a[n] === b[n]) n++
	return n
}

/**
 * Where `pos.text` sits in `full` now: the recorded offset when the words are
 * still there, else the occurrence whose neighbourhood looks most like the one
 * recorded (nearest the old offset on a tie). -1 when the words are gone.
 */
export function locateText(full: string, pos: AnchorPos): number {
	const text = pos.text
	if (!text) return -1
	if (full.startsWith(text, pos.start)) return pos.start
	let best = -1, bestScore = -1
	for (let i = full.indexOf(text); i >= 0; i = full.indexOf(text, i + 1)) {
		const score = sharedSuffix(full.slice(0, i), pos.before) + sharedPrefix(full.slice(i + text.length), pos.after)
		if (score > bestScore || (score === bestScore && Math.abs(i - pos.start) < Math.abs(best - pos.start))) {
			best = i
			bestScore = score
		}
	}
	return best
}

const blockOf = (n: Node, root: Node): Node => {
	for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (BLOCK_TAGS.test(p.nodeName)) return p
	return root
}

/**
 * Wrap the commented words under `root` in their anchor span. True when the
 * anchor is there afterwards (already, or just placed); false when the words
 * can't be found or span two blocks — the card then reads as it always has
 * for a comment whose words are gone. The caret stays where it was.
 */
export function placeAnchor(root: Element, cid: string, pos: AnchorPos): boolean {
	if (!/^[0-9a-f]{12}$/.test(cid)) return false
	if (root.querySelector(`span.cmt[data-cid="${cid}"]`)) return true
	const nodes = textNodes(root)
	const at = locateText(nodes.map((n) => n.data).join(""), pos)
	if (at < 0) return false
	const end = at + pos.text.length
	let startNode: Text | null = null, startOff = 0, endNode: Text | null = null, endOff = 0
	let seen = 0
	for (const n of nodes) {
		const len = n.data.length
		if (!startNode && at < seen + len) { startNode = n; startOff = at - seen }
		if (startNode && end <= seen + len) { endNode = n; endOff = end - seen; break }
		seen += len
	}
	if (!startNode || !endNode) return false
	if (blockOf(startNode, root) !== blockOf(endNode, root)) return false // an anchor never wraps a block

	const d = root.ownerDocument
	// the caret, as text offsets, so splitting a text node under it can't move it
	const sel = d.getSelection?.() ?? null
	const caret = sel && sel.rangeCount && root.contains(sel.anchorNode) && sel.isCollapsed && sel.anchorNode?.nodeType === 3
		? nodes.slice(0, nodes.indexOf(sel.anchorNode as Text)).reduce((n, t) => n + t.data.length, 0) + sel.anchorOffset
		: -1

	const range = d.createRange()
	range.setStart(startNode, startOff)
	range.setEnd(endNode, endOff)
	const span = d.createElement("span")
	span.className = "cmt"
	span.dataset.cid = cid
	try {
		range.surroundContents(span)
	} catch {
		// the words cross an inline boundary (half of an <i>): lift them out whole
		span.appendChild(range.extractContents())
		range.insertNode(span)
	}

	if (caret >= 0 && sel) {
		let left = caret
		for (const n of textNodes(root)) {
			if (left <= n.data.length) { sel.collapse(n, left); break }
			left -= n.data.length
		}
	}
	return true
}
