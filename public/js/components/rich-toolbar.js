// The WYSIWYG toolbar, as one mountable control.
//
// The solo editor grew this row first; the game needs the SAME one, and two
// hand-maintained copies would drift within a week. So the markup and the
// wiring live here, and both pages mount it. Everything it can produce is
// inside sanitizeRich's allowlist — no links, no images: a story line is
// shaped text and never carries a url.
import { absorbFontTags, sizesInRange, nearestSize, parseSize, clearSizesInBlocks, headingOnly, DEFAULT_SIZE } from "./font-size.js"
import { FONT_SIZES } from "./editor.js"
import { createHistory } from "./history.js"

// The button/glyph set, in toolbar order. Kept as data so the drift test can
// compare a page's markup against it.
export const TOOLBAR_CONTROLS = [
	"undo", "redo",
	"blockFormat",
	"bold", "italic", "underline", "strikeThrough",
	"fontSize",
	"list", "align",
	"emDash", "insertHorizontalRule", "clearFormatting",
]

export function toolbarHtml(idPrefix = "") {
	const id = (n) => `${idPrefix}${n}`
	return (
		`<span class="tb-group">` +
		`<button class="ghost" id="${id("undoBtn")}" title="Undo (Ctrl/⌘+Z)" type="button">↺</button>` +
		`<button class="ghost" id="${id("redoBtn")}" title="Redo (Ctrl/⌘+Shift+Z)" type="button">↻</button>` +
		`</span>` +
		`<span class="tb-group">` +
		`<select id="${id("blockFormat")}" class="ghost" title="Paragraph style">` +
		`<option value="p">Paragraph</option><option value="h1">Heading 1</option>` +
		`<option value="h2">Heading 2</option><option value="h3">Heading 3</option>` +
		`<option value="blockquote">Quote</option></select>` +
		`</span>` +
		`<span class="tb-group">` +
		`<button class="ghost tb-b" data-cmd="bold" title="Bold" type="button">B</button>` +
		`<button class="ghost tb-i" data-cmd="italic" title="Italic" type="button">I</button>` +
		`<button class="ghost tb-u" data-cmd="underline" title="Underline" type="button">U</button>` +
		`<button class="ghost tb-s" data-cmd="strikeThrough" title="Strikethrough" type="button">S</button>` +
		`</span>` +
		`<span class="tb-group">` +
		`<span class="stepper" id="${id("fontStepper")}" title="Font size of the selected text">` +
		`<button class="step-btn" id="${id("fsDown")}" type="button" aria-label="Smaller text">−</button>` +
		`<input id="${id("fsInput")}" class="step-input" inputmode="numeric" aria-label="Font size in pixels" value="16" />` +
		`<button class="step-btn" id="${id("fsUp")}" type="button" aria-label="Larger text">+</button>` +
		`</span></span>` +
		`<span class="tb-group">` +
		`<select id="${id("listSelect")}" class="ghost align-select" title="List style">` +
		`<option value="none" title="No list">☰</option>` +
		`<option value="insertUnorderedList" title="Bulleted">•</option>` +
		`<option value="insertOrderedList" title="Numbered">1.</option></select>` +
		`<select id="${id("alignSelect")}" class="ghost align-select" title="Alignment">` +
		`<option value="justifyLeft" title="Left">⇤</option>` +
		`<option value="justifyCenter" title="Center">↔</option>` +
		`<option value="justifyRight" title="Right">⇥</option></select>` +
		`</span>` +
		`<span class="tb-group">` +
		`<button class="ghost" id="${id("emDashBtn")}" title="Insert em dash" type="button">—</button>` +
		`<button class="ghost" data-cmd="insertHorizontalRule" title="Horizontal rule" type="button">HR</button>` +
		`<button class="ghost" id="${id("clearFmtBtn")}" title="Clear formatting" type="button">Tx</button>` +
		`</span>`
	)
}

