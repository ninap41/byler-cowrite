// A side drawer, extracted from the solo editor's comments rail so the game can
// have the same one: a column on desktop, a bottom sheet on a phone, open and
// closed by the ✕ in its head and an edge tab that brings it back, resizable by
// the grip on its inner edge (drag, double-click to reset, arrow keys), with
// both the open state and the size remembered per browser.
//
// The rail's markup and CSS are shared — `.doc-side`, `.doc-side-card`,
// `.doc-side-grip`, `.doc-side-tab`, and the `side-closed` class on the grid
// container — so the two drawers cannot drift apart visually. Only the storage
// key and the grid element differ.
//
// `storage` is injectable so tests don't need a real localStorage.
import type { StorageLike } from "../spectator-names.js"

export const SIDE_MIN = 240
export const SIDE_MAX = 560
export const SIDE_DEFAULT = 300
export const clampWidth = (px: unknown): number => Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(Number(px) || SIDE_DEFAULT)))

// Under this width the drawer stops being a column and becomes a sheet that
// comes up from the bottom — the same breakpoint the comments rail uses.
export const PHONE_SIDE = "(max-width: 860px)"

/** The remembered state: open or not, and how wide (a column) / tall (a sheet). */
export interface SidePrefs {
	open: boolean
	width: number
}

// What the browser remembers, or null when nothing is stored yet (the
// caller's `open` default applies only then).
function read(storage: StorageLike, key: string): SidePrefs | null {
	try {
		const item = storage.getItem(key)
		if (!item) return null
		const raw = JSON.parse(item) as Partial<SidePrefs>
		return { open: !!raw.open, width: clampWidth(raw.width ?? SIDE_DEFAULT) }
	} catch {
		return null
	}
}

export interface SideDrawerOpts {
	/** the grid that gains/loses the column (gets `side-closed`) */
	grid?: HTMLElement | null
	/** the <aside class="doc-side"> */
	drawer?: HTMLElement | null
	grip?: HTMLElement | null
	/** the edge button that reopens it */
	tab?: HTMLElement | null
	closeBtn?: HTMLElement | null
	key?: string
	/** the state to start from when nothing is stored yet */
	open?: boolean
	storage?: StorageLike
	onChange?: (state: SidePrefs) => void
}
export interface SideDrawer {
	setOpen(v: boolean): void
	setWidth(px: number): void
	readonly open: boolean
	readonly width: number
}

export function mountSideDrawer({
	grid,
	drawer,
	grip,
	tab,
	closeBtn,
	key = "cowriteDrawer",
	open = false,
	storage = window.localStorage,
	onChange,
}: SideDrawerOpts = {}): SideDrawer {
	if (!grid || !drawer) {
		// nothing to drive: an inert drawer with the same shape, so a page that
		// lacks the rail can still call it
		return { setOpen() {}, setWidth() {}, open: false, width: SIDE_DEFAULT }
	}
	let state: SidePrefs = read(storage, key) ?? { open, width: SIDE_DEFAULT }
	const phone = () => window.matchMedia(PHONE_SIDE).matches

	function save() {
		try {
			storage.setItem(key, JSON.stringify(state))
		} catch {}
	}
	function apply() {
		// one number drives both: a column's width on desktop, the sheet's height
		// on a phone
		document.documentElement.style.setProperty("--doc-side-w", state.width + "px")
		grid!.classList.toggle("side-closed", !state.open)
		drawer!.classList.toggle("open", state.open)
		tab?.classList.toggle("hidden", state.open)
		tab?.setAttribute("aria-expanded", String(state.open))
		onChange?.(state)
	}
	const setOpen = (v: boolean) => {
		state = { ...state, open: !!v }
		save()
		apply()
	}
	const setWidth = (px: number) => {
		state = { ...state, width: clampWidth(px) }
		save()
		apply()
	}

	closeBtn?.addEventListener("click", () => setOpen(false))
	tab?.addEventListener("click", () => setOpen(true))

	// Drag the grip: on desktop the pointer's distance from the right edge IS the
	// width; on a phone the sheet's height is measured up from the bottom.
	if (grip) {
		let dragging = false
		const end = () => {
			dragging = false
			document.body.classList.remove("resizing-side")
		}
		grip.addEventListener("pointerdown", (e) => {
			dragging = true
			document.body.classList.add("resizing-side")
			grip.setPointerCapture?.(e.pointerId)
		})
		grip.addEventListener("pointermove", (e) => {
			if (!dragging) return
			e.preventDefault()
			setWidth(phone() ? window.innerHeight - e.clientY : window.innerWidth - e.clientX)
		})
		grip.addEventListener("pointerup", end)
		grip.addEventListener("pointercancel", end)
		grip.addEventListener("dblclick", () => setWidth(SIDE_DEFAULT))
		// a drag handle nobody can tab to is a control that doesn't exist for part
		// of the audience
		grip.addEventListener("keydown", (e) => {
			const step = e.shiftKey ? 48 : 16
			if (e.key === "ArrowLeft") {
				e.preventDefault()
				setWidth(state.width + step)
			} else if (e.key === "ArrowRight") {
				e.preventDefault()
				setWidth(state.width - step)
			} else if (e.key === "Escape") setOpen(false)
		})
	}

	apply()
	return {
		setOpen,
		setWidth,
		get open() {
			return state.open
		},
		get width() {
			return state.width
		},
	}
}
