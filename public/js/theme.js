// Theme switching (Neon Dusk / Aurora / Inkwell) + animated backgrounds.
// GSAP is optional: without it (or with prefers-reduced-motion) everything
// falls back to static CSS.
export const THEMES = ["neon", "aurora", "ink"]
const LABELS = { neon: "Neon Dusk", aurora: "Aurora", ink: "Inkwell" }

export function initTheme() {
	const root = document.documentElement
	const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	const hasGsap = typeof window.gsap !== "undefined" && !reduce
	const gsap = window.gsap
	let saved
	try {
		saved = localStorage.getItem("cowriteTheme")
	} catch (e) {}
	let current = THEMES.indexOf(saved) >= 0 ? saved : "neon"
	let floatTweens = []

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
		}
	}
	function applyTheme(theme) {
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
	applyTheme(current)

	return {
		applyTheme,
		get current() {
			return current
		},
	}
}
