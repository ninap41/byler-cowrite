// The ranks & unlocks page's pure string builders (/ranks, public/ranks.html).
// Everything here is DATA-DRIVEN from the three public endpoints — the rank
// ladder from /api/achievements, theme locks from /api/themes, the gimmick
// catalogue + locks from /api/gimmicks — plus the theme labels the theme menu
// already uses, so a future fandom pack that swaps achievements.json /
// prompts.json / the gimmick registry redraws this page without a code change.
// No DOM at top level: the page mounts these, tests read them.
import { esc } from "./util.js"

export interface Tier {
	id: string
	name: string
	min: number
	desc?: string
}
/** A gimmick as the /api/gimmicks catalogue lists it (lib/gimmicks.js). */
export interface GimmickDef {
	id: string
	icon?: string
	name: string
	theme: string
	desc?: string
}
/** A lock off the wire is `{tier, name, min}`; a bare tier-id string also works (a hand-rolled pack). */
export type Lock = { tier: string; name?: string; min?: number } | string
export interface ThemeRow {
	id: string
	label: string
	gimmick?: GimmickDef | null
}
/** One rung: the tier plus the themes and gimmicks it hands out. */
export interface LadderRow extends Tier {
	themes: ThemeRow[]
	gimmicks: GimmickDef[]
}
/** The slice of the signed-in account the page reads. */
export interface MeStats {
	wordCount?: number
	badges?: string[]
	badgeDescs?: Record<string, string | null | undefined>
}

// Theme screenshots live at /img/themes/<themeId>.jpg (captured with the foot
// bar's View-theme peek). A missing shot degrades to a labelled swatch card —
// the page must never break on a theme pack that ships no images.
export const themeShotSrc = (themeId: string): string => `/img/themes/${encodeURIComponent(themeId)}.jpg`

const fmtWords = (n: unknown): string => Number(n || 0).toLocaleString()

// ---- joining the three endpoints into one ladder ----
const lockTier = (v: Lock | undefined): string | undefined => (typeof v === "string" ? v : v?.tier)

export interface LadderInput {
	tiers?: Tier[]
	themeLocks?: Record<string, Lock>
	themeLabels?: Record<string, string>
	gimmicks?: GimmickDef[]
}
// tiers (rank order), themeLocks {themeId: lock}, the gimmick catalogue — a
// gimmick rides its theme's tier (gimmickLocks mirrors that server-side, but
// the catalogue + themeLocks is enough to place it). Returns the ladder rows.
export function buildLadder({ tiers = [], themeLocks = {}, themeLabels = {}, gimmicks = [] }: LadderInput = {}): LadderRow[] {
	const gimmickByTheme = new Map(gimmicks.map((g) => [g.theme, g]))
	return tiers.map((t) => {
		const themes: ThemeRow[] = Object.entries(themeLocks)
			.filter(([, v]) => lockTier(v) === t.id)
			.map(([themeId]) => ({ id: themeId, label: themeLabels[themeId] || themeId, gimmick: gimmickByTheme.get(themeId) || null }))
		return { ...t, themes, gimmicks: themes.map((th) => th.gimmick).filter((g): g is GimmickDef => !!g) }
	})
}

// Themes that no tier claims are free for everyone (the default set).
export const freeThemes = (allThemes: readonly string[] = [], themeLocks: Record<string, Lock> = {}, themeLabels: Record<string, string> = {}): ThemeRow[] =>
	allThemes.filter((id) => !(id in themeLocks)).map((id) => ({ id, label: themeLabels[id] || id }))

// ---- the pieces ----
export function themeThumbHtml(theme: ThemeRow, { unlocked = false }: { unlocked?: boolean } = {}): string {
	return `<figure class="rk-theme${unlocked ? " unlocked" : ""}" data-theme-id="${esc(theme.id)}">
		<img src="${themeShotSrc(theme.id)}" alt="${esc(theme.label)} theme" loading="lazy"
			onerror="this.closest('.rk-theme').classList.add('noshot'); this.remove()" />
		<figcaption>${unlocked ? "✓ " : "🔒 "}${esc(theme.label)}</figcaption>
	</figure>`
}

