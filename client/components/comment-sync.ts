// Pure helpers for keeping the solo editor's comment anchors in step with the
// server — no DOM, so test/client-comment-sync.test.mjs can pin them.
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

export type PushKind = "added" | "removed" | "same"

/**
 * What a `doc-html` push means for an editor that already holds `editorHtml`:
 * a new anchor (someone commented — "save to see it underlined"), fewer
 * anchors (a comment was deleted, resolved or decided — nothing to tell the
 * author, the prune handles it), or the same set (words changed, an accepted
 * suggestion). "added" wins when a push both adds and removes.
 */
export function htmlPushKind(editorHtml: string, pushedHtml: string): PushKind {
	const had = new Set(anchorCids(editorHtml))
	const now = anchorCids(pushedHtml)
	if (now.some((c) => !had.has(c))) return "added"
	return now.length < had.size ? "removed" : "same"
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
