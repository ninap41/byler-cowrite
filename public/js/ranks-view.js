// The ranks & unlocks page's pure string builders (/ranks, public/ranks.html).
// Everything here is DATA-DRIVEN from the three public endpoints — the rank
// ladder from /api/achievements, theme locks from /api/themes, the gimmick
// catalogue + locks from /api/gimmicks — plus the theme labels the theme menu
// already uses, so a future fandom pack that swaps achievements.json /
// prompts.json / the gimmick registry redraws this page without a code change.
// No DOM at top level: the page mounts these, tests read them.
import { esc } from "./util.js"

// Theme screenshots live at /img/themes/<themeId>.jpg (captured with the foot
// bar's View-theme peek). A missing shot degrades to a labelled swatch card —
// the page must never break on a theme pack that ships no images.
export const themeShotSrc = (themeId) => `/img/themes/${encodeURIComponent(themeId)}.jpg`

const fmtWords = (n) => Number(n || 0).toLocaleString()

// ---- joining the three endpoints into one ladder ----
// tiers: [{id, name, min, desc}] (rank order). themeLocks: {themeId: tierId}.
// gimmicks: the catalogue [{id, icon, name, theme, desc}]; a gimmick rides its
// theme's tier (gimmickLocks mirrors that server-side, but the catalogue +
// themeLocks is enough to place it). Returns rows the ladder builder eats.
// A lock's value is `{tier, name, min}` off the wire (themeLocks() /
// gimmickLocks() server-side) but a bare tier-id string also works, so a
// hand-rolled fandom pack can ship the simpler shape.
const lockTier = (v) => (typeof v === "string" ? v : v?.tier)

export function buildLadder({ tiers = [], themeLocks = {}, themeLabels = {}, gimmicks = [] } = {}) {
	const gimmickByTheme = new Map(gimmicks.map((g) => [g.theme, g]))
	return tiers.map((t) => {
		const themes = Object.entries(themeLocks)
			.filter(([, v]) => lockTier(v) === t.id)
			.map(([themeId]) => ({
				id: themeId,
				label: themeLabels[themeId] || themeId,
				gimmick: gimmickByTheme.get(themeId) || null,
			}))
		return { ...t, themes, gimmicks: themes.map((th) => th.gimmick).filter(Boolean) }
	})
}

// Themes that no tier claims are free for everyone (the default set).
export const freeThemes = (allThemes = [], themeLocks = {}, themeLabels = {}) =>
	allThemes.filter((id) => !(id in themeLocks)).map((id) => ({ id, label: themeLabels[id] || id }))

// ---- the pieces ----
export function themeThumbHtml(theme, { unlocked = false } = {}) {
	return `<figure class="rk-theme${unlocked ? " unlocked" : ""}" data-theme-id="${esc(theme.id)}">
		<img src="${themeShotSrc(theme.id)}" alt="${esc(theme.label)} theme" loading="lazy"
			onerror="this.closest('.rk-theme').classList.add('noshot'); this.remove()" />
		<figcaption>${unlocked ? "✓ " : "🔒 "}${esc(theme.label)}</figcaption>
	</figure>`
}

export function gimmickChipHtml(g, { unlocked = false } = {}) {
	return `<span class="rk-gimmick-chip${unlocked ? " unlocked" : ""}" title="${esc(g.desc || "")}">${esc(g.icon || "🎁")} ${esc(g.name)}</span>`
}

