// Shared page chrome for the multi-page app: decorative background layers,
// top bar (user chip + theme switch), and the hamburger nav drawer. Injected
// by every page so the markup lives in exactly one place.
import { initTheme } from "./theme.js"
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
				<button type="button" data-theme-btn="neon" class="active" role="option"><i class="sw sw-neon"></i><span>Neon Dusk</span></button>
				<button type="button" data-theme-btn="aurora" role="option"><i class="sw sw-aurora"></i><span>Aurora</span></button>
				<button type="button" data-theme-btn="ink" role="option"><i class="sw sw-ink"></i><span>Inkwell</span></button>
			</div>
		</div>
	</div>`

export function mountChrome({ page = "", nav = true } = {}) {
	document.body.insertAdjacentHTML("afterbegin", BG + (nav ? NAV(page) : "") + TOPBAR)
	const theme = initTheme()
	if (nav) initNav()
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
