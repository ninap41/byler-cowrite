// The announcement's border: a rounded frame that DRAWS itself once around
// the card (GSAP) in the theme's accent, and once the entrance has played it
// keeps GLIMMERING: a gradient of the theme's accent, second accent and ink
// sweeps along the stroke on a loop while the glow behind it flashes. The
// colours are CSS (--accent / --accent-2 / --ink read off the card), so every
// theme paints its own. Geometry is pure and exported; the mount needs a DOM
// and, for motion, window.gsap (without it, or under reduced motion, the
// border simply appears).
export const RADIUS = 14 // must match the card's border-radius
export const INSET = 1 // keeps the stroke off the clipping edge
export const DRAW = 0.95 // seconds for the border to complete
export const SWEEP = 2.4 // seconds for one gradient pass
export const SWEEP_GAP = 1.4 // seconds of rest between passes

// The frame path: a rounded rectangle traced clockwise from the top-left.
export function frameD(w: number, h: number, r: number = RADIUS, i: number = INSET): string {
	const x = w - i,
		y = h - i
	return (
		`M${i + r},${i} H${x - r} A${r},${r} 0 0 1 ${x},${i + r}` +
		` V${y - r} A${r},${r} 0 0 1 ${x - r},${y}` +
		` H${i + r} A${r},${r} 0 0 1 ${i},${y - r}` +
		` V${i + r} A${r},${r} 0 0 1 ${i + r},${i} Z`
	)
}
let seq = 0
export function vineSvgHtml(key: number | string = ++seq): string {
	return (
		`<svg class="vine" aria-hidden="true" data-key="${key}">` +
		`<defs><linearGradient id="vine-grad-${key}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="0">` +
		`<stop offset="0" class="vg-a"/><stop offset="0.5" class="vg-b"/><stop offset="1" class="vg-a"/>` +
		`</linearGradient></defs>` +
		`<path class="vine-glow"></path>` +
		`<path class="vine-line"></path>` +
		`<path class="vine-shine" stroke="url(#vine-grad-${key})"></path>` +
		`</svg>`
	)
}

/** A GSAP timeline, as far as this module drives one. */
interface TimelineLike {
	kill(): void
	isActive(): boolean
	progress(): number
	progress(v: number): void
	to(...args: unknown[]): TimelineLike
	fromTo(...args: unknown[]): TimelineLike
	set(...args: unknown[]): TimelineLike
}
export interface TendrilOpts {
	horn?: HTMLElement | null
	gsap?: GsapLike | undefined
	win?: (Window & typeof globalThis) | undefined
}
export interface TendrilBorder {
	svg: SVGSVGElement
	render(): void
	settle(): void
	glimmer(): void
	destroy(): void
}

