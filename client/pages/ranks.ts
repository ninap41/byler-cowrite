import { api, getToken } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { THEMES, THEME_LABELS } from "/js/theme.js"
import {
	buildLadder, ladderHtml, progressHtml, freeThemes, freeThemesHtml,
	usageListHtml, gimmickListHtml,
} from "/js/ranks-view.js"
import type { Tier, Lock, GimmickGate, MeStats, UsageBadgeRow } from "/js/ranks-view.js"
import type { ChipUser } from "/js/chrome.js"

/** /api/me's user, as this page reads it: the topbar chip plus the rank stats. */
type Me = ChipUser & MeStats
interface AchievementsPayload {
	wordTiers: Tier[]
	usage?: UsageBadgeRow[]
	usageOpen?: UsageBadgeRow[]
}
interface ThemesPayload {
	locks: Record<string, Lock>
	unlocked?: string[]
	admin?: boolean
}

mountChrome({ page: "ranks" })

// The page is viewable signed out (everything shows, all locked) —
// signed in it marks what's yours and how far the next rung is.
let me: Me | null = null
if (getToken()) {
	try {
		const d = await api<{ user: Me }>("/api/me", null, "GET")
		me = d.user
		setUserChip(me)
	} catch (e) {}
}

const [ach, themes, gimmicks] = await Promise.all([
	api<AchievementsPayload>("/api/achievements", null, "GET"),
	api<ThemesPayload>("/api/themes", null, "GET"),
	api<GimmickGate>("/api/gimmicks", null, "GET"),
])

const rows = buildLadder({
	tiers: ach.wordTiers,
	themeLocks: themes.locks,
	themeLabels: THEME_LABELS,
	gimmicks: gimmicks.catalogue,
})
const unlockedThemes: readonly string[] = themes.admin ? THEMES : themes.unlocked || []

document.getElementById("rkProgress")!.innerHTML = progressHtml(rows, me)
document.getElementById("rkLadder")!.innerHTML = ladderHtml(rows, { me, unlockedThemes })
document.getElementById("rkFree")!.innerHTML = freeThemesHtml(freeThemes(THEMES, themes.locks, THEME_LABELS))
document.getElementById("rkGimmicks")!.innerHTML = gimmickListHtml(gimmicks, { tiers: ach.wordTiers, themeLabels: THEME_LABELS })
document.getElementById("rkUsage")!.innerHTML = usageListHtml(ach, me)

// clicking a theme card tries it on (the theme menu's own gate still
// applies — a locked theme bounces back, which is its own answer)
document.addEventListener("click", (e) => {
	const fig = (e.target as HTMLElement).closest<HTMLElement>(".rk-theme[data-theme-id]")
	if (!fig) return
	document.documentElement.setAttribute("data-theme", fig.dataset.themeId || "")
})
