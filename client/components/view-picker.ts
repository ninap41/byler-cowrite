// The shelf layout picker, shared by /stories and /archive — one habit, one
// stored choice, so switching between the two libraries doesn't switch how
// they're laid out. The string building lives in archive-view.js; this is the
// DOM half: the segmented control, the saved value, and the grid class.
import { viewToggleHtml, cleanStoryView, storyView } from "../archive-view.js"
import type { StorageLike } from "../spectator-names.js"

export const VIEW_KEY = "cowriteStoriesView"

// Put a container into (or out of) grid mode. The column count is a CSS
// variable rather than a class per count: the stylesheet derives the whole
// grid from it, including how it degrades when the columns won't fit.
export function applyGrid(el: HTMLElement | null | undefined, cols: number): void {
	if (!el) return
	el.classList.toggle("st-grid", cols > 1)
	el.style.setProperty("--st-cols", String(cols))
}

export interface ViewPicker {
	readonly view: string
	readonly cols: number
	render(): void
}

// `onChange(cols)` is called once on mount and again on every switch, so the
// page has exactly one place that lays the shelf out.
export function mountViewPicker(wrap: HTMLElement | null | undefined, onChange?: (cols: number) => void, storage: StorageLike = localStorage): ViewPicker {
	let view = "list"
	try {
		view = cleanStoryView(storage.getItem(VIEW_KEY))
	} catch {}
	const render = () => {
		if (wrap) wrap.innerHTML = viewToggleHtml(view)
		onChange?.(storyView(view).cols)
	}
	wrap?.addEventListener("click", (e) => {
		const btn = (e.target as Element | null)?.closest<HTMLElement>(".st-view")
		if (!btn) return
		view = cleanStoryView(btn.dataset.view)
		try {
			storage.setItem(VIEW_KEY, view)
		} catch {
			/* private mode — the choice just won't persist */
		}
		render()
	})
	render()
	return {
		get view() {
			return view
		},
		get cols() {
			return storyView(view).cols
		},
		render,
	}
}
