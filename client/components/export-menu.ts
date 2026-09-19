// Share / Download ▾ — the one control for keeping a copy of a story, on the
// reveal card and in the archive: a flyout with the three ways out (copy as
// rich text, a styled .html, a .pdf) and one switch — sign every line with
// its writer's name, or prose only. The menu opens where it can be SEEN:
// `placeMenu` flips it above the button when the viewport ends before the
// list does, and hangs it off the right edge when the right side runs out.
// The choice of signatures is remembered per browser (`cowriteExportBylines`).
import { buildExports, exportDocument, exportFileName, type ExportLine } from "../export.js"
import { loadJsPdf, storyToPdf, printFallback } from "../export-pdf.js"

export const BYLINES_KEY = "cowriteExportBylines"

export interface ExportSource {
	prompt: string
	story: ExportLine[]
	code?: string
}

export const exportMenuHtml = (prefix: string): string =>
	`<span class="xp-wrap" id="${prefix}ExportWrap">` +
	`<button type="button" class="ghost xp-btn" id="${prefix}ExportBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="${prefix}ExportMenu">⬇ Share / Download <span class="chev">▾</span></button>` +
	`<div class="xp-menu" id="${prefix}ExportMenu" role="menu" aria-label="Share or download this story">` +
	`<label class="xp-opt xp-toggle"><input type="checkbox" id="${prefix}Bylines"> <span><b>Sign every line</b><span class="subtle">Each line opens with its writer's name in bold</span></span></label>` +
	`<button type="button" class="xp-opt" id="${prefix}Copy" role="menuitem"><b>📋 Copy (formatted)</b><span class="subtle">Paste into AO3, Docs or Word with the formatting kept</span></button>` +
	`<button type="button" class="xp-opt" id="${prefix}Html" role="menuitem"><b>⬇ Download .html</b><span class="subtle">A styled page that opens anywhere</span></button>` +
	`<button type="button" class="xp-opt" id="${prefix}Pdf" role="menuitem"><b>⬇ Download .pdf</b><span class="subtle">For printing or sending on</span></button>` +
	`<span class="xp-note subtle" id="${prefix}ExportNote" aria-live="polite"></span>` +
	`</div></span>`

export interface Rect {
	top: number
	bottom: number
	left: number
	right: number
	width: number
	height: number
}
/** Which way the menu should open so it stays inside the viewport. Pure. */
export function placeMenu(btn: Rect, menu: { width: number; height: number }, view: { width: number; height: number }, gap = 6): { up: boolean; right: boolean } {
	const below = view.height - btn.bottom - gap
	const above = btn.top - gap
	const up = menu.height > below && above > below
	const right = btn.left + menu.width > view.width && btn.right - menu.width >= 0
	return { up, right }
}

export const readBylines = (store: Storage = localStorage): boolean => {
	try {
		return store.getItem(BYLINES_KEY) === "1"
	} catch {
		return false
	}
}

export interface ExportMenu {
	open(): void
	close(): void
	isOpen(): boolean
	bylines(): boolean
}

export interface MountOpts {
	prefix: string
	source: () => ExportSource
	/** where feedback lands ("Copied…"); defaults to the menu's own note line */
	onNote?: (text: string) => void
	store?: Storage
}

export function mountExportMenu(root: HTMLElement, { prefix, source, onNote, store }: MountOpts): ExportMenu {
	root.innerHTML = exportMenuHtml(prefix)
	const doc = root.ownerDocument
	const win = doc.defaultView || window
	const $ = (id: string) => doc.getElementById(prefix + id) as HTMLElement
	const btn = $("ExportBtn") as HTMLButtonElement
	const menu = $("ExportMenu")
	const box = $("Bylines") as HTMLInputElement
	const note = $("ExportNote")
	const say = (t: string) => {
		if (onNote) onNote(t)
		else note.textContent = t
	}
	let noteTimer: ReturnType<typeof setTimeout> | undefined
	const flash = (t: string) => {
		say(t)
		clearTimeout(noteTimer)
		noteTimer = setTimeout(() => say(""), 2600)
	}
	const st = store || win.localStorage
	box.checked = readBylines(st)
	box.addEventListener("change", () => {
		try {
			st.setItem(BYLINES_KEY, box.checked ? "1" : "0")
		} catch {}
	})

	const isOpen = () => menu.classList.contains("open")
	const place = () => {
		menu.classList.remove("up", "right")
		const b = btn.getBoundingClientRect()
		const m = menu.getBoundingClientRect()
		const { up, right } = placeMenu(b, m, { width: win.innerWidth, height: win.innerHeight })
		menu.classList.toggle("up", up)
		menu.classList.toggle("right", right)
	}
	const open = () => {
		menu.classList.add("open")
		btn.setAttribute("aria-expanded", "true")
		place()
	}
	const close = () => {
		menu.classList.remove("open")
		btn.setAttribute("aria-expanded", "false")
	}
	btn.addEventListener("click", (e) => {
		e.stopPropagation()
		isOpen() ? close() : open()
	})
	doc.addEventListener("click", (e) => {
		if (isOpen() && !(e.target as HTMLElement).closest?.(`#${prefix}ExportWrap`)) close()
	})
	doc.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && isOpen()) {
			close()
			btn.focus()
		}
	})
	win.addEventListener("resize", () => isOpen() && place())

	const exports = () => {
		const s = source()
		return buildExports(s.prompt || "", s.story || [], doc, { bylines: box.checked })
	}
	const download = (content: string, type: string, name: string) => {
		const blob = new Blob([content], { type })
		const a = doc.createElement("a")
		a.href = URL.createObjectURL(blob)
		a.download = name
		a.click()
		URL.revokeObjectURL(a.href)
	}
	$("Copy").addEventListener("click", async () => {
		const ex = exports()
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/html": new Blob([ex.html], { type: "text/html" }),
					"text/plain": new Blob([ex.plain], { type: "text/plain" }),
				}),
			])
			flash("Copied: paste into AO3, Docs or Word")
		} catch {
			try {
				await navigator.clipboard.writeText(ex.plain)
				flash("Copied (plain text)")
			} catch {
				flash("Copy failed")
			}
		}
	})
	$("Html").addEventListener("click", () => {
		download(exportDocument(exports().html), "text/html", exportFileName(source().code, "html"))
		flash("Downloaded .html")
		close()
	})
	$("Pdf").addEventListener("click", async () => {
		const s = source()
		try {
			storyToPdf(await loadJsPdf(), s.prompt || "", s.story || [], exportFileName(s.code, "pdf"), { bylines: box.checked, doc })
			flash("Downloaded .pdf")
		} catch (e) {
			if (!printFallback(exports().html)) flash((e as Error).message)
		}
		close()
	})
	return { open, close, isOpen, bylines: () => box.checked }
}