export function mountTendrilBorder(el: HTMLElement | null, { horn = null, gsap = globalThis.window?.gsap, win = globalThis.window }: TendrilOpts = {}): TendrilBorder | null {
	if (!el || el.querySelector(":scope > .vine")) return null
	el.classList.add("tendril")
	el.insertAdjacentHTML("afterbegin", vineSvgHtml())
	const svg = el.querySelector<SVGSVGElement>(":scope > .vine")!
	const line = svg.querySelector<SVGPathElement>(".vine-line")!,
		glow = svg.querySelector<SVGPathElement>(".vine-glow")!,
		shine = svg.querySelector<SVGPathElement>(".vine-shine")!,
		grad = svg.querySelector<SVGLinearGradientElement>("linearGradient")!
	const still = win?.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)").matches : false
	let tl: TimelineLike | null = null,
		loop: TimelineLike | null = null,
		W = 0

	function paintTheme() {
		const cs = win?.getComputedStyle ? win.getComputedStyle(el!) : null
		const v = (n: string, fb: string) => (cs?.getPropertyValue(n) || "").trim() || fb
		const accent = v("--accent", "#e0705f"),
			accent2 = v("--accent-2", accent),
			ink = v("--ink", "#fff")
		for (const s of svg.querySelectorAll(".vg-a")) s.setAttribute("stop-color", accent2)
		svg.querySelector(".vg-b")!.setAttribute("stop-color", ink)
		grad.dataset.accent = accent
	}
	function build() {
		const w = el!.offsetWidth,
			h = el!.offsetHeight
		if (!w || !h) return
		W = w
		svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
		const d = frameD(w, h)
		for (const n of [line, glow, shine]) n.setAttribute("d", d)
	}
	const kill = () => {
		tl?.kill()
		loop?.kill()
		tl = loop = null
	}
	function settle() {
		// resting look: the plain accent frame
		kill()
		for (const n of [line, glow, shine]) {
			n.style.strokeDasharray = "none"
			n.style.strokeDashoffset = "0"
		}
		glow.style.opacity = "0"
		shine.style.opacity = "0"
		if (horn) horn.style.opacity = "1"
	}
	// after the entrance: the gradient sweeps the frame, the glow flashes with it
	function glimmer() {
		if (!gsap || still || !W) return
		loop?.kill()
		const band = Math.max(160, W * 0.45)
		gsap.set(shine, { opacity: 1, strokeDasharray: "none", strokeDashoffset: 0 })
		loop = gsap.timeline({ repeat: -1, repeatDelay: SWEEP_GAP }) as TimelineLike
		loop.fromTo(grad, { attr: { x1: -band, x2: 0 } }, { attr: { x1: W, x2: W + band }, duration: SWEEP, ease: "sine.inOut" }, 0)
		loop.fromTo(glow, { opacity: 0 }, { opacity: 0.5, duration: SWEEP / 2, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0)
	}
	function grow() {
		kill()
		if (!gsap || still) {
			settle()
			return
		}
		const L = line.getTotalLength ? line.getTotalLength() : 2 * (el!.offsetWidth + el!.offsetHeight)
		gsap.set([line, glow], { strokeDasharray: L, strokeDashoffset: L })
		gsap.set(glow, { opacity: 0.55 })
		gsap.set(shine, { opacity: 0 })
		tl = gsap.timeline({ onComplete: glimmer }) as TimelineLike
		tl.to([line, glow], { strokeDashoffset: 0, duration: DRAW, ease: "power2.inOut" }, 0)
		if (horn) {
			tl.fromTo(horn, { opacity: 0.15 }, { opacity: 1, duration: 0.07, repeat: 5, yoyo: true, ease: "none" }, 0.1)
			tl.set(horn, { opacity: 1 })
		}
		tl.to(glow, { opacity: 0, duration: 0.6, ease: "power1.out" }, DRAW - 0.1)
		tl.set([line, glow], { clearProps: "strokeDasharray,strokeDashoffset" })
	}
	function render() {
		paintTheme()
		build()
		grow()
	}

	let redraw: ReturnType<typeof setTimeout> | undefined
	const ro = win?.ResizeObserver
		? new win.ResizeObserver(() => {
				clearTimeout(redraw)
				redraw = setTimeout(() => {
					build()
					if (!tl?.isActive()) {
						settle()
						glimmer()
					}
				}, 120)
			})
		: null
	ro?.observe(el)
	const mo = win?.MutationObserver ? new win.MutationObserver(paintTheme) : null
	mo?.observe(el.ownerDocument.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
	// a background tab throttles rAF and can freeze the entrance mid-draw; on
	// refocus, finish the border outright and hand over to the glimmer
	const onVisible = () => {
		if (el!.ownerDocument.visibilityState !== "visible") return
		if (tl && tl.progress() < 1) tl.progress(1)
		if (!loop) {
			settle()
			glimmer()
		}
	}
	el.ownerDocument.addEventListener("visibilitychange", onVisible)
	render()
	return {
		svg,
		render,
		settle,
		glimmer,
		destroy() {
			kill()
			ro?.disconnect()
			mo?.disconnect()
			el!.ownerDocument.removeEventListener("visibilitychange", onVisible)
			svg.remove()
			el!.classList.remove("tendril")
		},
	}
}
