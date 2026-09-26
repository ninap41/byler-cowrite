// Hot Keys: the one table of editor shortcuts, the small round "?" that
// lists them, and the Cmd/Ctrl dispatcher — shared by the solo editor and the
// game's writer box so the two can't drift.
//
// The component never touches the editor's html itself: every shortcut is a
// page callback, because each page owns its own undo history and its own
// after-edit work (a save flag here, a live-typing relay there). B, I and U
// are listed but NOT intercepted — the browser's own contenteditable
// shortcut does the formatting and the toolbar's caret sync lights the
// button; a preventDefault + execCommand would toggle twice in Chrome.
//
// The em dash and the divider take SHIFT: macOS swallows plain ⌘H (Hide app)
// before the page ever sees it, and ⌘E is taken by browser extensions. So
// does the image: ⌘I is italic. ⌘K is the browser's address-bar search only
// while the caret is outside an editable, which is exactly when we ignore it.
import { placeMenu } from "./export-menu.js"

export type HotKeyId = "find" | "save" | "emDash" | "hr" | "link" | "image" | "bold" | "italic" | "underline" | "submit"

export interface HotKey {
	id: HotKeyId
	/** the letter (or "Enter") after the modifier */
	key: string
	shift?: boolean
	label: string
	/** the page runs it (and the component prevents the browser's default); absent = the browser's own */
	handled: boolean
	/** only while the caret is in the editor (a format), not from anywhere on the page (find, save) */
	inEditor: boolean
}

export const HOT_KEYS: Record<HotKeyId, HotKey> = {
	find: { id: "find", key: "F", label: "Find", handled: true, inEditor: false },
	save: { id: "save", key: "S", label: "Save", handled: true, inEditor: false },
	emDash: { id: "emDash", key: "E", shift: true, label: "Em dash —", handled: true, inEditor: true },
	hr: { id: "hr", key: "H", shift: true, label: "Divider", handled: true, inEditor: true },
	link: { id: "link", key: "K", label: "Link", handled: true, inEditor: true },
	image: { id: "image", key: "I", shift: true, label: "Image", handled: true, inEditor: true },
	bold: { id: "bold", key: "B", label: "Bold", handled: false, inEditor: true },
	italic: { id: "italic", key: "I", label: "Italic", handled: false, inEditor: true },
	underline: { id: "underline", key: "U", label: "Underline", handled: false, inEditor: true },
	submit: { id: "submit", key: "Enter", label: "Add line", handled: true, inEditor: true },
}

export const isMac = (nav: { platform?: string; userAgent?: string } = navigator): boolean =>
	/mac|iphone|ipad|ipod/i.test(nav.platform || "") || /Mac|iPhone|iPad/.test(nav.userAgent || "")

/** "⌘ ⇧ H" on a Mac, "Ctrl + Shift + H" elsewhere — a space between every part */
export const keyLabel = (k: HotKey, mac: boolean): string => {
	const key = k.key === "Enter" ? (mac ? "↩" : "Enter") : k.key
	return mac ? ["⌘", k.shift ? "⇧" : "", key].filter(Boolean).join(" ") : ["Ctrl", k.shift ? "Shift" : "", key].filter(Boolean).join(" + ")
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function hotKeysHtml(prefix: string, ids: HotKeyId[] = [], mac = false): string {
	const rows = ids.map((id) => HOT_KEYS[id]).map((k) => `<dt><kbd>${esc(keyLabel(k, mac))}</kbd></dt><dd>${esc(k.label)}</dd>`).join("")
	return (
		`<span class="hk-wrap" id="${prefix}HkWrap">Hot Keys ` +
		`<button type="button" class="hk-btn" id="${prefix}HkBtn" aria-haspopup="dialog" aria-expanded="false" aria-label="Keyboard shortcuts" aria-controls="${prefix}HkMenu">?</button>` +
		`<div class="hk-menu" id="${prefix}HkMenu" role="dialog" aria-label="Keyboard shortcuts"><h4>Hot Keys</h4><dl>${rows}</dl></div>` +
		`</span>`
	)
}

export interface HotKeysOpts {
	prefix: string
	/** which shortcuts this page offers, in menu order */
	keys: HotKeyId[]
	editor: HTMLElement
	/** false = the editing shortcuts sleep (source view, a reader); find/save still fire */
	isActive?: () => boolean
	actions: Partial<Record<Exclude<HotKeyId, "bold" | "italic" | "underline">, () => void>>
	mac?: boolean
}
export interface HotKeys {
	open(): void
	close(): void
	isOpen(): boolean
	destroy(): void
}

/** the shortcut a keydown asks for, or null — pure, so the test can pin it */
export function matchHotKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, ids: HotKeyId[]): HotKey | null {
	if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
	const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
	for (const id of ids) {
		const k = HOT_KEYS[id]
		if (k.key === key && !!k.shift === e.shiftKey) return k
	}
	return null
}

export function mountHotKeys(root: HTMLElement, { prefix, keys, editor, isActive = () => true, actions, mac = isMac() }: HotKeysOpts): HotKeys {
	const doc = root.ownerDocument
	const win = doc.defaultView || window
	root.innerHTML = hotKeysHtml(prefix, keys, mac)
	const btn = doc.getElementById(`${prefix}HkBtn`) as HTMLButtonElement
	const menu = doc.getElementById(`${prefix}HkMenu`) as HTMLElement

	const isOpen = () => menu.classList.contains("open")
	const place = () => {
		menu.classList.remove("down", "right")
		const b = btn.getBoundingClientRect()
		const m = menu.getBoundingClientRect()
		// it lives at the foot of the page, so "up" is the resting state and the
		// flip is DOWN when there is more room below
		const { up, right } = placeMenu(b, m, { width: win.innerWidth, height: win.innerHeight })
		menu.classList.toggle("down", !up && b.top < m.height + 6)
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
	const onDocClick = (e: Event) => {
		if (isOpen() && !(e.target as HTMLElement).closest?.(`#${prefix}HkWrap`)) close()
	}
	const onResize = () => isOpen() && place()

	const inEditor = () => {
		const a = doc.activeElement
		return !!a && (a === editor || editor.contains(a))
	}
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && isOpen()) {
			close()
			btn.focus()
			return
		}
		const k = matchHotKey(e, keys)
		if (!k || !k.handled) return
		if (k.inEditor && (!inEditor() || !isActive())) return
		const run = actions[k.id as keyof HotKeysOpts["actions"]]
		if (!run) return
		e.preventDefault()
		run()
	}
	doc.addEventListener("click", onDocClick)
	doc.addEventListener("keydown", onKeyDown)
	win.addEventListener("resize", onResize)

	return {
		open,
		close,
		isOpen,
		destroy() {
			doc.removeEventListener("click", onDocClick)
			doc.removeEventListener("keydown", onKeyDown)
			win.removeEventListener("resize", onResize)
		},
	}
}
