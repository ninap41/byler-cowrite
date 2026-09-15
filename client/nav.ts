// Hamburger nav drawer (GSAP-animated, CSS fallback). Items are real links —
// each page marks its own entry with aria-current via mountChrome.
export function initNav(): void {
	const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	const gsap = !reduce ? window.gsap : undefined
	const navBtn = document.getElementById("navBtn")
	const drawer = document.getElementById("navDrawer")
	const scrim = document.getElementById("navScrim")
	if (!navBtn || !drawer || !scrim) return
	const bars = navBtn.querySelectorAll(".bar")
	let navOpen = false

	function openNav() {
		navOpen = true
		navBtn!.setAttribute("aria-expanded", "true")
		if (gsap) {
			gsap.killTweensOf([drawer, scrim, bars, drawer!.children])
			gsap.set([drawer, scrim], { visibility: "visible" })
			gsap.to(scrim, { opacity: 1, duration: 0.3 })
			gsap.to(drawer, { x: 0, duration: 0.45, ease: "power3.out" })
			gsap.fromTo(
				drawer!.children,
				{ opacity: 0, x: 24 },
				{ opacity: 1, x: 0, duration: 0.35, stagger: 0.06, delay: 0.15, ease: "power2.out", clearProps: "transform" },
			)
			gsap.to(bars[0], { rotation: 45, y: 7, duration: 0.3, ease: "power2.out" })
			gsap.to(bars[1], { opacity: 0, scaleX: 0.4, duration: 0.2 })
			gsap.to(bars[2], { rotation: -45, y: -7, duration: 0.3, ease: "power2.out" })
		} else {
			scrim!.style.visibility = drawer!.style.visibility = "visible"
			scrim!.style.opacity = "1"
			drawer!.style.transform = "translateX(0)"
		}
	}
	function closeNav() {
		if (!navOpen) return
		navOpen = false
		navBtn!.setAttribute("aria-expanded", "false")
		if (gsap) {
			gsap.killTweensOf([drawer, scrim, bars])
			gsap.to(scrim, { opacity: 0, duration: 0.25, onComplete: () => gsap.set(scrim, { visibility: "hidden" }) })
			gsap.to(drawer, {
				x: "100%",
				duration: 0.35,
				ease: "power2.in",
				onComplete: () => gsap.set(drawer, { visibility: "hidden" }),
			})
			gsap.to(bars[0], { rotation: 0, y: 0, duration: 0.3 })
			gsap.to(bars[1], { opacity: 1, scaleX: 1, duration: 0.25, delay: 0.1 })
			gsap.to(bars[2], { rotation: 0, y: 0, duration: 0.3 })
		} else {
			scrim!.style.visibility = drawer!.style.visibility = "hidden"
			scrim!.style.opacity = "0"
			drawer!.style.transform = "translateX(100%)"
		}
	}
	navBtn.addEventListener("click", () => (navOpen ? closeNav() : openNav()))
	scrim.addEventListener("click", closeNav)
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && navOpen) closeNav()
	})
}
