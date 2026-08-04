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
				`<div class="tier${earned ? " earned" : ""}${current ? " current" : ""}" title="${esc(t.desc || "")}">` +
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

// The ladder, folded: only the CURRENT rank shows; every other tier lives
// behind an accordion.
export function ladderAccordionHtml(tiers, u) {
	const cur = tiers.filter((t) => u.currentBadge === t.name)
	return (
		(cur.length ? ladderHtml(cur, u) : "") +
		`<details class="ladder-acc"><summary>All ranks</summary>${ladderHtml(tiers, u)}</details>`
	)
}

// The About section: bio with inline <img> embeds + up to three links.
// p.about is already server-sanitized (sanitizeAbout: everything escaped,
// only validated <img src="http(s)…"> re-enabled) — inject it as-is, exactly
// like story lines. Link labels/urls are still escaped here.
export function aboutHtml(p) {
	const about = p.about
		? `<div class="about-text">${p.about}</div>`
		: `<p class="subtle" style="text-align:left;margin:8px 0 0">Nothing here yet.</p>`
	const links = (p.links || [])
		.map((l) => `<a class="about-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">🔗 ${esc(l.label)}</a>`)
		.join("")
	return about + (links ? `<div class="about-links">${links}</div>` : "")
}

// Avatar helper: external picture when set (fit per user preference),
// otherwise the tinted initial.
export function avatarHtml(p) {
	return p.avatar
		? `<img class="avatar-img fit-${p.avatarFit === "contain" ? "contain" : "cover"}" src="${esc(p.avatar)}" alt="" loading="lazy">`
		: esc((p.username || "?").charAt(0).toUpperCase())
}

// The usage-badge case: every collectible is listed with its description as
// a tooltip (what it means + how to earn it, straight from achievements.json);
// earned ones glow, unearned ones sit locked.
export function usageCaseHtml(allUsage, earnedNames) {
	return allUsage
		.map((b) => {
			const earned = earnedNames.includes(b.name)
			return `<span class="ach ${earned ? "earned" : "next"}" title="${esc(b.desc || "")}">${earned ? "" : "🔒 "}${esc(b.name)}</span>`
		})
		.join("")
}
