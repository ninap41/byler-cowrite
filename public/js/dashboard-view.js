// Dashboard render helpers (pure string builders — testable without a page).
import { esc, safeColor } from "./util.js"

export function onlineUsersHtml(users) {
	return (
		users
			.map(
				(u) =>
					`<span class="player-chip"><span class="st-dot on" title="Online"></span>` +
					`<span style="color:${safeColor(u.color)}">${esc(u.username)}${u.me ? " (you)" : ""}</span>` +
					`${u.badge ? `<span class="badge-chip">${esc(u.badge)}</span>` : ""}</span>`,
			)
			.join("") || '<span class="subtle">Nobody online right now.</span>'
	)
}

const PHASES = { waiting: "gathering writers", choosing: "voting", writing: "writing" }

export function liveGameInfoHtml(g) {
	const on = g.players.filter((pl) => pl.connected).length
	return (
		`<span class="lg-info"><b>${esc(g.name || g.code)}</b>` +
		`<span class="lg-sub">${esc(g.code)} · ${PHASES[g.phase] || g.phase}` +
		`${g.hostName ? " · 👑 " + esc(g.hostName) : ""} · ${on}/${g.players.length} online · ` +
		`${esc(g.players.map((pl) => pl.name).join(", "))}</span></span>`
	)
}

export function statsText(u) {
	return (
		`${u.wordCount} words written · ${u.badges.length} badge${u.badges.length === 1 ? "" : "s"}` +
		(u.nextBadge
			? ` · ${u.nextBadge.min - u.wordCount} word${u.nextBadge.min - u.wordCount === 1 ? "" : "s"} to ${u.nextBadge.name}`
			: "")
	)
}