export function gimmickChipHtml(g: GimmickDef, { unlocked = false }: { unlocked?: boolean } = {}): string {
	return `<span class="rk-gimmick-chip${unlocked ? " unlocked" : ""}" title="${esc(g.desc || "")}">${esc(g.icon || "🎁")} ${esc(g.name)}</span>`
}

export interface TierCardOpts {
	me?: MeStats | null
	unlockedThemes?: readonly string[]
	current?: boolean
}
// One rung of the ladder. `me` (optional): {wordCount} decides earned/next.
export function tierCardHtml(tier: LadderRow, { me = null, unlockedThemes = [], current = false }: TierCardOpts = {}): string {
	const earned = me ? Number(me.wordCount || 0) >= tier.min : false
	const themes = tier.themes.map((th) => themeThumbHtml(th, { unlocked: unlockedThemes.includes(th.id) })).join("")
	const gims = tier.gimmicks.map((g) => gimmickChipHtml(g, { unlocked: earned })).join("")
	return `<article class="rk-tier${earned ? " earned" : ""}${current ? " current" : ""}" data-tier="${esc(tier.id)}">
		<header class="rk-tier-head">
			<b class="rk-badge">${esc(tier.name)}</b>
			<span class="rk-words">${tier.min === 0 ? "Sign up" : fmtWords(tier.min) + " words"}</span>
			${earned ? '<span class="rk-earned">✓ earned</span>' : ""}
		</header>
		<p class="rk-desc">${esc(tier.desc || "")}</p>
		${themes ? `<div class="rk-themes">${themes}</div>` : ""}
		${gims ? `<div class="rk-gimmicks">${gims}</div>` : ""}
	</article>`
}

// The whole ladder. rows come from buildLadder(); unlockedThemes from
// /api/themes (already reflects admin); me from /api/me (or null signed out).
export function ladderHtml(rows: LadderRow[], { me = null, unlockedThemes = [] }: Pick<TierCardOpts, "me" | "unlockedThemes"> = {}): string {
	const words = Number(me?.wordCount || 0)
	// the CURRENT rung: the highest tier the writer has reached
	let currentId: string | null = null
	if (me) for (const r of rows) if (words >= r.min) currentId = r.id
	return rows.map((r) => tierCardHtml(r, { me, unlockedThemes, current: r.id === currentId })).join("")
}

// The writer's own progress toward the next rung (null signed out or maxed).
export function progressHtml(rows: Tier[], me: MeStats | null | undefined): string {
	if (!me) return `<p class="rk-signin subtle">Sign in to track your own climb, every word you write in a game counts.</p>`
	const words = Number(me.wordCount || 0)
	const next = rows.find((r) => r.min > words)
	if (!next) return `<p class="rk-progress-line">🌀 ${fmtWords(words)} words: the ladder is yours. There's nothing left to unlock.</p>`
	const prevMin = [...rows].reverse().find((r) => r.min <= words)?.min ?? 0
	const pct = Math.max(0, Math.min(100, Math.round(((words - prevMin) / Math.max(1, next.min - prevMin)) * 100)))
	return `<div class="rk-progress">
		<p class="rk-progress-line">${fmtWords(words)} words · ${fmtWords(next.min - words)} to go for <b>${esc(next.name)}</b></p>
		<div class="rank-bar rk-bar"><i style="width:${pct}%"></i></div>
	</div>`
}

// ---- word badges (usage achievements) ----
export interface Recipe {
	triggers?: string[]
	combos?: (string[] | string)[]
}
/** A usage badge as /api/achievements ships it; an admin's carries the recipe too. */
export interface UsageBadgeRow extends Recipe {
	name: string
	desc?: string
}
// Secret ones ship only a name until earned (the earned desc arrives on the
// account as badgeDescs); open ones always show their descriptions.
// `recipe` is the admin's view: the triggers/combos the server only sends
// an admin, shown under the description so they can see how every badge is
// earned — the page still keeps secrets from everyone else.
export const recipeText = ({ triggers = [], combos = [] }: Recipe = {}): string =>
	[...triggers, ...combos.map((c) => (Array.isArray(c) ? c.join(" + ") : String(c)))].join(" · ")

