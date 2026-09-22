// The floating emoji picker behind a `.react-add` smiley — one for the page,
// shared by the game chat and the solo editor's comment threads so the two
// can't drift. The page says whose reactions a target carries and what a pick
// does; this owns the element, the search, the placement and the ways out
// (a pick, an outside click, Escape). Markup comes from the pure builders in
// shared/reactions.ts; `.react-pick` is on util.ts's EMOJI_SKIP list.
import { reactionPickerHtml, reactionGridHtml } from "/js/components/reactions.js"
import type { Reactions } from "/js/shared/reactions.js"

export interface ReactionPickerOpts {
	/** the reactions already on target `id` (for the grid's `.on` marks) */
	reactionsOf: (id: string) => Reactions | null | undefined
	/** who I am on a chip */
	myKey: () => string | null | undefined
	onPick: (id: string, emoji: string) => void
}
export interface ReactionPicker {
	/** open under/over `btn` for target `id`; the same id again closes it */
	toggle: (btn: HTMLElement, id: string) => void
	close: () => void
	openId: () => string | null
}

export function createReactionPicker({ reactionsOf, myKey, onPick }: ReactionPickerOpts): ReactionPicker {
	const picker = document.createElement("div")
	picker.className = "react-pick hidden"
	document.body.appendChild(picker)
	let target: string | null = null

	function close() {
		picker.classList.add("hidden")
		target = null
	}
	function pick(emoji: string) {
		if (!target) return
		onPick(target, emoji)
		close()
	}
	function open(btn: HTMLElement, id: string) {
		target = id
		picker.innerHTML = reactionPickerHtml(reactionsOf(id), myKey())
		picker.classList.remove("hidden")
		const search = picker.querySelector<HTMLInputElement>(".react-search")!
		search.addEventListener("input", () => {
			picker.querySelector(".react-grid")!.innerHTML = reactionGridHtml(reactionsOf(id), myKey(), search.value)
		})
		search.addEventListener("keydown", (e) => {
			// Enter picks the first match
			if (e.key !== "Enter") return
			const first = picker.querySelector<HTMLElement>("[data-react]")
			if (first) pick(first.dataset.react || "")
		})
		if (!matchMedia("(hover: none)").matches) search.focus()
		const r = btn.getBoundingClientRect(), pw = picker.offsetWidth || 300
		picker.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left)) + "px"
		picker.style.top = (r.top - picker.offsetHeight - 6 > 8 ? r.top - picker.offsetHeight - 6 : r.bottom + 6) + "px"
	}

	picker.addEventListener("click", (e) => {
		const opt = (e.target as HTMLElement).closest?.<HTMLElement>("[data-react]")
		if (opt) pick(opt.dataset.react || "")
	})
	document.addEventListener("click", (e) => {
		const t = e.target as HTMLElement
		if (target && !picker.contains(t) && !t.closest?.(".react-add")) close()
	})
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && target) close()
	})

	return { toggle: (btn, id) => (target === id ? close() : open(btn, id)), close, openId: () => target }
}
