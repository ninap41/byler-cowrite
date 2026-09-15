// A loop that nobody can see should not run. `whenVisible` calls `onShow`
// while an element is both on screen (IntersectionObserver) and in a
// foreground tab (document.visibilityState), and `onHide` the moment either
// stops being true — so a GSAP loop or a CSS-driven effect can pause instead
// of burning frames off screen. Without IntersectionObserver (jsdom, very old
// browsers) the element counts as on screen and only tab visibility gates it.
export interface WhenVisibleOpts {
	onShow: () => void
	onHide: () => void
	/** extra margin around the viewport before an element counts as visible */
	rootMargin?: string
}

export function whenVisible(el: Element, { onShow, onHide, rootMargin = "80px" }: WhenVisibleOpts, win: (Window & typeof globalThis) | undefined = globalThis.window): () => void {
	const doc = el.ownerDocument
	let onScreen = true
	let shown: boolean | null = null // what the caller last heard
	const judge = () => {
		const now = onScreen && doc.visibilityState !== "hidden"
		if (now === shown) return
		shown = now
		if (now) onShow()
		else onHide()
	}
	const io = win?.IntersectionObserver
		? new win.IntersectionObserver(
				(entries) => {
					for (const e of entries) onScreen = e.isIntersecting
					judge()
				},
				{ rootMargin },
			)
		: null
	io?.observe(el)
	doc.addEventListener("visibilitychange", judge)
	if (!io) judge() // no observer: settle the initial state now
	return () => {
		io?.disconnect()
		doc.removeEventListener("visibilitychange", judge)
	}
}
