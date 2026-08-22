// Theme switching (Neon Dusk / Aurora / Inkwell) + animated backgrounds.
// GSAP is optional: without it (or with prefers-reduced-motion) everything
// falls back to static CSS.
import { SITE_FONTS, fontByKey } from "./fonts.js"
import { mountFlipSelect } from "./components/flip-select.js"
export { SITE_FONTS }
export const THEMES = [
	"neon", "aurora", "ink", "wall", "snowball", "upside", "starcourt", "arcade", "cerebro",
	"hawkinslab", "castlebyers", "vecna", "void", "video", "hellfire", "rink", "cleradin", "bunker", "clouds",
]
export const THEME_LABELS = {
	neon: "Neon Dusk",
	aurora: "Aurora",
	ink: "Inkwell",
	wall: "The Wall",
	snowball: "Snow Ball",
	upside: "Upside Down",
	starcourt: "Starcourt",
	arcade: "Palace Arcade",
	cerebro: "Cerebro",
	hawkinslab: "Hawkins Lab",
	castlebyers: "Castle Byers",
	vecna: "Vecna's Clock",
	void: "The Void",
	video: "Family Video",
	hellfire: "Hellfire Club",
	rink: "Rink-O-Mania",
	cleradin: "Cleradin",
	bunker: "Russian Bunker",
	clouds: "I Miss the Clouds",
}
const LABELS = THEME_LABELS

// ---- Themes as rank rewards ----
// A theme listed in achievements.json's themeUnlocks needs that word tier;
// anything unlisted is free and admins get everything. The server hands the
// menu {locks, unlocked} (GET /api/themes, or `themes` on /api/me) and this
// module only paints it: a locked row says what earns it and refuses the
// click. It is a REWARD, not a permission — a theme is a css attribute on your
// own document, so there is nothing here to protect, only something to earn.
export const DEFAULT_THEME = "neon"
// The site font override (see initTheme's Font row): "theme" = no override.
export const DEFAULT_FONT = "theme"
export const cleanSiteFont = (key) => (fontByKey(key) ? key : DEFAULT_FONT)
export const themeAllowed = (id, { locks = {}, unlocked = [] } = {}) => !locks[id] || unlocked.includes(id)
// "🧙 Sorcerer · 20,000 words" — what a locked row tells you.
export function lockTip(id, locks = {}) {
	const lock = locks[id]
	if (!lock) return ""
	return `Unlocks at ${lock.name}${lock.min ? " · " + lock.min.toLocaleString() + " words" : ""}`
}

