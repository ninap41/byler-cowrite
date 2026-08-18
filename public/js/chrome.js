// Shared page chrome for the multi-page app: decorative background layers,
// top bar (user chip + theme switch), and the hamburger nav drawer. Injected
// by every page so the markup lives in exactly one place.
import { towerSvg } from "./components/cleradin-tower.js"
import { clockSvg } from "./components/vecna-clock.js"
import { initTheme, THEMES, THEME_LABELS } from "./theme.js"
import { logoHtml, quillHtml } from "./logo.js"
import { initNav } from "./nav.js"
import { initBadgeTips } from "./badge-tips.js"
import { initTooltips } from "./tooltip.js"
import { safeColor, miniAvatar } from "./util.js"
import { mountTurnAlert } from "./turn-alert.js"
import { api, getToken, setToken } from "./api.js"

const BG = `
	<div class="bg-layers" aria-hidden="true">
		<div class="bg-wash"></div>
		<div class="bg-set neon">
			<div class="glow-sun"></div><div class="sun"></div><div class="stars"></div><div class="ripple"></div><div class="grid"></div><div class="scan"></div>
		</div>
		<div class="bg-set aurora">
			<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="orb o4"></div>
		</div>
		<div class="bg-set ink">
			<div class="blot b1"></div><div class="blot b2"></div><div class="paper"></div><div class="vignette"></div>
		</div>
		<div class="bg-set wall">
			<div class="wallpaper"></div><div class="lights"></div><div class="lights lights2"></div>
		</div>
		<div class="bg-set snowball">
			<div class="flakes f1"></div><div class="flakes f2"></div><div class="glint"></div>
		</div>
		<div class="bg-set upside">
			<div class="veins"></div><div class="mtn m1"></div><div class="mtn m2"></div>
			<div class="dust d1"></div><div class="dust d2"></div><div class="dust d3"></div>
			<div class="spore drift s1"></div><div class="spore drift s2"></div><div class="spore drift s3"></div><div class="spore drift s4"></div>
		</div>
		<div class="bg-set starcourt">
			<div class="sunset"></div>
			<div class="tri t1"></div><div class="tri t2"></div>
			<div class="ring r1"></div><div class="ring r2"></div>
			<div class="memdots"></div>
			<div class="zig z1"></div><div class="zig z2"></div>
			<div class="squiggle drift q1"></div><div class="squiggle drift q2"></div>
		</div>
		<div class="bg-set arcade">
			<div class="carpet"></div><div class="astars a1"></div><div class="astars a2"></div>
			<div class="fleet"><i class="galaga g1"></i><i class="galaga g2"></i><i class="galaga g3"></i><i class="galaga g4"></i></div>
			<div class="ship"></div><div class="shot"></div><div class="cab-glow drift"></div>
		</div>
		<div class="bg-set cerebro">
			<div class="waves"></div><div class="signal"></div><div class="signal signal2"></div>
		</div>
		<div class="bg-set hawkinslab">
			<div class="gates"></div><div class="danger"></div><div class="danger dl2"></div>
			<div class="hazmat h1 drift"></div><div class="hazmat h2 drift"></div><div class="rift"></div>
		</div>
		<div class="bg-set castlebyers">
			<div class="trees"></div><div class="fortpic"></div><div class="beam drift"></div>
		</div>
		<div class="bg-set vecna">
			<div class="clockface"></div><div class="cvines"></div>
			<div class="grandfather">${clockSvg()}</div>
			<div class="embers drift"></div>
		</div>
		<div class="bg-set void">
			<div class="stars"></div><div class="stars st2"></div>
			<div class="horizon"></div><div class="glare"></div>
			<div class="bolt"></div><div class="bolt bolt2"></div>
			<div class="mtns"></div><div class="rocks"></div>
		</div>
		<div class="bg-set video">
			<div class="vscan"></div><div class="track"></div><div class="vhsglow drift"></div>
		</div>
		<div class="bg-set hellfire">
			<div class="graph"></div><div class="fireglow"></div>
			<div class="flames"></div><div class="flames fl2"></div>
			<div class="hembers e1"></div><div class="hembers e2"></div>
			<div class="die d20a drift"></div><div class="die d20b drift"></div>
		</div>
		<div class="bg-set rink">
			<div class="rbow"></div><div class="zigzag"></div>
			<div class="specks p1"></div><div class="specks p2"></div><div class="sweep"></div>
		</div>
		<div class="bg-set cleradin">
			<div class="glimmer g1"></div><div class="glimmer g2"></div><div class="glimmer g3"></div>
			<div class="moon"></div><div class="mist"></div>
			<div class="moonglow"></div>
			<div class="castle c-far" data-par="0.08"></div>
			<div class="tower" data-par="auto">${towerSvg()}</div>
		</div>
		<div class="bg-set bunker">
			<div class="concrete"></div><div class="alarm"></div><div class="stencil"></div>
		</div>
		<div class="bg-set clouds">
			<div class="skyglow"></div>
			<div class="sparks s1"></div><div class="sparks s2"></div><div class="sparks s3"></div>
			<div class="cloud-band" data-depth="0"></div><div class="cloud-band" data-depth="1"></div>
			<div class="cloud-band" data-depth="2"></div><div class="cloud-band" data-depth="3"></div>
		</div>
		<div class="grain"></div>
	</div>`

