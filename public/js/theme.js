// Theme switching (Neon Dusk / Aurora / Inkwell) + animated backgrounds.
// GSAP is optional: without it (or with prefers-reduced-motion) everything
// falls back to static CSS.
export const THEMES = [
	"neon", "aurora", "ink", "wall", "snowball", "upside", "starcourt", "arcade", "cerebro",
	"hawkinslab", "castlebyers", "vecna", "void", "video", "hellfire", "rink", "camp", "bunker", "pollywog",
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
	camp: "Camp Know Where",
	bunker: "Russian Bunker",
	pollywog: "The Pollywog",
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
		if (menuOpen && sw && !sw.contains(e.target)) closeMenu()
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

	applyTheme(current)

	return {
		applyTheme,
		setGate,
		get current() {
			return current
		},
	}
}
