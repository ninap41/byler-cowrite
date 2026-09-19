// Find & replace for the solo editor. The matching is pure (strings in, ranges
// out) so it is pinned directly; the DOM half works on TEXT NODES ONLY — a
// replacement edits the characters and never the markup around them, so bold,
// size spans and comment anchors (`span.cmt`) all survive a replace.
//
// Scope is the open chapter: the editor's DOM holds one chapter at a time.
// A match never spans two blocks (a paragraph break reads as "\n", which a
// one-line query can't contain).

export interface FindOpts {
	caseSensitive?: boolean
	wholeWord?: boolean
}
export interface Match {
	start: number
	end: number
}

const WORD = /[\p{L}\p{N}_]/u
const isWordChar = (c: string | undefined) => !!c && WORD.test(c)

export function findMatches(text: string, query: string, opts: FindOpts = {}): Match[] {
	if (!query) return []
	const hay = opts.caseSensitive ? text : text.toLowerCase()
	const needle = opts.caseSensitive ? query : query.toLowerCase()
	// a case fold that changes a string's length would misplace every range
	if (hay.length !== text.length || needle.length !== query.length) return findMatches(text, query, { ...opts, caseSensitive: true })
	const out: Match[] = []
	for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
		const end = at + needle.length
		if (opts.wholeWord && (isWordChar(text[at - 1]) || isWordChar(text[end]))) continue
		out.push({ start: at, end })
	}
	return out
}

// Replace in a plain string (the HTML view). Last to first, so earlier ranges
// stay true while later ones are rewritten.
export function replaceInText(text: string, matches: Match[], replacement: string): string {
	let out = text
	for (const m of [...matches].sort((a, b) => b.start - a.start)) out = out.slice(0, m.start) + replacement + out.slice(m.end)
	return out
}

// ---- the DOM half ----
const BLOCKS = new Set(["P", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "DIV", "UL", "OL"])
const blockOf = (node: Node, root: Node): Node => {
	for (let n: Node | null = node.parentNode; n && n !== root; n = n.parentNode) if (BLOCKS.has(n.nodeName)) return n
	return root
}

export interface TextIndex {
	text: string
	nodes: { node: Text; start: number; end: number }[]
}
// The editor's words as one string, with where each text node sits in it.
export function textIndex(root: Node): TextIndex {
	const doc = root.ownerDocument as Document
	const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
	const nodes: TextIndex["nodes"] = []
	let text = ""
	let lastBlock: Node | null = null
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const block = blockOf(n, root)
		if (lastBlock && block !== lastBlock) text += "\n"
		lastBlock = block
		const value = (n as Text).data
		nodes.push({ node: n as Text, start: text.length, end: text.length + value.length })
		text += value
	}
	return { text, nodes }
}

const locate = (index: TextIndex, at: number, preferEnd: boolean) => {
	for (const n of index.nodes) {
		if (preferEnd ? at > n.start && at <= n.end : at >= n.start && at < n.end) return { node: n.node, offset: at - n.start }
	}
	const last = index.nodes[index.nodes.length - 1]
	return last ? { node: last.node, offset: last.node.data.length } : null
}

export function rangeFor(index: TextIndex, m: Match): Range | null {
	const a = locate(index, m.start, false)
	const b = locate(index, m.end, true)
	if (!a || !b) return null
	const range = (a.node.ownerDocument as Document).createRange()
	range.setStart(a.node, a.offset)
	range.setEnd(b.node, b.offset)
	return range
}

// Rewrite the matched characters in place. A match inside one text node is a
// splice; one that crosses nodes ("Clo<b>sed</b>") puts the replacement where
// the match began and takes the rest of it out of the nodes that follow.
export function replaceInDom(root: Node, matches: Match[], replacement: string): number {
	const index = textIndex(root)
	let done = 0
	for (const m of [...matches].sort((a, b) => b.start - a.start)) {
		let first = true
		let hit = false
		for (const n of index.nodes) {
			const from = Math.max(m.start, n.start)
			const to = Math.min(m.end, n.end)
			if (from >= to) continue
			const data = n.node.data
			n.node.data = data.slice(0, from - n.start) + (first ? replacement : "") + data.slice(to - n.start)
			first = false
			hit = true
		}
		if (hit) done++
	}
	return done
}

// ---- the bar ----
export const findBarHtml = (): string => `
	<div class="find-row">
		<input class="find-input" id="findInput" type="search" placeholder="Find" aria-label="Find" autocomplete="off" spellcheck="false" />
		<span class="find-count" id="findCount" aria-live="polite"></span>
		<button class="find-btn" id="findPrev" type="button" aria-label="Previous match" data-tip="Previous (Shift+Enter)">↑</button>
		<button class="find-btn" id="findNext" type="button" aria-label="Next match" data-tip="Next (Enter)">↓</button>
		<label class="find-opt" data-tip="Match case"><input type="checkbox" id="findCase" /> Aa</label>
		<label class="find-opt" data-tip="Whole word"><input type="checkbox" id="findWord" /> Word</label>
	</div>
	<div class="find-row find-replace-row" id="findReplaceRow">
		<input class="find-input" id="replaceInput" type="text" placeholder="Replace with" aria-label="Replace with" autocomplete="off" spellcheck="false" />
		<button class="find-btn find-word" id="replaceOne" type="button">Replace</button>
		<button class="find-btn find-word" id="replaceAll" type="button">Replace all</button>
	</div>
	<button class="find-btn find-close" id="findClose" type="button" aria-label="Close find">✕</button>`