// One rung of the ladder. `me` (optional): {wordCount} decides earned/next.
export function tierCardHtml(tier, { me = null, unlockedThemes = [], current = false } = {}) {
	const earned = me ? Number(me.wordCount || 0) >= tier.min : false
	const themes = tier.themes
		.map((th) => themeThumbHtml(th, { unlocked: unlockedThemes.includes(th.id) }))
		.join("")
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
export function ladderHtml(rows, { me = null, unlockedThemes = [] } = {}) {
	const words = Number(me?.wordCount || 0)
	// the CURRENT rung: the highest tier the writer has reached
	let currentId = null
	if (me) for (const r of rows) if (words >= r.min) currentId = r.id
	return rows.map((r) => tierCardHtml(r, { me, unlockedThemes, current: r.id === currentId })).join("")
}

// The writer's own progress toward the next rung (null signed out or maxed).
export function progressHtml(rows, me) {
	if (!me) return `<p class="rk-signin subtle">Sign in to track your own climb — every word you write in a game counts.</p>`
	const words = Number(me.wordCount || 0)
	const next = rows.find((r) => r.min > words)
	if (!next) return `<p class="rk-progress-line">🌀 ${fmtWords(words)} words — the ladder is yours. There's nothing left to unlock.</p>`
	const prevMin = [...rows].reverse().find((r) => r.min <= words)?.min ?? 0
	const pct = Math.max(0, Math.min(100, Math.round(((words - prevMin) / Math.max(1, next.min - prevMin)) * 100)))
	return `<div class="rk-progress">
		<p class="rk-progress-line">${fmtWords(words)} words · ${fmtWords(next.min - words)} to go for <b>${esc(next.name)}</b></p>
		<div class="rank-bar rk-bar"><i style="width:${pct}%"></i></div>
	</div>`
}

// ---- word badges (usage achievements) ----
// Secret ones ship only a name until earned (the earned desc arrives on the
// account as badgeDescs); open ones always show their descriptions.
// `recipe` is the admin's view: the triggers/combos the server only sends
// an admin, shown under the description so they can see how every badge is
// earned — the page still keeps secrets from everyone else.
export const recipeText = ({ triggers = [], combos = [] } = {}) =>
	[...triggers, ...combos.map((c) => (Array.isArray(c) ? c.join(" + ") : String(c)))].join(" · ")

export function usageBadgeHtml({ name, desc = "", secret = false, earned = false, recipe = null }) {
	const text = earned || !secret || recipe ? desc : "Secret — the right words in a story line unlock it."
	const how = recipe && recipeText(recipe) ? `<p class="rk-recipe">🛡️ Unlocks with: ${esc(recipeText(recipe))}</p>` : ""
	return `<article class="rk-usage${earned ? " earned" : ""}${secret && !earned && !recipe ? " mystery" : ""}">
		<b>${esc(name)}</b>
		<p>${esc(text)}</p>${how}
		${earned ? '<span class="rk-earned">✓ earned</span>' : ""}
	</article>`
}

export function usageListHtml({ usage = [], usageOpen = [] }, me = null) {
	const earnedNames = new Set(me?.badges || [])
	const descs = me?.badgeDescs || {}
	// an admin's payload carries desc + triggers on every badge; anyone else's doesn't
	const recipeOf = (b) => (b.triggers || b.combos ? { triggers: b.triggers || [], combos: b.combos || [] } : null)
	const cards = [
		...usage.map((b) => ({ name: b.name, secret: true, earned: earnedNames.has(b.name), desc: descs[b.name] || b.desc || "", recipe: recipeOf(b) })),
		...usageOpen.map((b) => ({ name: b.name, secret: false, earned: earnedNames.has(b.name), desc: b.desc || "", recipe: recipeOf(b) })),
	]
	return cards.map(usageBadgeHtml).join("")
}

// ---- the gimmick rundown ----
export function gimmickCardHtml(g, { tierName = "", tierMin = null, unlocked = false, themeLabel = "" } = {}) {
	const gate =
		tierName
			? `${unlocked ? "✓ yours" : "🔒 unlocks"} with the ${esc(themeLabel || g.theme)} theme at <b>${esc(tierName)}</b>${tierMin ? ` (${fmtWords(tierMin)} words)` : ""}`
			: "free for every account"
	return `<article class="rk-gimmick${unlocked ? " earned" : ""}" data-gimmick="${esc(g.id)}">
		<header><span class="rk-gicon">${esc(g.icon || "🎁")}</span><b>${esc(g.name)}</b></header>
		<p class="rk-desc">${esc(g.desc || "")}</p>
		<p class="rk-gate">${gate}</p>
	</article>`
}

export function gimmickListHtml({ catalogue = [], locks = {}, unlocked = [], admin = false }, { tiers = [], themeLabels = {} } = {}) {
	const tierById = new Map(tiers.map((t) => [t.id, t]))
	return catalogue
		.map((g) => {
			const tier = tierById.get(lockTier(locks[g.id])) || null
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
export function freeThemesHtml(free) {
	// a free theme is everyone's by definition
	return free.map((th) => themeThumbHtml(th, { unlocked: true })).join("")
}
