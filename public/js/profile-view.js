// Profile render helpers (pure string builders).
import { esc } from "./util.js"

// The word-count ladder: every tier as a row — earned, current (highest
// earned), or upcoming with a progress bar on the next one to reach.
export function ladderHtml(tiers, u) {
	const nextMin = tiers.find((t) => u.wordCount < t.min)?.min
	return tiers
		.map((t) => {
			const earned = u.wordBadges.includes(t.name)
			const current = u.currentBadge === t.name
			const isNext = t.min === nextMin
			const pct = isNext ? Math.min(99, Math.floor((u.wordCount / t.min) * 100)) : earned ? 100 : 0
			return (
				`<div class="tier${earned ? " earned" : ""}${current ? " current" : ""}">` +
				`<span class="tier-name">${esc(t.name)}</span>` +
				`<span class="tier-min">${t.min.toLocaleString()} words</span>` +
				(isNext
					? `<span class="tier-bar"><i style="width:${pct}%"></i></span><span class="tier-pct">${pct}%</span>`
					: `<span class="tier-state">${earned ? (current ? "current rank" : "earned") : "locked"}</span>`) +
				`</div>`
			)
		})
		.join("")
}

// The usage-badge case: earned collectibles + mystery slots for the rest.
// Triggers are never shown — finding them is the game.
export function usageCaseHtml(earnedNames, totalCount) {
	const earned = earnedNames.map((n) => `<span class="ach earned">${esc(n)}</span>`).join("")
	const locked = Array.from(
		{ length: Math.max(0, totalCount - earnedNames.length) },
		() => `<span class="ach next" title="Secret — earn it by writing the right thing">？ hidden badge</span>`,
	).join("")
	return earned + locked
}