export interface UsageCard {
	name: string
	desc?: string
	secret?: boolean
	earned?: boolean
	recipe?: Recipe | null
}
export function usageBadgeHtml({ name, desc = "", secret = false, earned = false, recipe = null }: UsageCard): string {
	const text = earned || !secret || recipe ? desc : "Secret: the right words in a story line unlock it."
	const how = recipe && recipeText(recipe) ? `<p class="rk-recipe">🛡️ Unlocks with: ${esc(recipeText(recipe))}</p>` : ""
	return `<article class="rk-usage${earned ? " earned" : ""}${secret && !earned && !recipe ? " mystery" : ""}">
		<b>${esc(name)}</b>
		<p>${esc(text)}</p>${how}
		${earned ? '<span class="rk-earned">✓ earned</span>' : ""}
	</article>`
}

export function usageListHtml({ usage = [], usageOpen = [] }: { usage?: UsageBadgeRow[]; usageOpen?: UsageBadgeRow[] }, me: MeStats | null = null): string {
	const earnedNames = new Set(me?.badges || [])
	const descs = me?.badgeDescs || {}
	// an admin's payload carries desc + triggers on every badge; anyone else's doesn't
	const recipeOf = (b: UsageBadgeRow): Recipe | null => (b.triggers || b.combos ? { triggers: b.triggers || [], combos: b.combos || [] } : null)
	const cards: UsageCard[] = [
		...usage.map((b) => ({ name: b.name, secret: true, earned: earnedNames.has(b.name), desc: descs[b.name] || b.desc || "", recipe: recipeOf(b) })),
		...usageOpen.map((b) => ({ name: b.name, secret: false, earned: earnedNames.has(b.name), desc: b.desc || "", recipe: recipeOf(b) })),
	]
	return cards.map(usageBadgeHtml).join("")
}

// ---- the gimmick rundown ----
export interface GimmickCardOpts {
	tierName?: string
	tierMin?: number | null
	unlocked?: boolean
	themeLabel?: string
}
export function gimmickCardHtml(g: GimmickDef, { tierName = "", tierMin = null, unlocked = false, themeLabel = "" }: GimmickCardOpts = {}): string {
	const gate = tierName
		? `${unlocked ? "✓ yours" : "🔒 unlocks"} with the ${esc(themeLabel || g.theme)} theme at <b>${esc(tierName)}</b>${tierMin ? ` (${fmtWords(tierMin)} words)` : ""}`
		: "free for every account"
	return `<article class="rk-gimmick${unlocked ? " earned" : ""}" data-gimmick="${esc(g.id)}">
		<header><span class="rk-gicon">${esc(g.icon || "🎁")}</span><b>${esc(g.name)}</b></header>
		<p class="rk-desc">${esc(g.desc || "")}</p>
		<p class="rk-gate">${gate}</p>
	</article>`
}

/** The /api/gimmicks payload: what exists, what's locked behind which tier, what the viewer has. */
export interface GimmickGate {
	catalogue?: GimmickDef[]
	locks?: Record<string, Lock>
	unlocked?: readonly string[]
	admin?: boolean
}
export function gimmickListHtml({ catalogue = [], locks = {}, unlocked = [], admin = false }: GimmickGate, { tiers = [], themeLabels = {} }: { tiers?: Tier[]; themeLabels?: Record<string, string> } = {}): string {
	const tierById = new Map(tiers.map((t) => [t.id, t]))
	return catalogue
		.map((g) => {
			const tier = tierById.get(lockTier(locks[g.id]) ?? "") || null
			return gimmickCardHtml(g, {
				tierName: tier?.name || "",
				tierMin: tier?.min ?? null,
				unlocked: admin || unlocked.includes(g.id),
				themeLabel: themeLabels[g.theme] || g.theme,
			})
		})
		.join("")
}

// ---- free themes strip ----
export function freeThemesHtml(free: ThemeRow[]): string {
	// a free theme is everyone's by definition
	return free.map((th) => themeThumbHtml(th, { unlocked: true })).join("")
}
