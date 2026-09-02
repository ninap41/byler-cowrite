// The AO3 previewer's wiring: the CSS drawer (the app's side-drawer component,
// with Minimise / Expand on top of it), the live skin, and the lint list. No
// login, no chrome — everything it touches is on /ao3-preview itself.
//
// `mountPreview(doc, opts)` takes the document plus injectable storage and
// loaders so a jsdom test can drive it without a server.

import { mountSideDrawer } from "/js/components/side-drawer.js"
import { lintCss } from "./ao3-rules.js"

export const KEY_CSS = "cowriteAo3Css"
export const KEY_HTML = "cowriteAo3Html"
export const KEY_DRAWER = "cowriteAo3Drawer"
export const KEY_EXPANDED = "cowriteAo3Expanded"
export const KEY_STRICT = "cowriteAo3Strict"

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

export function lintRowHtml(p) {
	const what = p.prop ? `<code>${esc(p.prop)}</code>${p.value ? `: <code>${esc(p.value.length > 60 ? p.value.slice(0, 57) + "…" : p.value)}</code>` : ""}` : `<code>${esc(p.selector)}</code>`
	return `<button type="button" class="ap-lint-row ${p.severity}" data-line="${p.line}"><span class="ln">L${p.line}</span>${what}<span class="why">${esc(p.message)}</span></button>`
}

export function lintHtml(problems) {
	if (!problems.length) return ""
	return problems.map(lintRowHtml).join("")
}

export function issuesLabel(problems) {
	const err = problems.filter((p) => p.severity === "error").length
	const warn = problems.length - err
	if (!problems.length) return { text: "AO3-clean", cls: "" }
	const bits = []
	if (err) bits.push(`${err} dropped`)
	if (warn) bits.push(`${warn} warning${warn === 1 ? "" : "s"}`)
	return { text: bits.join(" · "), cls: err ? "has-err" : "has-warn" }
}

async function fetchText(url) {
	const r = await fetch(url)
	if (!r.ok) throw new Error(`${url}: ${r.status}`)
	return r.text()
}

export function mountPreview(doc = document, { storage = globalThis.localStorage, loadCss = () => fetchText("/ao3/default-skin.css"), loadHtml = () => fetchText("/ao3/default-work.html") } = {}) {
	const $ = (id) => doc.getElementById(id)
	const root = $("apRoot")
	const css = $("apCss")
	const skin = $("apSkin")
	const work = $("apWork")
	const lint = $("apLint")
	const issues = $("apIssues")
	const strict = $("apStrict")
	const expandBtn = $("apExpand")
	const get = (k) => {
		try {
			return storage?.getItem(k)
		} catch (e) {
			return null
		}
	}
	const set = (k, v) => {
		try {
			v == null ? storage?.removeItem(k) : storage?.setItem(k, v)
		} catch (e) {}
	}

	// ---- the drawer ----
	const drawer = mountSideDrawer({ grid: root, drawer: $("apSide"), grip: $("apGrip"), tab: $("apTab"), closeBtn: $("apMin"), key: KEY_DRAWER, open: true, storage })
	// the component reads a stored state as closed when there is none; a
	// first visit should find the drawer open — it is the point of the page
	if (get(KEY_DRAWER) == null) drawer.setOpen(true)
	let expanded = get(KEY_EXPANDED) === "1"
	const paintExpanded = () => {
		root.classList.toggle("side-expanded", expanded)
		expandBtn.setAttribute("aria-pressed", String(expanded))
		expandBtn.title = expanded ? "Back to normal width" : "Expand"
	}
	expandBtn.addEventListener("click", () => {
		expanded = !expanded
		set(KEY_EXPANDED, expanded ? "1" : null)
		if (expanded && !drawer.open) drawer.setOpen(true)
		paintExpanded()
	})
	paintExpanded()

	// ---- the skin ----
	let defaults = { css: "", html: "" }
	let last = { problems: [], cleaned: "" }
	const isStrict = () => !!strict?.checked
	function apply() {
		const text = css.value
		last = lintCss(text)
		skin.textContent = isStrict() ? last.cleaned : text
		lint.innerHTML = lintHtml(last.problems)
		const label = issuesLabel(last.problems)
		issues.textContent = label.text
		issues.className = "ap-issues " + label.cls
	}
	let timer = null
	css.addEventListener("input", () => {
		set(KEY_CSS, css.value)
		clearTimeout(timer)
		timer = setTimeout(apply, 120)
	})
	// Tab indents instead of leaving the box — it is a code editor
	css.addEventListener("keydown", (e) => {
		if (e.key !== "Tab") return
		e.preventDefault()
		const { selectionStart: s, selectionEnd: en, value } = css
		css.value = value.slice(0, s) + "\t" + value.slice(en)
		css.selectionStart = css.selectionEnd = s + 1
		css.dispatchEvent(new Event("input"))
	})
	if (strict) {
		strict.checked = get(KEY_STRICT) !== "0"
		strict.addEventListener("change", () => {
			set(KEY_STRICT, strict.checked ? "1" : "0")
			apply()
		})
	}
	// a lint row puts the caret on its line
	lint.addEventListener("click", (e) => {
		const row = e.target.closest?.(".ap-lint-row")
		if (!row) return
		const line = Number(row.dataset.line) || 1
		const lines = css.value.split("\n")
		const at = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
		css.focus()
		css.setSelectionRange(at, at + (lines[line - 1] || "").length)
	})

	$("apResetCss")?.addEventListener("click", () => {
		css.value = defaults.css
		set(KEY_CSS, null)
		apply()
	})
	$("apResetHtml")?.addEventListener("click", () => {
		work.innerHTML = defaults.html
		set(KEY_HTML, null)
	})

	// ---- load the shipped defaults, prefer the saved draft ----
	const ready = Promise.all([loadCss().catch(() => ""), loadHtml().catch(() => "")]).then(([c, h]) => {
		defaults = { css: c, html: h }
		const savedCss = get(KEY_CSS)
		const savedHtml = get(KEY_HTML)
		css.value = savedCss ?? c
		work.innerHTML = savedHtml ?? h
		apply()
	})

	return {
		ready,
		drawer,
		apply,
		get expanded() {
			return expanded
		},
		get problems() {
			return last.problems
		},
		get cleaned() {
			return last.cleaned
		},
	}
}