const NAV = (page) => `
	<button type="button" class="hamburger" id="navBtn" aria-label="Menu" aria-expanded="false">
		<span class="bar"></span><span class="bar"></span><span class="bar"></span>
	</button>
	<div class="nav-scrim" id="navScrim"></div>
	<nav class="nav-drawer" id="navDrawer" aria-label="Main menu">
		<p class="nav-title">Menu</p>
		<a href="/dashboard" ${page === "dashboard" ? 'aria-current="page"' : ""}>🏠 Dashboard</a>
		<a href="/inbox" ${page === "inbox" ? 'aria-current="page"' : ""}>📬 Inbox</a>
		<a href="/game" ${page === "game" ? 'aria-current="page"' : ""}>✍️ Current game</a>
		<a href="/writes" ${page === "writes" || page === "write" ? 'aria-current="page"' : ""}>✒️ Solo writes</a>
		<a href="/archive" ${page === "archive" ? 'aria-current="page"' : ""}>📚 Previous games</a>
		<a href="/stories" ${page === "stories" ? 'aria-current="page"' : ""}>📖 All stories</a>
		<a href="/profile" ${page === "profile" ? 'aria-current="page"' : ""}>🏆 Profile</a>
		<a href="/settings" ${page === "settings" ? 'aria-current="page"' : ""}>⚙️ Settings</a>
		<a href="/admin" class="hidden" id="navAdmin" ${page === "admin" ? 'aria-current="page"' : ""}>🛡️ Admin</a>
		<button type="button" class="nav-logout" id="navLogout">🚪 Log out</button>
	</nav>`

const TOPBAR = `
	<div class="topbar">
		<a class="user-chip hidden" id="userChip" href="/profile" title="Your profile">
			<span id="ucAvatar"></span>
			<span id="ucName"></span>
			<span class="badge-chip" id="ucBadge"></span>
		</a>
		<div class="theme-switch" id="themeSwitch">
			<button type="button" class="theme-toggle" id="themeToggle" aria-haspopup="listbox" aria-expanded="false">
				<i class="sw sw-neon" id="themeCurSw"></i><span id="themeCurLabel">Neon Dusk</span><i class="chev">&#9662;</i>
			</button>
			<div class="theme-menu" id="themeMenu" role="listbox" aria-label="Theme">
				${THEMES.map(
					(id, i) =>
						`<button type="button" data-theme-btn="${id}"${i === 0 ? ' class="active"' : ""} role="option"><i class="sw sw-${id}"></i><span>${THEME_LABELS[id]}</span></button>`,
				).join("\n\t\t\t\t")}
			</div>
		</div>
	</div>`

