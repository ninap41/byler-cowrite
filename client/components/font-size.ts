// Font-size surgery for the document editor.
//
// The toolbar's size box drives `document.execCommand("fontSize", …)`, which
// only speaks the legacy 1–7 scale and emits <font size="7"> tags. Everything
// here turns that output into our closed class ladder (fs-<px>) and keeps the
// nesting honest. These are pure DOM helpers on purpose: the editor page owns
// focus, selection and persistence, and this file is what the tests can drive.
import { FONT_SIZES } from "./editor.js"

export const DEFAULT_SIZE = 16 // the editor's own size, for text wearing no fs-* span

const FS_RE = /^fs-(\d+)$/
export const isSizeEl = (el: Element | null | undefined): boolean => FS_RE.test((el as HTMLElement | null)?.className || "")
const sizeOfClass = (el: Element): number | null => {
	const m = FS_RE.exec((el as HTMLElement).className || "")
	return m ? Number(m[1]) : null
}

// What the size box actually contains. People type "24px", "24 pt", "Multi",
// or paste a whole declaration — so pull the digits out and use those rather
// than letting Number() return NaN and collapsing to the smallest rung. Null
// means there was no number in there at all, and the caller keeps the size
// the selection already has.
export function parseSize(raw: unknown): number | null {
	const digits = String(raw ?? "")
		.replace(/[^\d.]/g, "")
		.replace(/\.(?=.*\.)/g, "")
	const n = parseFloat(digits)
	return Number.isFinite(n) && n > 0 ? n : null
}

// The ladder is closed, so an arbitrary number lands on its nearest rung.
export const nearestSize = (px: number): number => FONT_SIZES.reduce<number>((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best), FONT_SIZES[0])

// The size governing a node: the nearest fs-* ancestor below `root`, else the
// editor's base size.
export function sizeOf(node: Node | null | undefined, root: Node): number {
	let n: Element | null = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null)
	while (n && n !== root) {
		const s = sizeOfClass(n)
		if (s !== null) return s
		n = n.parentElement
	}
	return DEFAULT_SIZE
}

// execCommand nests the new size INSIDE the old one, so pressing + three times
// leaves fs-20 > fs-24 > fs-28 around the same words. A size span that no
// longer governs any text — every character under it sits in a nearer size
// span — has been overridden and is just cruft. This is also why the rule is
// "governs no text" rather than "has a size inside it": an fs span still
// covering words of its own must survive.
export function pruneRedundantSizes(root: Element): void {
	root.querySelectorAll<HTMLElement>("span[class]").forEach((sp) => {
		if (!isSizeEl(sp)) return
		const walker = root.ownerDocument.createTreeWalker(sp, 4 /* SHOW_TEXT */)
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (!(n.nodeValue ?? "").trim()) continue
			let a: Element | null = n.parentElement
			while (a && a !== sp && !isSizeEl(a)) a = a.parentElement
			if (a === sp) return // it still owns this text — keep it
		}
		sp.replaceWith(...sp.childNodes)
	})
}

// Rewrite every <font size="7"> execCommand just produced into an fs-<size>
// span, and return the spans in document order so the caller can re-select
// them. A mixed selection keeps its old sizes NESTED INSIDE the new span, and
// the nearest ancestor wins — so without stripping them the resize silently
// does nothing to the already-sized words. The typed size is explicit intent:
// it overwrites all of them.
export function absorbFontTags(root: Element, px: number): HTMLSpanElement[] {
	const size = nearestSize(px)
	const made: HTMLSpanElement[] = []
	root.querySelectorAll('font[size="7"]').forEach((f) => {
		const span = root.ownerDocument.createElement("span")
		span.className = "fs-" + size
		while (f.firstChild) span.appendChild(f.firstChild)
		f.replaceWith(span)
		span.querySelectorAll("span[class]").forEach((inner) => {
			if (isSizeEl(inner)) inner.replaceWith(...inner.childNodes)
		})
		made.push(span)
	})
	pruneRedundantSizes(root)
	return made
}

// Blocks whose own type IS a size statement. An explicit fs-* span inside one
// of them wins on nearest-ancestor, so a paragraph carrying a 12px span turns
// into a Heading 1 that renders at 12px — the format appears not to work.
const SIZED_BLOCKS = ["h1", "h2", "h3", "p", "blockquote", "li"]

// Drop the explicit sizes inside every block the range touches. Called when a
// block format is applied: choosing Heading 2 is choosing a size, so the
// per-word overrides in that block have been superseded.
export function clearSizesInBlocks(root: Element | null | undefined, range: Range | null | undefined): number {
	if (!root || !range) return 0
	let cleared = 0
	for (const block of root.querySelectorAll(SIZED_BLOCKS.join(","))) {
		let touches = false
		try {
			touches = range.intersectsNode(block)
		} catch {
			touches = false
		}
		if (!touches) continue
		block.querySelectorAll("span[class]").forEach((sp) => {
			if (!isSizeEl(sp)) return
			sp.replaceWith(...sp.childNodes)
			cleared++
		})
		if (cleared) block.normalize()
	}
	return cleared
}

const isHeading = (el: Element): boolean => /^h[123]$/i.test(el.nodeName)

// Is everything the range touches inside a heading? A heading owns its own
// size (the css makes it win), so the size box has nothing to say there — and
// a control that silently does nothing is worse than one that's plainly off.
export function headingOnly(root: Element | null | undefined, range: Range | null | undefined): boolean {
	if (!root || !range) return false
	const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */)
	let sawText = false
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (!(n.nodeValue ?? "").trim()) continue
		let touches = false
		try {
			touches = range.intersectsNode(n)
		} catch {
			touches = false
		}
		if (!touches) continue
		sawText = true
		let el: Element | null = n.parentElement
		let inHeading = false
		while (el && el !== root) {
			if (isHeading(el)) {
				inHeading = true
				break
			}
			el = el.parentElement
		}
		if (!inHeading) return false
	}
	if (sawText) return true
	// a caret in an empty heading counts too
	const node: Node | null = range.startContainer
	let el: Element | null = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null)
	while (el && el !== root) {
		if (isHeading(el)) return true
		el = el.parentElement
	}
	return false
}

// Every size present in a range: a caret reports the one size it sits in; a
// selection spanning 18px and 36px reports both, which is how the size box
// knows to say "Multi" instead of lying with a number.
export function sizesInRange(root: Element, range: Range | null | undefined): number[] {
	if (!range || !root.contains(range.commonAncestorContainer)) return []
	if (range.collapsed) return [sizeOf(range.startContainer, root)]
	const found = new Set<number>()
	const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */)
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (!(n.nodeValue ?? "").trim()) continue
		if (range.intersectsNode(n)) found.add(sizeOf(n, root))
	}
	return [...found]
}