export function initTheme() {
	const root = document.documentElement
	const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	const hasGsap = typeof window.gsap !== "undefined" && !reduce
	const gsap = window.gsap
	let saved
	try {
		saved = localStorage.getItem("cowriteTheme")
	} catch (e) {}
	let current = THEMES.indexOf(saved) >= 0 ? saved : DEFAULT_THEME
	let floatTweens = []
	// Until the account's ranks arrive every theme is treated as available:
	// the alternative is a visible flash of locks on every page load.
	let gate = { locks: {}, unlocked: [] }

	// ---- Cleradin: the keeps parallax vertically with the scroll ----------
	// Three silhouettes at three depths; the near one travels furthest, so
	// scrolling reads as walking towards the castle. No GSAP needed (it is a
	// transform per frame either way), but reduced motion leaves them still.
	let stopScroll = null
	// How much of the tower a full page-scroll is allowed to cover. Under 1 so
	// the foot of the tower is never quite reached.
	const REACH = 0.82
	function startParallax(theme) {
		if (stopScroll) stopScroll()
		stopScroll = null
		if (theme !== "cleradin" || reduce) return
		const layers = [...document.querySelectorAll(".bg-set.cleradin [data-par]")]
		if (!layers.length) return
		// data-par="auto" is the tower: it is taller than the window on purpose,
		// and its rate is DERIVED from the page rather than picked — the whole
		// drawing travels exactly once over the whole scrollable height, so the
		// roof is what you land on and the door is where the page ends,
		// whatever the page happens to be. A short page moves it slowly; a long
		// one moves it fast; neither runs out of tower.
		const rateOf = (l) => {
			if (l.dataset.par !== "auto") return parseFloat(l.dataset.par) || 0
			const page = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
			const travel = Math.max(0, l.offsetHeight - window.innerHeight)
			// REACH keeps the last stretch of the tower out of frame: arriving at
			// the ground would end the illusion — there is always more tower.
			return (travel / page) * REACH
		}
		let rates = layers.map(rateOf)
		const at = layers.map(() => 0) // where each layer currently is
		let target = 0
		let raf = 0
		// The scroll wheel is steppy and a trackpad is not; either way, snapping
		// the tower to the exact scroll offset reads as jitter at this scale. So
		// the layers CHASE the scroll instead of tracking it: each frame closes
		// a fraction of the remaining distance, which is a spring with no
		// overshoot. The loop stops itself once everything has arrived.
		const EASE = 0.12
		const tick = () => {
			let moving = false
			layers.forEach((l, i) => {
				const want = -target * rates[i]
				const d = want - at[i]
				if (Math.abs(d) > 0.05) {
					at[i] += d * EASE
					moving = true
				} else at[i] = want
				l.style.transform = `translate3d(0, ${at[i].toFixed(2)}px, 0)`
			})
			raf = moving ? requestAnimationFrame(tick) : 0
		}
		const kick = () => {
			target = window.scrollY || window.pageYOffset || 0
			if (!raf) raf = requestAnimationFrame(tick)
		}
		const remeasure = () => {
			rates = layers.map(rateOf)
			kick()
		}
		window.addEventListener("scroll", kick, { passive: true })
		window.addEventListener("resize", remeasure)
		// a page that grows after load (a list that finished loading, a drawer
		// that opened) changes the rate, so watch the document, not just resize
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null
		ro?.observe(document.body)
		// land on the right frame straight away rather than easing in from zero
		target = window.scrollY || window.pageYOffset || 0
		layers.forEach((l, i) => {
			at[i] = -target * rates[i]
			l.style.transform = `translate3d(0, ${at[i].toFixed(2)}px, 0)`
		})
		stopScroll = () => {
			window.removeEventListener("scroll", kick)
			window.removeEventListener("resize", remeasure)
			ro?.disconnect()
			if (raf) cancelAnimationFrame(raf)
			for (const l of layers) l.style.transform = ""
		}
	}

	// ---- Castle Byers: the forest leans away from the pointer -------------
	// Four traced tree layers plus the fort, each with a data-depth; the
	// pointer's offset from screen centre (normalised to -1..1) pushes every
	// layer the opposite way, deeper layers further, so the forest reads as a
	// diorama you're peering into. Vertical travel is damped to 45% — trees
	// are taller than they are deep. The pointer leaving the window recentres
	// everything on the slow eased transition (the .live class swaps in a fast
	// linear one while the pointer moves).
	let stopMouse = null
	const MOUSE_AMT = 26
	function startMouseParallax(theme) {
		if (stopMouse) stopMouse()
		stopMouse = null
		if (theme !== "castlebyers" || reduce) return
		const set = document.querySelector(".bg-set.castlebyers")
		const layers = set ? [...set.querySelectorAll("[data-depth]")] : []
		if (!layers.length) return
		const depths = layers.map((l) => parseFloat(l.dataset.depth) || 0)
		let x = 0,
			y = 0,
			raf = 0
		const draw = () => {
			raf = 0
			layers.forEach((l, i) => {
				const tx = (-x * MOUSE_AMT * depths[i]).toFixed(2)
				const ty = (-y * MOUSE_AMT * depths[i] * 0.45).toFixed(2)
				l.style.setProperty("--cb-par", `translate3d(${tx}px, ${ty}px, 0)`)
			})
		}
		const onMove = (e) => {
			set.classList.add("live")
			x = (e.clientX / window.innerWidth) * 2 - 1
			y = (e.clientY / window.innerHeight) * 2 - 1
			if (!raf) raf = requestAnimationFrame(draw)
		}
		const onLeave = () => {
			set.classList.remove("live")
			x = y = 0
			if (!raf) raf = requestAnimationFrame(draw)
		}
		window.addEventListener("pointermove", onMove, { passive: true })
		document.documentElement.addEventListener("pointerleave", onLeave)
		stopMouse = () => {
			window.removeEventListener("pointermove", onMove)
			document.documentElement.removeEventListener("pointerleave", onLeave)
			if (raf) cancelAnimationFrame(raf)
			set.classList.remove("live")
			for (const l of layers) l.style.removeProperty("--cb-par")
		}
	}

	// ---- I Miss the Clouds: layered clouds on sine paths ------------------
	// Depth is the whole effect: the palest, slowest, blurriest formations are
	// BEHIND (first in the DOM), the darkest and fastest in front. Every layer
	// gets its own speed, amplitude, wave length, spacing and phase, and each
	// cloud within a layer gets a random phase of its own, so nothing ever
	// marches in step. Horizontal travel dominates; the sine is a drift, not a
	// bounce.
	const CLOUD_LAYERS = [
		{ count: 4, w: 260, h: 118, scale: 0.8, op: 0.5, blur: 12, color: "rgba(236, 234, 255, 0.75)", top: [6, 34], dur: 190, amp: 10, wave: 26 },
		{ count: 4, w: 330, h: 148, scale: 0.9, op: 0.42, blur: 9, color: "rgba(214, 214, 250, 0.7)", top: [18, 52], dur: 140, amp: 16, wave: 21 },
		{ count: 3, w: 430, h: 190, scale: 1, op: 0.36, blur: 6, color: "rgba(120, 128, 190, 0.75)", top: [34, 68], dur: 95, amp: 22, wave: 17 },
		{ count: 3, w: 560, h: 245, scale: 1.1, op: 0.5, blur: 3, color: "rgba(34, 40, 78, 0.85)", top: [52, 88], dur: 62, amp: 30, wave: 13 },
	]
	let cloudTweens = []
	function stopClouds() {
		cloudTweens.forEach((t) => t && t.kill && t.kill())
		cloudTweens = []
	}
	function startClouds(theme) {
		stopClouds()
		const bands = [...document.querySelectorAll(".bg-set.clouds .cloud-band")]
		if (!bands.length) return
		if (theme !== "clouds") {
			// an unseen sky costs nothing to keep, but it costs nothing to drop
			for (const b of bands) b.innerHTML = ""
			return
		}
		bands.forEach((band, li) => {
			const L = CLOUD_LAYERS[li] || CLOUD_LAYERS[CLOUD_LAYERS.length - 1]
			band.classList.toggle("gsap", hasGsap)
			band.innerHTML = ""
			for (let i = 0; i < L.count; i++) {
				const c = document.createElement("div")
				c.className = "cloud"
				const spread = (L.top[1] - L.top[0]) / Math.max(1, L.count - 1)
				c.style.cssText =
					`--cw:${L.w}px;--ch:${L.h}px;--op:${L.op};--bl:${L.blur}px;--cc:${L.color};` +
					`top:${(L.top[0] + spread * i).toFixed(1)}%;` +
					// the CSS fallback needs the timing inline; GSAP ignores both
					`--dur:${L.dur}s;--delay:${(-(L.dur / L.count) * i).toFixed(1)}s;`
				band.appendChild(c)
			}
			if (!hasGsap) return
			const span = () => window.innerWidth + L.w * 2
			band.querySelectorAll(".cloud").forEach((c, i) => {
				const x = gsap.to(c, {
					x: () => span(),
					duration: L.dur,
					ease: "none",
					repeat: -1,
					startAt: { x: -L.w * 1.5, scale: L.scale },
				})
				x.progress(i / L.count) // spaced by phase, not by a stagger of delays
				// the wave moves the cloud's PATH, never its shape — a separate
				// y tween on the same element, out of step with its neighbours
				const y = gsap.to(c, {
					y: L.amp,
					duration: L.wave,
					ease: "sine.inOut",
					repeat: -1,
					yoyo: true,
					startAt: { y: -L.amp },
				})
				y.progress((i * 0.37 + li * 0.19) % 1)
				cloudTweens.push(x, y)
			})
		})
	}

	function stopFloat() {
		floatTweens.forEach((t) => t && t.kill && t.kill())
		floatTweens = []
		if (hasGsap) gsap.set(".bg-set .orb, .bg-set .blot", { clearProps: "transform" })
	}
	function startFloat(theme) {
		if (!hasGsap) return
		stopFloat()
		if (theme === "aurora") {
			document.querySelectorAll(".bg-set.aurora .orb").forEach((o, i) => {
				floatTweens.push(
					gsap.to(o, {
						x: i % 2 ? 60 : -70,
						y: i % 2 ? -50 : 60,
						duration: 9 + i * 2,
						repeat: -1,
						yoyo: true,
						ease: "sine.inOut",
					}),
				)
				floatTweens.push(gsap.to(o, { scale: 1.12, duration: 7 + i, repeat: -1, yoyo: true, ease: "sine.inOut" }))
			})
		} else if (theme === "ink") {
			document.querySelectorAll(".bg-set.ink .blot").forEach((o, i) => {
				floatTweens.push(
					gsap.to(o, {
						x: i % 2 ? 40 : -40,
						y: i % 2 ? 30 : -30,
						duration: 12 + i * 3,
						repeat: -1,
						yoyo: true,
						ease: "sine.inOut",
					}),
				)
			})
		} else {
			// newer themes mark their floating elements with .drift
			document.querySelectorAll(`.bg-set.${theme} .drift`).forEach((o, i) => {
				floatTweens.push(
					gsap.to(o, {
						x: i % 2 ? 90 : -90,
						y: i % 2 ? -70 : 70,
						rotation: i % 2 ? 14 : -14,
						duration: 7 + i * 2,
						repeat: -1,
						yoyo: true,
						ease: "sine.inOut",
					}),
				)
			})
		}
	}
	function applyTheme(theme) {
		// An unearned theme can still be sitting in localStorage — from a demo,
		// another account on this browser, or a lock added after the fact.
		if (!themeAllowed(theme, gate)) theme = DEFAULT_THEME
		current = theme
		root.setAttribute("data-theme", theme)
		try {
			localStorage.setItem("cowriteTheme", theme)
		} catch (e) {}
		document.querySelectorAll("[data-theme-btn]").forEach((b) => {
			b.classList.toggle("active", b.getAttribute("data-theme-btn") === theme)
		})
		const curSw = document.getElementById("themeCurSw"),
			curLabel = document.getElementById("themeCurLabel")
		if (curSw) curSw.className = "sw sw-" + theme
		if (curLabel) curLabel.textContent = LABELS[theme] || theme
		startFloat(theme)
		startParallax(theme)
		startMouseParallax(theme)
		startClouds(theme)
		if (hasGsap) gsap.fromTo(".bg-layers", { opacity: 0.35 }, { opacity: 1, duration: 0.6, ease: "power2.out" })
	}

	/* dropdown open/close (3D flip fold) */
	const sw = document.getElementById("themeSwitch")
	const toggle = document.getElementById("themeToggle")
	const menu = document.getElementById("themeMenu")
	let menuOpen = false
	if (hasGsap && menu) menu.style.transition = "none" // CSS transition is the no-GSAP fallback only
	function openMenu() {
		menuOpen = true
		sw.classList.add("open")
		toggle.setAttribute("aria-expanded", "true")
		if (hasGsap) {
			gsap.killTweensOf([menu, menu.children])
			gsap.set(menu, { visibility: "visible", transformOrigin: "50% 0" })
			gsap.fromTo(menu, { rotationX: -90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.45, ease: "power2.out" })
			gsap.fromTo(
				menu.children,
				{ opacity: 0, y: -8 },
				{ opacity: 1, y: 0, duration: 0.3, stagger: 0.06, delay: 0.12, ease: "power2.out", clearProps: "transform" },
			)
		}
	}
	function closeMenu() {
		menuOpen = false
		toggle.setAttribute("aria-expanded", "false")
		if (hasGsap) {
			gsap.killTweensOf([menu, menu.children])
			gsap.to(menu, {
				rotationX: -90,
				opacity: 0,
				duration: 0.3,
				ease: "power2.in",
				onComplete: () => {
					sw.classList.remove("open")
					gsap.set(menu, { clearProps: "all" })
				},
			})
		} else {
			sw.classList.remove("open")
		}
	}
	if (toggle)
		toggle.addEventListener("click", (e) => {
			e.stopPropagation()
			menuOpen ? closeMenu() : openMenu()
		})
	if (menu)
		menu.addEventListener("click", (e) => {
			const b = e.target.closest("[data-theme-btn]")
			if (b) {
				// a locked row is a signpost, not a button: it stays put and
				// keeps the menu open so you can read what earns it
				if (b.classList.contains("locked")) return
				applyTheme(b.getAttribute("data-theme-btn"))
				closeMenu()
			}
		})
	document.addEventListener("click", (e) => {
		// the font list is portaled to <body> while open: a click in it is a
		// click in the theme menu, not outside it
		if (menuOpen && sw && !sw.contains(e.target) && !fontPick?.menu.contains(e.target)) closeMenu()
	})
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && menuOpen) closeMenu()
	})
	// Paint the lock state onto the menu: earned rows behave, unearned ones say
	// what earns them. Called again whenever the account changes (sign in/out).
	function setGate(next) {
		gate = { locks: next?.locks || {}, unlocked: next?.unlocked || [] }
		document.querySelectorAll("[data-theme-btn]").forEach((b) => {
			const id = b.getAttribute("data-theme-btn")
			const locked = !themeAllowed(id, gate)
			b.classList.toggle("locked", locked)
			b.setAttribute("aria-disabled", locked ? "true" : "false")
			const tip = locked ? lockTip(id, gate.locks) : ""
			if (tip) b.dataset.tip = tip
			else delete b.dataset.tip
			const label = b.querySelector("span")
			if (label) label.textContent = (locked ? "🔒 " : "") + (LABELS[id] || id)
		})
		// and if you were wearing something you no longer have, step back
		if (!themeAllowed(current, gate)) applyTheme(DEFAULT_THEME)
	}

	// ---- Site font: the theme menu's Font row ----
	// A per-browser override of the theme's body + story faces (display and
	// mono stay the theme's). It rides as `data-font` on <html> — the head
	// script sets it from localStorage before first paint, exactly like the
	// theme — and html[data-font=…] rules in base.css do the overriding, so
	// applyTheme() never has to know about it and never clears it.
	let font = DEFAULT_FONT
	try {
		font = cleanSiteFont(localStorage.getItem("cowriteFont"))
	} catch (e) {}
	// The Font row is a flip menu: each row set in its own face (a native
	// option list can't promise that over a translucent panel), portaled out
	// of the theme menu while open so it can fold past the menu's edge and
	// scroll on its own. It lives inside #themeSwitch, and its portaled list
	// counts as inside too (see the outside-click check below).
	const fontHost = document.getElementById("themeFontPick")
	const fontPick = fontHost
		? mountFlipSelect(fontHost, {
				id: "themeFont",
				label: "Site font",
				portal: true,
				value: font,
				rows: [
					{ value: "theme", label: "Theme default", style: "" },
					...SITE_FONTS.map((f) => ({ value: f.key, label: f.label, style: `font-family:${f.stack}` })),
				],
				onChange: (v) => applyFont(v),
			})
		: null
	function applyFont(key) {
		font = cleanSiteFont(key)
		const f = fontByKey(font)
		if (f) root.setAttribute("data-font", font)
		else root.removeAttribute("data-font")
		try {
			if (f) localStorage.setItem("cowriteFont", font)
			else localStorage.removeItem("cowriteFont")
		} catch (e) {}
		fontPick?.set(font) // the closed toggle previews the choice in its own face
	}

	applyTheme(current)
	applyFont(font)

	return {
		applyTheme,
		applyFont,
		setGate,
		get current() {
			return current
		},
		get font() {
			return font
		},
	}
}