export interface FindReplaceOpts {
	editor: HTMLElement
	source: HTMLTextAreaElement
	bar: HTMLElement
	isSource: () => boolean
	canReplace: () => boolean
	onEdit: () => void
	reveal?: (range: Range) => void
}
export interface FindReplaceApi {
	open: () => void
	close: () => void
	isOpen: () => boolean
	refresh: () => void
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void }
const registry = (): { reg: HighlightRegistry; Ctor: new (...r: Range[]) => unknown } | null => {
	const g = globalThis as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...r: Range[]) => unknown }
	return g.CSS?.highlights && g.Highlight ? { reg: g.CSS.highlights, Ctor: g.Highlight } : null
}

export function mountFindReplace(o: FindReplaceOpts): FindReplaceApi {
	const { editor, source, bar } = o
	bar.innerHTML = findBarHtml()
	const q = <T extends HTMLElement>(id: string) => bar.querySelector("#" + id) as T
	const input = q<HTMLInputElement>("findInput")
	const replaceInput = q<HTMLInputElement>("replaceInput")
	const count = q("findCount")
	let matches: Match[] = []
	let current = -1
	let index: TextIndex | null = null

	const opts = (): FindOpts => ({ caseSensitive: q<HTMLInputElement>("findCase").checked, wholeWord: q<HTMLInputElement>("findWord").checked })
	const clearMarks = () => {
		const h = registry()
		h?.reg.delete("find-all")
		h?.reg.delete("find-current")
	}
	const paint = () => {
		count.textContent = !input.value ? "" : matches.length ? `${current + 1} of ${matches.length}` : "No matches"
		bar.classList.toggle("find-none", !!input.value && !matches.length)
		clearMarks()
		if (o.isSource() || !index) return
		const h = registry()
		if (!h) return
		const ranges = matches.map((m) => rangeFor(index as TextIndex, m)).filter((r): r is Range => !!r)
		if (ranges.length) h.reg.set("find-all", new h.Ctor(...ranges))
		if (ranges[current]) h.reg.set("find-current", new h.Ctor(ranges[current]))
	}
	const show = () => {
		const m = matches[current]
		if (!m) return
		if (o.isSource()) {
			source.setSelectionRange(m.start, m.end)
			// an unfocused textarea doesn't scroll to its selection: aim by line
			const line = source.value.slice(0, m.start).split("\n").length - 1
			const lines = source.value.split("\n").length
			source.scrollTop = Math.max(0, (line / Math.max(1, lines)) * source.scrollHeight - source.clientHeight / 2)
		} else if (index) {
			const range = rangeFor(index, m)
			if (range) o.reveal?.(range)
		}
	}
	// Search again, keeping the place: the current match stays the one at or
	// after where it was, so a replace moves on to the NEXT hit.
	const search = (keepAt = 0) => {
		if (o.isSource()) {
			index = null
			matches = findMatches(source.value, input.value, opts())
		} else {
			index = textIndex(editor)
			matches = findMatches(index.text, input.value, opts())
		}
		current = matches.length ? Math.max(0, matches.findIndex((m) => m.start >= keepAt)) : -1
		paint()
	}
	const step = (dir: number) => {
		if (!matches.length) return
		current = (current + dir + matches.length) % matches.length
		paint()
		show()
	}
	const apply = (which: Match[]) => {
		if (!o.canReplace() || !which.length) return 0
		let n: number
		if (o.isSource()) {
			source.value = replaceInText(source.value, which, replaceInput.value)
			n = which.length
		} else n = replaceInDom(editor, which, replaceInput.value)
		if (n) o.onEdit()
		return n
	}

	input.addEventListener("input", () => {
		search()
		show()
	})
	for (const id of ["findCase", "findWord"]) q(id).addEventListener("change", () => (search(), show()))
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault()
			if (e.target === replaceInput) q("replaceOne").click()
			else step(e.shiftKey ? -1 : 1)
		} else if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			api.close()
		}
	}
	input.addEventListener("keydown", onKey)
	replaceInput.addEventListener("keydown", onKey)
	q("findNext").addEventListener("click", () => step(1))
	q("findPrev").addEventListener("click", () => step(-1))
	q("findClose").addEventListener("click", () => api.close())
	q("replaceOne").addEventListener("click", () => {
		const m = matches[current]
		if (!m) return
		if (!apply([m])) return
		search(m.start + replaceInput.value.length)
		show()
	})
	q("replaceAll").addEventListener("click", () => {
		const n = apply(matches)
		search()
		if (n) count.textContent = `Replaced ${n}`
	})

	const api: FindReplaceApi = {
		open() {
			bar.classList.remove("hidden")
			q("findReplaceRow").classList.toggle("hidden", !o.canReplace())
			const picked = o.isSource() ? source.value.slice(source.selectionStart, source.selectionEnd) : String(editor.ownerDocument.getSelection() || "")
			if (picked && !picked.includes("\n") && picked.length <= 80) input.value = picked
			input.focus()
			input.select()
			search()
		},
		close() {
			bar.classList.add("hidden")
			matches = []
			current = -1
			clearMarks()
		},
		isOpen: () => !bar.classList.contains("hidden"),
		// the words changed under the bar (typing, a chapter or mode switch)
		refresh() {
			if (api.isOpen()) search(matches[current]?.start ?? 0)
		},
	}
	return api
}
