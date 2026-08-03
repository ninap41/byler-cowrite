// Shared page chrome for the multi-page app: decorative background layers,
// top bar (user chip + theme switch), and the hamburger nav drawer. Injected
// by every page so the markup lives in exactly one place.
import { initTheme, THEMES, THEME_LABELS } from "./theme.js"
import { initNav } from "./nav.js"
import { safeColor } from "./util.js"

const BG = `
	<div class="bg-layers" aria-hidden="true">
		<div class="bg-wash"></div>
		<div class="bg-set neon">
			<div class="glow-sun"></div><div class="sun"></div><div class="stars"></div><div class="grid"></div><div class="scan"></div>
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
			<div class="veins"></div><div class="mtn m1"></div><div class="mtn m2"></div><div class="vines"></div>
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
		<a href="/game" ${page === "game" ? 'aria-current="page"' : ""}>✍️ Current game</a>
		<a href="/archive" ${page === "archive" ? 'aria-current="page"' : ""}>📚 Previous games</a>
		<a href="/profile" ${page === "profile" ? 'aria-current="page"' : ""}>🏆 Profile</a>
		<a href="/settings" ${page === "settings" ? 'aria-current="page"' : ""}>⚙️ Settings</a>
	</nav>`

const TOPBAR = `
	<div class="topbar">
		<div class="user-chip hidden" id="userChip">
			<span id="ucName"></span>
			<span class="badge-chip" id="ucBadge"></span>
		</div>
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

// Ko-fi tip widget (floating chat button, bottom-left) — loaded on every page.
export const KOFI_ACCOUNT = "justthegatekeeper"
export const KOFI_CONFIG = {
	type: "floating-chat",
	"floating-chat.donateButton.text": "Support me",
	"floating-chat.donateButton.background-color": "#00b9fe",
	"floating-chat.donateButton.text-color": "#fff",
}
export function mountKofi(doc = document) {
	const s = doc.createElement("script")
	s.src = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js"
	s.async = true
	s.onload = () => {
		try {
			;(doc.defaultView || window).kofiWidgetOverlay?.draw(KOFI_ACCOUNT, KOFI_CONFIG)
		} catch (e) {}
	}
	doc.body.appendChild(s)
	return s
}

export function mountChrome({ page = "", nav = true, kofi = true } = {}) {
	document.body.insertAdjacentHTML("afterbegin", BG + (nav ? NAV(page) : "") + TOPBAR)
	const theme = initTheme()
	if (nav) initNav()
	if (kofi) mountKofi()
	return theme
}

export function setUserChip(user) {
	const chip = document.getElementById("userChip")
	if (!chip) return
	if (!user) return chip.classList.add("hidden")
	chip.classList.remove("hidden")
	const name = document.getElementById("ucName")
	name.textContent = user.username
	name.style.color = safeColor(user.color)
	document.getElementById("ucBadge").textContent = user.currentBadge || "no badge yet"
}
