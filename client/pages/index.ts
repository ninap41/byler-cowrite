import { api, getToken, setToken } from "/js/api.js"
import { mountChrome } from "/js/chrome.js"
import { wireAuthForms } from "/js/components/auth-forms.js"
import { heroMarkHtml, logoHtml } from "/js/logo.js"
import { tourHtml, tourDotsHtml, TOUR } from "/js/tour-screens.js"

/** A running story as public GET /api/live lists it (names and counts only). */
interface LiveGame {
	code: string
	name?: string
	phase: string
	players: number
	hostName?: string | null
}
declare global {
	interface Window {
		/** the hero write-in (index.html's entrance script) awaits the random tagline */
		_quoteFetch?: Promise<unknown>
		/** the hero's exit, installed by the entrance script when GSAP is loaded */
		_heroExit?: () => void
	}
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
mountChrome({ nav: false }) // homepage: no drawer, just theme + background
mountTour()
// Spiral + quill in one svg; the GSAP script has the quill draw the spiral.
$("heroLogo").innerHTML = heroMarkHtml("hero")
// Already signed in (valid token)? Straight to the dashboard.
if (getToken())
	api("/api/me", null, "GET")
		.then(() => location.replace("/dashboard"))
		.catch(() => setToken(null))

wireAuthForms(document, {
	api,
	onSignedIn: (_user, token) => {
		setToken(token)
		location.href = "/dashboard"
	},
	onCapReached: showWaitlist,
})

// ---- Waiting list: the auth card gives way to Kip's message ----
// (fires when signup returns capReached — the account cap is full)
function showWaitlist(email?: string) {
	$("lobby").classList.add("hidden")
	const card = $("waitlistCard")
	card.classList.remove("hidden")
	$<HTMLInputElement>("wlEmail").value = email || ""
	// Animate the message in the site's style: each word fades up in
	// sequence (GSAP; without it — or with reduced motion — it just shows).
	const h2 = $("waitlistMsg")
	const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	if (typeof gsap !== "undefined" && !reduce) {
		const words = (h2.textContent || "").trim().split(/\s+/)
		h2.textContent = ""
		for (const w of words) {
			const s = document.createElement("span")
			s.textContent = w + " "
			s.style.display = "inline-block"
			s.style.whiteSpace = "pre"
			h2.appendChild(s)
		}
		gsap.fromTo(card, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", clearProps: "transform" })
		gsap.fromTo(
			h2.children,
			{ opacity: 0, y: 10 },
			{ opacity: 1, y: 0, duration: 0.4, stagger: 0.035, ease: "power2.out", clearProps: "transform" },
		)
		gsap.fromTo("#waitlistForm", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, delay: words.length * 0.035 + 0.2, ease: "power2.out", clearProps: "transform" })
	}
}
$("wlJoin").onclick = async () => {
	try {
		await api("/api/waitlist", { email: $<HTMLInputElement>("wlEmail").value.trim() })
		$("waitlistForm").classList.add("hidden")
		const done = $("waitlistDone")
		done.classList.remove("hidden")
		if (typeof gsap !== "undefined") gsap.fromTo(done, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" })
	} catch (e) {
		$("wlErr").textContent = (e as Error).message
	}
}
$("wlEmail").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault()
		$("wlJoin").click()
	}
})

// ---- Features modal (opens from the hero tagline) ----
// Random tagline from quotes.json — swap it in before (or while) the
// hero types it out; the animation script awaits this promise.
window._quoteFetch = fetch("/api/quote")
	.then((r) => r.json())
	.then(({ quote }: { quote?: string }) => {
		// the banner capture keeps the fixed tagline, not a random quote
		if (quote && !document.documentElement.classList.contains("og-capture")) $("heroTagText").textContent = quote
	})
	.catch(() => {})
// The feature rundown never opens on a touch device while GSAP is
// loaded — the modal over the tweening hero crashes mobile browsers.
// The tagline stays plain text there; the tour below covers it.
const touchDevice = () => window.matchMedia?.("(hover: none) and (pointer: coarse)").matches
const featuresAllowed = () => !(touchDevice() && typeof window.gsap !== "undefined")
if (!featuresAllowed()) {
	$("heroTag").removeAttribute("title")
	$("heroTag").style.cursor = "default"
}
$("heroTag").onclick = () => {
	if (featuresAllowed()) $("featuresModal").classList.remove("hidden")
}
$("featuresClose").onclick = () => $("featuresModal").classList.add("hidden")
$("featuresModal").addEventListener("click", (e) => {
	if (e.target === $("featuresModal")) $("featuresModal").classList.add("hidden")
})
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") $("featuresModal").classList.add("hidden")
})

