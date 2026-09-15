// Undo/redo for the document editor.
//
// We can't use the browser's own undo stack. execCommand pushes onto it, but
// the editor also rewrites the DOM by hand — <font size="7"> becomes an fs-*
// span, clearing formatting re-inserts plain paragraphs, a comment wraps text
// in an anchor — and those edits are invisible to it. Mixing the two produces
// exactly the mess it sounds like: undoing a font-size change reverts the text
// move but strands the empty span behind.
//
// So the editor keeps its own history: a list of {html, selection} snapshots
// with a pointer into it. Undo steps the pointer back and restores that whole
// state, which is uniform across typing, toolbar commands, sizes and anchors —
// every one of them is just "the html before" and "the html after".

/** A selection boundary as child indices down from the root, then an offset. */
export interface Path {
	path: number[]
	offset: number
}
export interface SavedSelection {
	start: Path | null
	end: Path | null
}
interface State {
	html: string
	sel: SavedSelection | null
}

// A selection boundary as a path from the root: child indices down the tree,
// then an offset. Indices survive the round trip through innerHTML, where node
// identity does not.
export function pathTo(root: Node, node: Node | null, offset: number): Path | null {
	if (!node || !root.contains(node)) return null
	const path: number[] = []
	let n: Node = node
	while (n !== root) {
		const parent = n.parentNode
		if (!parent) return null
		path.unshift([...parent.childNodes].indexOf(n as ChildNode))
		n = parent
	}
	return { path, offset }
}

export function nodeAt(root: Node, saved: Path | null | undefined): { node: Node; offset: number } | null {
	if (!saved) return null
	let n: Node = root
	for (const i of saved.path) {
		const next = n.childNodes[i]
		if (!next) return { node: n, offset: Math.min(saved.offset, n.childNodes.length) }
		n = next
	}
	const max = n.nodeType === 3 ? (n.nodeValue ?? "").length : n.childNodes.length
	return { node: n, offset: Math.min(saved.offset, max) }
}

export interface HistoryOpts {
	limit?: number
	getSelection?: () => Selection | null
}
export interface History {
	record(): void
	undo(): boolean
	redo(): boolean
	canUndo(): boolean
	canRedo(): boolean
	reset(): void
	size(): number
}

export function createHistory(el: HTMLElement, { limit = 200, getSelection = () => window.getSelection() }: HistoryOpts = {}): History {
	const readSel = (): SavedSelection | null => {
		const sel = getSelection()
		if (!sel || !sel.rangeCount) return null
		const r = sel.getRangeAt(0)
		if (!el.contains(r.commonAncestorContainer)) return null
		return { start: pathTo(el, r.startContainer, r.startOffset), end: pathTo(el, r.endContainer, r.endOffset) }
	}

	let states: State[] = [{ html: el.innerHTML, sel: readSel() }]
	let idx = 0
	let muted = false // true while WE are the ones changing the DOM

	const restore = (state: State) => {
		muted = true
		el.innerHTML = state.html
		const sel = getSelection()
		const a = nodeAt(el, state.sel?.start)
		const b = nodeAt(el, state.sel?.end)
		if (sel && a && b) {
			try {
				const r = document.createRange()
				r.setStart(a.node, a.offset)
				r.setEnd(b.node, b.offset)
				sel.removeAllRanges()
				sel.addRange(r)
			} catch {
				/* the text it pointed at is gone — leave the caret where it lands */
			}
		}
		muted = false
	}

	return {
		// Called after any change. Identical html is not a new state, so holding
		// a key down or re-applying the same format doesn't pad the stack.
		record() {
			if (muted) return
			const html = el.innerHTML
			const cur = states[idx]!
			if (html === cur.html) {
				cur.sel = readSel() // same text, moved caret
				return
			}
			states = states.slice(0, idx + 1)
			states.push({ html, sel: readSel() })
			if (states.length > limit) states.shift()
			idx = states.length - 1
		},
		undo() {
			if (idx <= 0) return false
			// the state we're leaving should come back with the caret as it is now
			const cur = states[idx]!
			cur.sel = readSel() || cur.sel
			idx--
			restore(states[idx]!)
			return true
		},
		redo() {
			if (idx >= states.length - 1) return false
			idx++
			restore(states[idx]!)
			return true
		},
		canUndo: () => idx > 0,
		canRedo: () => idx < states.length - 1,
		// After loading a different document, start over from that text.
		reset() {
			states = [{ html: el.innerHTML, sel: readSel() }]
			idx = 0
		},
		size: () => states.length,
	}
}