// ---- the foot bar ----
// Two bits of site furniture that are nobody's main task — viewing the theme
// and tipping — used to be big floating chips parked over the page, where they
// covered modals and the corner of every layout. They now live in one thin
// sticky strip along the bottom: always reachable, never in the way.
export const FOOT_BAR = `<div class="foot-bar" id="footBar">
		<button type="button" class="foot-btn" id="peekBtn" aria-pressed="false" title="Hide the UI to view the theme">👁 <span id="peekLabel">View theme</span></button>
		<span class="foot-dot" aria-hidden="true">·</span>
		<button type="button" class="foot-btn" id="kofiBtn" title="Support Byler Cowrite on Ko-fi">☕ Support</button>
	</div>`

// Ko-fi. The floating widget script is gone: it drew its own iframe button
// wherever it liked, at a size and z-index we didn't control. Instead the tip
// jar is Ko-fi's own embeddable panel inside our modal — and the iframe is
// only created the first time someone asks for it, so no third-party script
// loads on a page view that never wanted one.
export const KOFI_ACCOUNT = "justthegatekeeper"
export const KOFI_PAGE = `https://ko-fi.com/${KOFI_ACCOUNT}`
export const KOFI_EMBED = `${KOFI_PAGE}/?hidefeed=true&widget=true&embed=true&preview=true`
export const KOFI_MODAL = `<div class="confirm-modal hidden" id="kofiModal">
		<div class="confirm-card kofi-card">
			<div class="kofi-head">
				<h3>☕ Support Byler Cowrite</h3>
				<button type="button" class="ghost kofi-x" id="kofiClose" aria-label="Close">✕</button>
			</div>
			<iframe id="kofiFrame" title="Ko-fi" loading="lazy"></iframe>
			<a class="linky kofi-out" href="${KOFI_PAGE}" target="_blank" rel="noopener noreferrer">Open Ko-fi in a new tab instead →</a>
		</div>
	</div>`

export function mountKofi(doc = document) {
	doc.body.insertAdjacentHTML("beforeend", KOFI_MODAL)
	const modal = doc.getElementById("kofiModal")
	const frame = doc.getElementById("kofiFrame")
	const close = () => modal.classList.add("hidden")
	const open = () => {
		if (!frame.getAttribute("src")) frame.setAttribute("src", KOFI_EMBED) // pay for it only when asked
		modal.classList.remove("hidden")
	}
	doc.getElementById("kofiBtn")?.addEventListener("click", open)
	doc.getElementById("kofiClose").addEventListener("click", close)
	modal.addEventListener("click", (e) => e.target === modal && close())
	doc.addEventListener("keydown", (e) => e.key === "Escape" && close())
	return { open, close, modal, frame }
}

// The mounted theme controller and the lock map, remembered so setUserChip can
// re-gate the menu the moment an account arrives.
let themeCtl = null
let themeLocks = {}

