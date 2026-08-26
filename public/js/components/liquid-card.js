// A card whose edges ripple like the surface of water. mountLiquidCard(el)
// slips an SVG behind the card's content — a squircle sized to the card, its
// outline displaced by a stack of whole-numbered harmonics (so the loop
// closes seamlessly), a bulge that follows the pointer and rings that travel
// out from a click — and paints it in the THEME: the fill, well and glow are
// read from the page's --accent / --accent-2 / --panel tokens at mount and
// again whenever data-theme changes, so the water is always the theme's own
// colour. Under prefers-reduced-motion the surface is drawn once and stays
// still. The geometry (squircle, wave stack, Catmull-Rom outline) is pure and
// exported so a test can read it without a DOM.
const TAU = Math.PI * 2
export const N = 132 // outline samples; enough that the cubic fit reads as liquid

// A squircle of half-axes a × b around (cx, cy): corners stay continuous when
// the edge moves, which a rounded rectangle's straight runs wouldn't.
export function squircle(cx, cy, a, b, squareness = 0.4, n = N) {
	const pts = []
	for (let i = 0; i < n; i++) {
		const th = (i / n) * TAU
		const c = Math.cos(th), s = Math.sin(th)
		pts.push({ x: cx + a * Math.sign(c) * Math.pow(Math.abs(c), squareness), y: cy + b * Math.sign(s) * Math.pow(Math.abs(s), squareness) })
	}
	return pts
}
export function normals(base) {
	const n = base.length
	return base.map((p, i) => {
		const a = base[(i - 1 + n) % n], b = base[(i + 1) % n]
		const tx = b.x - a.x, ty = b.y - a.y
		const len = Math.hypot(tx, ty) || 1
		return { x: ty / len, y: -tx / len }
	})
}
// Four harmonics plus a slow breath of the whole body; unit amplitude.
export function displace(i, t, phase = 0, n = N) {
	const u = (i / n) * TAU
	return (
		0.5 * Math.sin(3 * u + 0.7 * t + phase) +
		0.32 * Math.sin(5 * u - 1.05 * t + phase * 1.3) +
		0.2 * Math.sin(8 * u + 1.45 * t) +
		0.12 * Math.sin(13 * u - 1.9 * t) +
		0.16 * Math.sin(0.55 * t)
	)
}
export const RING_LIFE = 1.7
export function shape({ base, norm, amp, t, phase = 0, swell = 0, now = 0, pointer = null, rings = [], pushRadius = 78 }) {
	const n = base.length, pts = new Array(n)
	for (let i = 0; i < n; i++) {
		let d = amp * displace(i, t, phase, n) + swell
		const bx = base[i].x, by = base[i].y
		if (pointer && pointer.push > 0.001) {
			const dist = Math.hypot(bx - pointer.x, by - pointer.y)
			d += pointer.push * 22 * Math.exp(-(dist * dist) / (2 * pushRadius * pushRadius))
		}
		for (const r of rings) {
			const age = now - r.born
			if (age < 0 || age > RING_LIFE) continue
			const front = Math.hypot(bx - r.x, by - r.y) - age * 300
			d += 26 * (1 - age / RING_LIFE) * Math.exp(-(front * front) / (2 * 52 * 52))
		}
		pts[i] = { x: bx + norm[i].x * d, y: by + norm[i].y * d }
	}
	return pts
}
// Closed Catmull-Rom → cubic Béziers.
export function toPath(p) {
	const n = p.length
	let d = `M${p[0].x.toFixed(2)},${p[0].y.toFixed(2)}`
	for (let i = 0; i < n; i++) {
		const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]
		d += `C${(p1.x + (p2.x - p0.x) / 6).toFixed(2)},${(p1.y + (p2.y - p0.y) / 6).toFixed(2)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(2)},${(p2.y - (p3.y - p1.y) / 6).toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
	}
	return d + "Z"
}

export const PAD = 100 // how far past the card box the water may reach
let seq = 0
export function liquidSvgHtml(key) {
	return (
		`<svg class="liquid-svg" aria-hidden="true">` +
		`<defs>` +
		`<linearGradient id="lq-body-${key}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" class="lq-c1"/><stop offset="52%" class="lq-c2"/><stop offset="100%" class="lq-c3"/></linearGradient>` +
		`<radialGradient id="lq-sheen-${key}" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" class="lq-s" stop-opacity="0.34"/><stop offset="100%" class="lq-s" stop-opacity="0"/></radialGradient>` +
		`<filter id="lq-bloom-${key}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>` +
		`<clipPath id="lq-clip-${key}"><path class="lq-clip" d=""/></clipPath>` +
		// the same blob in the CARD's own pixel space (the svg sits PAD outside
		// it), so the content wrapper can be clipped to the water via CSS
		`<clipPath id="lq-mask-${key}" clipPathUnits="userSpaceOnUse"><path class="lq-mask" d="" transform="translate(${-PAD},${-PAD})"/></clipPath>` +
		`</defs>` +
		`<path class="lq-glow" d="" filter="url(#lq-bloom-${key})"/>` +
		`<path class="lq-under" d=""/>` +
		`<path class="lq-surface" d="" fill="url(#lq-body-${key})"/>` +
		// the well: the theme's panel colour inside the water, so the card's
		// text sits on the same ground as every other card in every theme
		`<g clip-path="url(#lq-clip-${key})"><rect class="lq-well" width="100%" height="100%"/><ellipse class="lq-glint" rx="230" ry="150" fill="url(#lq-sheen-${key})"/></g>` +
		`</svg>`
	)
}

