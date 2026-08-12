// The "/" reference palette for the solo editor.
//
// Typing "/" at a word boundary opens a dropdown at the caret listing the
// writers-reference groups (action verbs, dialogue tags, delivery modifiers…).
// Arrow keys move, Enter drills in (groups -> categories -> words), Enter on a
// word inserts it at the cursor, Backspace on an empty filter goes back up,
// Escape closes. Characters typed after the "/" filter the current level.
//
// The state machine is exported separately from the DOM wiring so it can be
// unit-tested under jsdom without a real contenteditable.
import { esc } from "../util.js"

// ---- pure state machine ----
// levels: "groups" -> "categories" -> "words"
export function createPaletteState(bundle) {
	return {
		bundle: bundle && Array.isArray(bundle.groups) ? bundle : { groups: [] },
		level: "groups",
		group: null,
		category: null,
		filter: "",
		index: 0,
	}
}

// The rows visible at the current level, after filtering.
export function visibleItems(st) {
	const f = st.filter.trim().toLowerCase()
	const match = (s) => !f || String(s).toLowerCase().includes(f)
	if (st.level === "groups")
		return st.bundle.groups
			.filter((g) => match(g.label) || match(g.prefix) || match(g.desc))
			.map((g) => ({ kind: "group", key: g.slug, label: g.label, hint: g.prefix, ref: g }))
	if (st.level === "categories")
		return (st.group?.categories || [])
			.filter((c) => match(c.label))
			.map((c) => ({ kind: "category", key: c.key, label: c.label, hint: `${c.words.length}`, ref: c }))
	return (st.category?.words || [])
		.filter(match)
		.map((w) => ({ kind: "word", key: w, label: w, hint: "", ref: w }))
}

export const clampIndex = (st) => {
	const n = visibleItems(st).length
	st.index = n === 0 ? 0 : Math.max(0, Math.min(st.index, n - 1))
	return st
}

export function move(st, delta) {
	const n = visibleItems(st).length
	if (!n) return st
	st.index = (st.index + delta + n) % n // wraps, like a native menu
	return st
}

// Enter. Returns {inserted: word} when a word was chosen, else null.
export function choose(st) {
	const item = visibleItems(st)[st.index]
	if (!item) return null
	if (item.kind === "group") {
		st.group = item.ref
		st.level = "categories"
		st.filter = ""
		st.index = 0
		return null
	}
	if (item.kind === "category") {
		st.category = item.ref
		st.level = "words"
		st.filter = ""
		st.index = 0
		return null
	}
	return { inserted: item.ref }
}

// Backspace on an empty filter, or the Back row.
export function goBack(st) {
	if (st.level === "words") {
		st.level = "categories"
		st.category = null
	} else if (st.level === "categories") {
		st.level = "groups"
		st.group = null
	} else {
		return false // already at the top — caller should close
	}
	st.filter = ""
	st.index = 0
	return true
}

export function setFilter(st, text) {
	st.filter = text
	st.index = 0
	return st
}

// A "/" only opens the palette when it starts a word — i.e. at the very start
// of a block or straight after whitespace. Without this, ordinary prose sets
// it off: "and/or", "24/7", "https://ao3.org", or a hand-typed "</p>" would
// each pop the menu mid-sentence. Called on keydown, BEFORE the "/" lands, so
// the character we inspect is the one the slash is about to follow.
export function opensPalette(node, offset) {
	if (!node) return false
	if (node.nodeType !== 3) return true // element boundary — nothing typed yet
	if (offset <= 0) return true // start of a text node
	return /\s| /.test(node.nodeValue.charAt(offset - 1))
}

export const breadcrumb = (st) =>
	st.level === "groups" ? "Reference" : st.level === "categories" ? st.group.label : `${st.group.label} › ${st.category.label}`

export function paletteHtml(st) {
	const items = visibleItems(st)
	const rows = items.length
		? items
				.map(
					(it, i) =>
						`<li class="sp-row${i === st.index ? " sel" : ""}" data-i="${i}" role="option" aria-selected="${i === st.index}">` +
						`<span class="sp-label">${esc(it.label)}</span>` +
						(it.hint ? `<span class="sp-hint">${esc(it.hint)}</span>` : "") +
						`</li>`,
				)
				.join("")
		: `<li class="sp-empty">No matches</li>`
	return (
		`<div class="sp-head"><span class="sp-crumb">${esc(breadcrumb(st))}</span>` +
		`<span class="sp-keys">↑↓ move · ${st.level === "groups" ? "→ open" : "← back"} · ⏎ pick · esc</span></div>` +
		`<ul class="sp-list" role="listbox">${rows}</ul>`
	)
}

