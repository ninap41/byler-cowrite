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

// The previewer's copy: NO upper limit on the drawer — it may be dragged as
// wide as the window minus a sliver of the page (SIDE_KEEP), and as narrow as
// SIDE_MIN. (The app's own drawer caps at 560.)
export const SIDE_MIN = 120
export const SIDE_KEEP = 80
export const SIDE_DEFAULT = 300
export const sideMax = () => Math.max(SIDE_MIN, (globalThis.document?.defaultView?.innerWidth || globalThis.innerWidth || 1e6) - SIDE_KEEP)
export const clampWidth = (px) => Math.min(sideMax(), Math.max(SIDE_MIN, Math.round(Number(px) || SIDE_DEFAULT)))

// Under this width the drawer stops being a column and becomes a sheet that
// comes up from the bottom — the same breakpoint the comments rail uses.
export const PHONE_SIDE = "(max-width: 860px)"

function read(storage, key) {
	try {
		const raw = JSON.parse(storage.getItem(key) || "{}")
		return { open: !!raw.open, width: clampWidth(raw.width ?? SIDE_DEFAULT) }
	} catch (e) {
		return { open: false, width: SIDE_DEFAULT }
	}
}

export function mountSideDrawer({
	grid, // the grid that gains/loses the column (gets `side-closed`)
	drawer, // the <aside class="doc-side">
	grip,
	tab, // the edge button that reopens it
	closeBtn,
	key = "cowriteDrawer",
	open = false, // the state to start from when nothing is stored yet
	storage = window.localStorage,
	onChange,
} = {}) {
	if (!grid || !drawer) return { set: () => {}, get open() { return false } }
	let state = { open, width: SIDE_DEFAULT, ...read(storage, key) }
	const phone = () => window.matchMedia(PHONE_SIDE).matches

	function save() {
		try {
			storage.setItem(key, JSON.stringify(state))
		} catch (e) {}
	}
	function apply() {
		// one number drives both: a column's width on desktop, the sheet's height
		// on a phone
		document.documentElement.style.setProperty("--doc-side-w", state.width + "px")
		grid.classList.toggle("side-closed", !state.open)
		drawer.classList.toggle("open", state.open)
		tab?.classList.toggle("hidden", state.open)
		tab?.setAttribute("aria-expanded", String(state.open))
		onChange?.(state)
	}
	const setOpen = (v) => {
		state = { ...state, open: !!v }
		save()
		apply()
	}
	const setWidth = (px) => {
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
			if (e.key === "ArrowLeft") (e.preventDefault(), setWidth(state.width + step))
			else if (e.key === "ArrowRight") (e.preventDefault(), setWidth(state.width - step))
			else if (e.key === "Escape") setOpen(false)
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