// Theme colours, read from the computed style of the card.
function themeInk(el, win) {
	const cs = win.getComputedStyle(el)
	const v = (n, fb) => (cs.getPropertyValue(n) || "").trim() || fb
	return { accent: v("--accent", "#2fa3a0"), accent2: v("--accent-2", "#a8e6d0"), deep: v("--bg-2", "#16414a"), panel: v("--panel-2", v("--panel", "#16414a")), ink: v("--ink", "#eaf6f2") }
}

export function mountLiquidCard(el, { amp = 9, rate = 1, maskSwell = 10, doc = document, win = window } = {}) {
	if (!el || el.querySelector(":scope > .liquid-svg")) return null
	const key = ++seq
	el.classList.add("liquid")
	// the content moves into a wrapper clipped to the water, so text that
	// reaches past the blob's edge is masked by it
	const content = doc.createElement("div")
	content.className = "lq-content"
	while (el.firstChild) content.appendChild(el.firstChild)
	el.appendChild(content)
	content.style.clipPath = `url(#lq-mask-${key})`
	el.insertAdjacentHTML("afterbegin", liquidSvgHtml(key))
	const svg = el.querySelector(":scope > .liquid-svg")
	const q = (c) => svg.querySelector("." + c)
	const nodes = { glow: q("lq-glow"), under: q("lq-under"), surface: q("lq-surface"), clip: q("lq-clip"), mask: q("lq-mask"), glint: q("lq-glint") }

	let W = 0, H = 0, base = [], norm = []
	function paintTheme() {
		const c = themeInk(el, win)
		svg.querySelector(".lq-c1").setAttribute("stop-color", c.accent2)
		svg.querySelector(".lq-c2").setAttribute("stop-color", c.accent)
		svg.querySelector(".lq-c3").setAttribute("stop-color", c.deep)
		svg.querySelector(".lq-well").setAttribute("fill", c.panel)
		for (const s of svg.querySelectorAll(".lq-s")) s.setAttribute("stop-color", c.ink)
		nodes.glow.setAttribute("fill", c.accent)
		nodes.under.setAttribute("fill", c.deep)
	}
	function measure() {
		const r = el.getBoundingClientRect()
		W = Math.max(1, r.width) + PAD * 2
		H = Math.max(1, r.height) + PAD * 2
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
		// the resting edge sits a little inside the box so the waves have room to
		// swell without being clipped by a tight column
		base = squircle(W / 2, H / 2, W / 2 - PAD - 6, H / 2 - PAD + 2)
		norm = normals(base)
		paint(0)
	}

	const pointer = { x: 0, y: 0, push: 0 }
	const rings = []
	const toLocal = (e) => {
		const r = svg.getBoundingClientRect()
		return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
	}
	el.addEventListener("pointermove", (e) => { const p = toLocal(e); pointer.x = p.x; pointer.y = p.y; pointer.push = 1 })
	el.addEventListener("pointerleave", () => { pointer.push = 0 })
	el.addEventListener("pointerdown", (e) => {
		if (e.target.closest("a, button, input, textarea, select")) return
		const p = toLocal(e)
		if (rings.length > 3) rings.shift()
		rings.push({ x: p.x, y: p.y, born: perf() / 1000 })
	})
	const perf = () => (win.performance ? win.performance.now() : Date.now())

	function paint(now, clock = 0) {
		if (!base.length) return
		const surface = shape({ base, norm, amp, t: clock, now, pointer, rings })
		const under = shape({ base, norm, amp, t: clock * 0.82, phase: 2.1, swell: 5, now })
		const path = toPath(surface)
		for (const n of [nodes.surface, nodes.clip, nodes.glow]) n.setAttribute("d", path)
		// the content mask is the same water pushed maskSwell px outward, so a
		// trough passing through the padding doesn't nibble the text; only what
		// overhangs the surface by more than that is cut
		nodes.mask.setAttribute("d", maskSwell ? toPath(shape({ base, norm, amp, t: clock, now, pointer, rings, swell: maskSwell })) : path)
		nodes.under.setAttribute("d", toPath(under))
		nodes.glint.setAttribute("cx", W / 2 - 60 + Math.sin(clock * 0.32) * 90)
		nodes.glint.setAttribute("cy", H / 2 - 70 + Math.cos(clock * 0.24) * 46)
	}

	const still = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false }
	let clock = 0, last = perf() / 1000, raf = 0, alive = true
	function frame(ms) {
		if (!alive) return
		const now = ms / 1000
		const dt = Math.min(now - last, 0.05)
		last = now
		clock += dt * rate
		pointer.push += ((pointer.push > 0.5 ? 1 : 0) - pointer.push) * dt * 3.2
		while (rings.length && now - rings[0].born > RING_LIFE) rings.shift()
		paint(now, clock)
		raf = win.requestAnimationFrame(frame)
	}

	paintTheme()
	measure()
	const ro = win.ResizeObserver ? new win.ResizeObserver(measure) : null
	ro?.observe(el)
	const mo = win.MutationObserver ? new win.MutationObserver(paintTheme) : null
	mo?.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
	if (!still.matches && win.requestAnimationFrame) raf = win.requestAnimationFrame(frame)

	return {
		svg,
		refresh: () => { paintTheme(); measure() },
		destroy() {
			alive = false; if (raf) win.cancelAnimationFrame?.(raf); ro?.disconnect(); mo?.disconnect(); svg.remove()
			while (content.firstChild) el.appendChild(content.firstChild)
			content.remove(); el.classList.remove("liquid")
		},
	}
}