// ---- DOM wiring ----
// mountSlashPalette(editor, {getBundle, onInsert}) returns {destroy, isOpen}.
// The editor keeps ownership of its own keydown handling for everything else;
// we only intercept while the palette is open.
// isEnabled lets the host switch the palette off entirely (the solo editor
// disables it in HTML source mode, where "/" is markup, not a command).
export function mountSlashPalette(editor, { bundle, onInsert = () => {}, isEnabled = () => true } = {}) {
	const el = document.createElement("div")
	el.className = "slash-palette hidden"
	el.setAttribute("role", "dialog")
	document.body.appendChild(el)

	let st = createPaletteState(bundle)
	let open = false
	let anchor = null // Range marking the "/" we typed

	const render = () => {
		el.innerHTML = paletteHtml(st)
		el.querySelectorAll(".sp-row").forEach((row) => {
			row.addEventListener("mousedown", (e) => {
				e.preventDefault() // keep the caret in the editor
				st.index = Number(row.dataset.i)
				commit()
			})
		})
	}

	const place = () => {
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return
		const r = sel.getRangeAt(0).cloneRange()
		const rect = r.getBoundingClientRect()
		const top = (rect.bottom || 0) + window.scrollY + 6
		const left = (rect.left || 0) + window.scrollX
		el.style.top = top + "px"
		// keep it on screen
		el.style.left = Math.min(left, window.innerWidth - 300) + "px"
	}

	function openAt() {
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return
		anchor = sel.getRangeAt(0).cloneRange()
		st = createPaletteState(bundle)
		open = true
		el.classList.remove("hidden")
		render()
		place()
	}

	function close() {
		open = false
		anchor = null
		el.classList.add("hidden")
	}

	// Replace the typed "/filter" with the chosen word.
	function insertWord(word) {
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount || !anchor) return
		const r = sel.getRangeAt(0)
		// walk back over the "/" + whatever was typed after it
		const node = anchor.startContainer
		if (node.nodeType === 3) {
			const start = Math.max(0, anchor.startOffset - 1) // the "/" itself
			const end = r.startContainer === node ? r.startOffset : node.nodeValue.length
			const del = document.createRange()
			del.setStart(node, start)
			del.setEnd(node, Math.max(start, end))
			del.deleteContents()
			const t = document.createTextNode(word)
			del.insertNode(t)
			const after = document.createRange()
			after.setStartAfter(t)
			after.collapse(true)
			sel.removeAllRanges()
			sel.addRange(after)
		}
		onInsert(word)
	}

	function commit() {
		const res = choose(st)
		if (res && res.inserted) {
			insertWord(res.inserted)
			close()
		} else {
			render()
			place()
		}
	}

	const onKeyDown = (e) => {
		if (!open) {
			if (e.key !== "/" || !isEnabled()) return
			const sel = window.getSelection()
			if (!sel || !sel.rangeCount) return
			const r = sel.getRangeAt(0)
			// only a word-initial "/" is a command; mid-word slashes are prose
			if (!opensPalette(r.startContainer, r.startOffset)) return
			setTimeout(openAt, 0) // let the "/" land first
			return
		}
		if (e.key === "ArrowDown") {
			e.preventDefault()
			move(st, 1)
			render()
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			move(st, -1)
			render()
		} else if (e.key === "ArrowRight") {
			// mirror of ArrowLeft: step INTO the highlighted group/category
			// (on a word there is nowhere further to go, so leave it be)
			if (st.level !== "words") {
				e.preventDefault()
				commit()
			}
		} else if (e.key === "ArrowLeft") {
			// step back up a level. Unlike Backspace this never closes the
			// palette — at the top level there is simply nowhere left to go.
			e.preventDefault()
			if (goBack(st)) render()
		} else if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault()
			commit()
		} else if (e.key === "Escape") {
			e.preventDefault()
			close()
		} else if (e.key === "Backspace" && st.filter === "") {
			// step back a level instead of deleting the "/"
			if (goBack(st)) {
				e.preventDefault()
				render()
			} else {
				close()
			}
		} else if (e.key === " ") {
			close() // a space means they were writing, not searching
		}
	}

	// Track what's been typed after the "/" as the filter.
	const onInput = () => {
		if (!open || !anchor) return
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return close()
		const node = anchor.startContainer
		if (node.nodeType !== 3 || sel.getRangeAt(0).startContainer !== node) return close()
		const typed = node.nodeValue.slice(anchor.startOffset, sel.getRangeAt(0).startOffset)
		if (!typed && sel.getRangeAt(0).startOffset < anchor.startOffset) return close()
		setFilter(st, typed)
		render()
	}

	const onBlur = () => setTimeout(() => open && close(), 120)

	editor.addEventListener("keydown", onKeyDown)
	editor.addEventListener("input", onInput)
	editor.addEventListener("blur", onBlur)

	return {
		isOpen: () => open,
		close,
		setBundle: (b) => (bundle = b),
		destroy() {
			editor.removeEventListener("keydown", onKeyDown)
			editor.removeEventListener("input", onInput)
			editor.removeEventListener("blur", onBlur)
			el.remove()
		},
	}
}