// ---- Hero fallback: without GSAP the Enter button just closes it ----
$("heroEnter").onclick = () => {
	if (window._heroExit) window._heroExit()
	else $("hero").classList.add("hidden")
}

// ---- The tour ----
function scrollTo(id: string) {
	const el = $(id)
	if (!el) return
	if (!$("hero").classList.contains("hidden")) {
		// leaving the hero the same way Enter does, then landing on the target
		if (window._heroExit) window._heroExit()
		else $("hero").classList.add("hidden")
		setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 700)
	} else el.scrollIntoView({ behavior: "smooth", block: "start" })
}
function mountTour() {
	$("barLogo").innerHTML = logoHtml("bar")
	$("closeLogo").innerHTML = logoHtml("close")
	$("tour").innerHTML = tourHtml()
	$("tourDots").innerHTML = tourDotsHtml()
	// the theme the visitor wears is marked in the themes screen — and a
	// click on any thumb previews it on the spot (attribute only, not saved)
	const wearing = document.documentElement.getAttribute("data-theme") || "neon"
	document.querySelectorAll<HTMLElement>(".ts-theme[data-theme-id]").forEach((t) => {
		t.classList.toggle("on", t.dataset.themeId === wearing)
		t.onclick = () => {
			document.documentElement.setAttribute("data-theme", t.dataset.themeId || "")
			document.querySelectorAll(".ts-theme[data-theme-id]").forEach((o) => o.classList.toggle("on", o === t))
		}
	})
	// screens fade up as they arrive; the chapter rail follows the reader
	const dots = [...document.querySelectorAll<HTMLElement>(".tour-dot")]
	if ("IntersectionObserver" in window) {
		const reveal = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { rootMargin: "0px 0px -12% 0px" })
		document.querySelectorAll(".tour-screen").forEach((el) => reveal.observe(el))
		const rail = new IntersectionObserver(
			(es) => es.forEach((e) => {
				if (!e.isIntersecting) return
				const i = +((e.target as HTMLElement).dataset.chapter || 0)
				dots.forEach((d, j) => d.classList.toggle("on", i === j))
			}),
			{ rootMargin: "-40% 0px -55% 0px" },
		)
		document.querySelectorAll(".tour-panel").forEach((el) => rail.observe(el))
	} else document.querySelectorAll(".tour-screen").forEach((el) => el.classList.add("in"))
	dots.forEach((d, i) => (d.onclick = (e) => { e.preventDefault(); scrollTo("tour-" + TOUR[i]!.id) }))
	$("heroMore").onclick = () => scrollTo("tour")
	$("closeSignup").onclick = () => { $("chSignup").click(); scrollTo("start") }
	$("closeWatch").onclick = () => {
		const live = $("liveWatch")
		if (live.classList.contains("hidden")) { $("chSignup").click(); scrollTo("start") } else scrollTo("liveWatch")
	}
}

// ---- Live stories: spectate without an account ----
const PHASE_LABEL: Record<string, string> = { waiting: "gathering writers", choosing: "voting", writing: "writing now" }
async function loadLive() {
	let d: { games: LiveGame[] }
	try {
		d = (await fetch("/api/live").then((r) => r.json())) as { games: LiveGame[] }
	} catch (e) {
		return
	}
	const card = $("liveWatch")
	const box = $("liveWatchList")
	card.classList.toggle("hidden", !d.games.length)
	box.innerHTML = ""
	d.games.forEach((g) => {
		const row = document.createElement("div")
		row.className = "live-game"
		const info = document.createElement("span")
		info.className = "lg-info"
		const b = document.createElement("b")
		b.textContent = g.name || g.code
		const sub = document.createElement("span")
		sub.className = "lg-sub"
		sub.textContent = `${PHASE_LABEL[g.phase] || g.phase} · ${g.players} writer${g.players === 1 ? "" : "s"}` + (g.hostName ? ` · ${g.hostName} (host)` : "")
		info.append(b, sub)
		const btn = document.createElement("button")
		btn.className = "ghost"
		btn.textContent = "👁 Watch"
		btn.onclick = () => (location.href = "/game?spectate=" + encodeURIComponent(g.code))
		row.append(info, btn)
		box.appendChild(row)
	})
}
loadLive()
setInterval(loadLive, 15_000)