export function mountChrome({ page = "", nav = true, kofi = true } = {}) {
	document.body.insertAdjacentHTML("afterbegin", BG + (nav ? NAV(page) : "") + TOPBAR)
	// Castle Byers parallax: expose the scroll offset as a unitless CSS var;
	// the theme's tree/fort layers translate from it at different rates.
	const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	if (!reduceMotion) {
		let raf = 0
		const onScroll = () => {
			if (raf) return
			raf = requestAnimationFrame(() => {
				raf = 0
				document.documentElement.style.setProperty("--cb-scroll", window.scrollY)
			})
		}
		window.addEventListener("scroll", onScroll, { passive: true })
	}
	// Sun-spiral logo before the "Byler Cowrite" page title, quill after it.
	// The whole header is a link home (signed-in visitors bounce on to /dashboard).
	const h1 = document.querySelector(".wrap h1")
	if (h1 && !h1.querySelector(".brand-logo")) {
		h1.insertAdjacentHTML("afterbegin", logoHtml("hdr"))
		h1.insertAdjacentHTML("beforeend", quillHtml("hdrq"))
		h1.classList.add("brand-link")
		h1.setAttribute("role", "link")
		h1.setAttribute("tabindex", "0")
		h1.title = "Byler Cowrite — home"
		const go = () => (location.href = "/")
		h1.addEventListener("click", go)
		h1.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault()
				go()
			}
		})
	}
	// Theme peek lives in the foot bar: it hides every UI layer (content,
	// topbar, nav, toasts) so the theme background can be admired. The bar
	// itself stays — it's the way back — and the game chat dock deliberately
	// stays visible too.
	document.body.insertAdjacentHTML("beforeend", FOOT_BAR)
	const peekBtn = document.getElementById("peekBtn")
	// GSAP eases the UI layers out/in around the visibility flip; without
	// GSAP (or with reduced motion) the class toggle alone does the job.
	const PEEK_LAYERS = ".wrap, .topbar, .hamburger"
	peekBtn.addEventListener("click", () => {
		const on = !document.body.classList.contains("ui-peek")
		peekBtn.setAttribute("aria-pressed", String(on))
		document.getElementById("peekLabel").textContent = on ? "Show UI" : "View theme"
		const g = window.gsap
		if (!g || reduceMotion) return document.body.classList.toggle("ui-peek", on)
		g.killTweensOf(PEEK_LAYERS)
		if (on) {
			g.to(PEEK_LAYERS, {
				opacity: 0,
				y: 16,
				duration: 0.35,
				ease: "power2.in",
				onComplete: () => {
					document.body.classList.add("ui-peek")
					g.set(PEEK_LAYERS, { clearProps: "opacity,transform" })
				},
			})
		} else {
			document.body.classList.remove("ui-peek")
			g.fromTo(
				PEEK_LAYERS,
				{ opacity: 0, y: 16 },
				{ opacity: 1, y: 0, duration: 0.45, ease: "power2.out", clearProps: "opacity,transform" },
			)
		}
	})
	// Drawer logout (bottom-right): signed-out visitors just don't see it.
	const navLogout = document.getElementById("navLogout")
	if (navLogout) {
		if (!getToken()) navLogout.classList.add("hidden")
		else
			navLogout.onclick = async () => {
				try {
					await api("/api/logout")
				} catch (e) {}
				setToken(null)
				location.href = "/"
			}
	}
	const theme = initTheme()
	// Themes are rank rewards, so the menu has to know what this account has
	// earned. Signed out (or offline) it shows the free set and nothing breaks.
	themeCtl = theme
	api("/api/themes", null, "GET")
		.then((d) => {
			themeLocks = d.locks || {}
			theme.setGate(d)
		})
		.catch(() => {})
	const tips = initTooltips() // instant, theme-aware tooltips (js/tooltip.js)
	initBadgeTips(document, tips) // hover any badge chip for its description
	if (nav) initNav()
	if (kofi) mountKofi()
	// off the game page, a poller pins the "your turn" toast with a link in
	if (page !== "game") mountTurnAlert()
	return theme
}

export function setUserChip(user) {
	const chip = document.getElementById("userChip")
	if (!chip) return
	if (!user) return chip.classList.add("hidden")
	chip.classList.remove("hidden")
	document.getElementById("ucAvatar").innerHTML = miniAvatar(user)
	const name = document.getElementById("ucName")
	name.textContent = user.username
	name.style.color = safeColor(user.color)
	// just the rank emoji in the bar; the full badge name rides the tooltip
	const badge = user.currentBadge || ""
	const ucBadge = document.getElementById("ucBadge")
	ucBadge.textContent = badge ? badge.trim().split(/\s+/)[0] : "no badge yet"
	if (badge) ucBadge.dataset.tip = badge
	// The admin entrance only appears for admin accounts. Hiding it is
	// cosmetic — every /api/admin route checks the account itself.
	if (user.admin) document.getElementById("navAdmin")?.classList.remove("hidden")
	// /api/me already carries the themes this rank has earned, so signing in
	// re-gates the menu without a second round trip.
	if (user.themes && themeCtl) themeCtl.setGate({ locks: themeLocks, unlocked: user.themes })
}