// mountRichToolbar(editor, toolbar, {onEdit, idPrefix})
// onEdit fires after anything that changes the html, so the host can save,
// broadcast typing, or recount words. Returns {sync, history, destroy}.
export function mountRichToolbar(editor, toolbar, { onEdit = () => {}, idPrefix = "" } = {}) {
	const $ = (n) => document.getElementById(idPrefix + n)
	const history = createHistory(editor)
	// Every toolbar command is one undo step; typing folds into one while it
	// keeps flowing (the same rule the solo editor uses).
	const edited = () => {
		history.record()
		onEdit()
	}
	let typingTimer = null
	const onInput = () => {
		clearTimeout(typingTimer)
		typingTimer = setTimeout(() => history.record(), 400)
	}
	editor.addEventListener("input", onInput)

	// mousedown + preventDefault everywhere: the selection must survive the
	// press, or a button would format nothing.
	const press = (el, fn) =>
		el?.addEventListener("mousedown", (e) => {
			e.preventDefault()
			fn()
		})

	const exec = (cmd, val = null) => {
		editor.focus()
		document.execCommand(cmd, false, val)
		edited()
		sync()
	}

	toolbar.querySelectorAll("button[data-cmd]").forEach((b) => press(b, () => exec(b.dataset.cmd)))
	press($("emDashBtn"), () => exec("insertText", "—"))
	press($("clearFmtBtn"), () => {
		editor.focus()
		document.execCommand("removeFormat")
		// removeFormat leaves block formats and our size spans behind
		document.execCommand("formatBlock", false, "<p>")
		for (const cmd of ["bold", "italic", "underline", "strikeThrough"])
			if (document.queryCommandState(cmd)) document.execCommand(cmd, false, null)
		edited()
		sync()
	})
	// Choosing a block format is choosing a size, so the per-word size spans in
	// those blocks go with it — otherwise the new Heading renders at whatever
	// the old span said, and the control looks broken.
	$("blockFormat")?.addEventListener("change", (e) => {
		editor.focus()
		document.execCommand("formatBlock", false, "<" + e.target.value + ">")
		const sel = window.getSelection()
		if (sel?.rangeCount) clearSizesInBlocks(editor, sel.getRangeAt(0))
		edited()
		sync()
	})
	$("listSelect")?.addEventListener("change", (e) => {
		const v = e.target.value
		editor.focus()
		if (v === "none") {
			for (const c of ["insertUnorderedList", "insertOrderedList"])
				if (document.queryCommandState(c)) document.execCommand(c, false, null)
		} else document.execCommand(v, false, null)
		edited()
		sync()
	})
	$("alignSelect")?.addEventListener("change", (e) => exec(e.target.value))

	// ---- font size ----
	const sizesNow = () => {
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return []
		return sizesInRange(editor, sel.getRangeAt(0))
	}
	function applyFontSize(px) {
		editor.focus()
		document.execCommand("fontSize", false, "7")
		const made = absorbFontTags(editor, px)
		editor.focus()
		if (made.length) {
			// resizing leaves the text selected, so it can be resized again
			const r = document.createRange()
			r.setStartBefore(made[0])
			r.setEndAfter(made[made.length - 1])
			const sel = window.getSelection()
			sel.removeAllRanges()
			sel.addRange(r)
		}
		edited()
		sync()
	}
	const sizeForStep = () => {
		const sizes = sizesNow()
		if (sizes.length) return Math.min(...sizes)
		return parseSize($("fsInput")?.value) ?? DEFAULT_SIZE
	}
	const stepSize = (dir) => {
		const i = FONT_SIZES.indexOf(nearestSize(sizeForStep()))
		applyFontSize(FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, i + dir))])
	}
	press($("fsDown"), () => stepSize(-1))
	press($("fsUp"), () => stepSize(1))

	// The box steals the selection when it takes focus, so remember the range
	// on the way out and put it back before applying.
	let savedRange = null
	const remember = () => {
		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return
		const r = sel.getRangeAt(0)
		if (editor.contains(r.commonAncestorContainer) && !r.collapsed) savedRange = r.cloneRange()
	}
	const holdSel = (on) => editor.classList.toggle("hold-sel", on)
	$("fontStepper")?.addEventListener("mousedown", () => (remember(), holdSel(true)))
	$("fsInput")?.addEventListener("focus", () => $("fsInput").select())
	$("fsInput")?.addEventListener("blur", () => holdSel(false))
	editor.addEventListener("mousedown", () => holdSel(false))
	const applyFromBox = () => {
		const px = parseSize($("fsInput").value) // "24px" and "24" both mean 24
		editor.focus()
		if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
			const sel = window.getSelection()
			sel.removeAllRanges()
			sel.addRange(savedRange)
		}
		applyFontSize(px ?? sizeForStep())
		holdSel(false)
	}
	$("fsInput")?.addEventListener("change", applyFromBox)
	$("fsInput")?.addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return
		e.preventDefault()
		applyFromBox()
	})

	// ---- keeping the toolbar in step with the caret ----
	function sync() {
		const sizes = sizesNow()
		const box = $("fsInput")
		// A heading owns its own size, so the box turns off rather than showing a
		// number that would do nothing.
		const sel0 = window.getSelection()
		const inHeading = sel0?.rangeCount ? headingOnly(editor, sel0.getRangeAt(0)) : false
		for (const id of ["fsInput", "fsUp", "fsDown"]) {
			const el = $(id)
			if (el) el.disabled = inHeading
		}
		if (box) {
			if (inHeading) box.value = "—"
			else if (sizes.length > 1) box.value = "Multi"
			else if (sizes.length === 1) box.value = sizes[0]
		}
		try {
			const list = $("listSelect")
			if (list)
				list.value = document.queryCommandState("insertUnorderedList")
					? "insertUnorderedList"
					: document.queryCommandState("insertOrderedList")
						? "insertOrderedList"
						: "none"
			const align = $("alignSelect")
			if (align)
				align.value = document.queryCommandState("justifyCenter")
					? "justifyCenter"
					: document.queryCommandState("justifyRight")
						? "justifyRight"
						: "justifyLeft"
			// with no borders on the buttons, the pressed state is the only
			// signal that bold/italic/underline/strike are on
			for (const [cls, cmd] of [["tb-b", "bold"], ["tb-i", "italic"], ["tb-u", "underline"], ["tb-s", "strikeThrough"]])
				toolbar.querySelector("." + cls)?.classList.toggle("on", document.queryCommandState(cmd))
		} catch (e) {}
		syncBlock()
	}
	function syncBlock() {
		const picker = $("blockFormat")
		if (!picker) return
		const sel = document.getSelection()
		if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return
		let n = sel.anchorNode
		while (n && n !== editor) {
			const t = String(n.nodeName || "").toLowerCase()
			if (["h1", "h2", "h3", "blockquote"].includes(t)) return (picker.value = t)
			n = n.parentNode
		}
		picker.value = "p"
	}

	const onSelectionChange = () => {
		const sel = document.getSelection()
		if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return
		remember()
		sync()
	}
	document.addEventListener("selectionchange", onSelectionChange)
	editor.addEventListener("keyup", sync)
	editor.addEventListener("mouseup", sync)

	// Undo/redo, on the buttons and on the keyboard, through the same path.
	const step = (redo) => {
		editor.focus()
		clearTimeout(typingTimer)
		history.record() // fold any in-flight typing in before stepping
		if (!(redo ? history.redo() : history.undo())) return
		edited()
		sync()
	}
	press($("undoBtn"), () => step(false))
	press($("redoBtn"), () => step(true))
	// Ctrl/⌘+Z anywhere on the page does what the button does. Bound on the
	// document, not the editor: after clicking a toolbar control the focus may
	// be on that control, and in the game it may be in the chat box — real text
	// fields keep the browser's own undo, which is the right one there.
	const nativeUndoField = (el) => el && el !== editor && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
	const onKeyDown = (e) => {
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
		if (nativeUndoField(e.target) || nativeUndoField(document.activeElement)) return
		e.preventDefault()
		step(e.shiftKey)
	}
	document.addEventListener("keydown", onKeyDown)

	sync()
	return {
		sync,
		history,
		destroy() {
			document.removeEventListener("selectionchange", onSelectionChange)
			document.removeEventListener("keydown", onKeyDown)
			editor.removeEventListener("input", onInput)
			clearTimeout(typingTimer)
			editor.removeEventListener("keyup", sync)
			editor.removeEventListener("mouseup", sync)
		},
	}
}
