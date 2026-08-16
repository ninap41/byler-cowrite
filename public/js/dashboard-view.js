// Dashboard render helpers (pure string builders — testable without a page).
import { esc, safeColor, PALETTE, miniAvatar } from "./util.js"

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
		`${g.hostName ? " · " + esc(g.hostName) + " (host)" : ""} · ${on}/${g.players.length} online · ` +
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

// Progress toward the next badge tier (100 when the ladder is topped out).
// The label carries the real word counts — "8 / 5,000 words" reads as
// progress even when the percentage rounds to zero; any words at all show
// at least a sliver of fill.
// Progress = words-to-next-rank subtracted from total words written,
// as a share of the next rank's threshold.
export function badgeProgress(u) {
	if (!u.nextBadge) return { pct: 100, label: "top of the ladder" }
	const toGo = Math.max(0, u.nextBadge.min - u.wordCount)
	const banked = Math.max(0, u.wordCount - toGo)
	const pct = Math.max(0, Math.min(99, Math.floor((banked / u.nextBadge.min) * 100)))
	return {
		pct: u.wordCount > 0 ? Math.max(pct, 1) : 0,
		label: `${u.wordCount.toLocaleString()} / ${u.nextBadge.min.toLocaleString()} words to ${u.nextBadge.name}`,
	}
}

// A row in the writers directory (link wrapping is the page's job).
export function writerRowHtml(u) {
	return (
		`<span class="st-dot ${u.online ? "on" : "off"}" title="${u.online ? "Online" : "Offline"}"></span>` +
		miniAvatar(u) +
		`<span class="rg-info"><b style="color:${safeColor(u.color)}">${esc(u.username)}</b>` +
		`<span class="rg-sub">${u.wordCount.toLocaleString()} words</span></span>` +
		`${u.badge ? `<span class="badge-chip">${esc(u.badge)}</span>` : ""}`
	)
}

// A friends row for the dashboard rail (link wrapping is the page's job).
export function friendRowHtml(u) {
	return (
		`<span class="st-dot ${u.online ? "on" : "off"}" title="${u.online ? "Online" : "Offline"}"></span>` +
		miniAvatar(u) +
		`<span class="rg-info"><b style="color:${safeColor(u.color)}">${esc(u.username)}</b></span>` +
		`${u.badge ? `<span class="badge-chip">${esc(u.badge)}</span>` : ""}`
	)
}

// An inbox message row (action buttons are appended by the page).
export function inboxMsgHtml(m) {
	const from = m.from
		? miniAvatar(m.from) + `<b style="color:${safeColor(m.from.color)}">${esc(m.from.username)}</b>`
		: `<b>Byler Cowrite</b>`
	const when = m.ts ? new Date(m.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""
	return (
		`<span class="ib-dot${m.read ? "" : " unread"}" title="${m.read ? "Read" : "Unread"}"></span>` +
		`<span class="ib-info"><span class="ib-from">${from}` +
		`${m.type === "friend-request" ? '<span class="badge-chip">friend request</span>' : ""}` +
		`${m.type === "game-invite" ? '<span class="badge-chip">game invite</span>' : ""}` +
		`${m.type === "help" ? '<span class="badge-chip">help question</span>' : ""}` +
		`<span class="ib-when">${esc(when)}</span></span>` +
		`<span class="ib-text">${esc(m.text)}</span>` +
		(m.from ? replyBoxHtml(m) : "") +
		`</span>`
	)
}

// The inline reply composer, folded into the message row itself and hidden
// until Reply is pressed. Only messages from a real person get one — there's
// nobody to answer a system note. The page finds its parts by class within
// the row, so nothing here needs an id (ids would collide across rows).
export function replyBoxHtml(m) {
	return (
		`<span class="ib-reply hidden">` +
		`<textarea class="ib-reply-text" rows="2" maxlength="1000" ` +
		`placeholder="Reply to ${esc(m.from.username)}…"></textarea>` +
		`<span class="ib-reply-row">` +
		`<span class="ib-reply-msg"></span>` +
		`<button type="button" class="ghost ib-reply-cancel">Cancel</button>` +
		`<button type="button" class="primary ib-reply-send">Send</button>` +
		`</span></span>`
	)
}

// Deterministic cover art for a game card: two palette colors + an angle
// derived from the code, so every story keeps its own look with no images.
function coverGrad(code) {
	let h = 7
	for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
	const a = PALETTE[h % PALETTE.length]
	const b = PALETTE[(h >> 3) % PALETTE.length]
	return `linear-gradient(${115 + (h % 130)}deg, ${a}, ${b})`
}
export const coverArt = (code) => `background:${coverGrad(code)}`

// Cover style: the host-linked header image when the game has one (the URL is
// validated http/https server-side; esc() keeps it attr-safe), layered over
// the deterministic code gradient so a broken link still shows the gradient.
export const coverStyle = (g) =>
	g.cover
		? `background:url('${esc(g.cover)}') center/cover no-repeat, ${coverGrad(g.code)}`
		: coverArt(g.code)

export function myGameStatus(g) {
	if (g.phase === "waiting") return { text: "Gathering writers", cls: "" }
	if (g.phase === "choosing") return { text: "Voting on a scenario", cls: "" }
	if (g.myTurn) return { text: "● Your turn — write!", cls: "is-turn" }
	if (g.paused) return { text: "⏸ Paused", cls: "is-paused" }
	return { text: g.currentName ? `Waiting for ${g.currentName}` : "In progress", cls: "" }
}

// A "games in progress" card (button appended by the page).
export function myGameCardHtml(g) {
	const st = myGameStatus(g)
	const glyph = (g.name || "").trim().charAt(0).toUpperCase() || "✒"
	return (
		`<div class="mg-cover" style="${coverStyle(g)}">${g.cover ? "" : `<span class="mg-glyph">${esc(glyph)}</span>`}</div>` +
		`<div class="mg-body">` +
		`<div class="mg-head"><b class="mg-name">${esc(g.name || "Untitled story")}</b>` +
		`<span class="mg-code">${esc(g.code)}</span></div>` +
		`<p class="mg-status ${st.cls}">${esc(st.text)}</p>` +
		`<div class="mg-players">` +
		g.players
			.map(
				(p) =>
					`<span class="mg-dot${p.connected ? "" : " off"}" title="${esc(p.name)}" style="background:${safeColor(p.color)}"></span>`,
			)
			.join("") +
		`<span class="mg-count">${g.players.length} writer${g.players.length === 1 ? "" : "s"} · ${g.lines} line${g.lines === 1 ? "" : "s"}</span>` +
		`</div></div>`
	)
}

// Compact finished-story row for the "previous games" list.
export function recentRowHtml(g) {
	return (
		`<span class="rg-cover" style="${coverStyle(g)}"></span>` +
		`<span class="rg-info"><b>${esc(g.name || g.prompt || g.code)}</b>` +
		`<span class="rg-sub">${esc(g.code)} · ${g.writers.length} writer${g.writers.length === 1 ? "" : "s"}</span></span>` +
		`<span class="rg-lines">${g.lines} line${g.lines === 1 ? "" : "s"}</span>`
	)
}

// Earned badge chips + the greyed next tier.
export function achievementsHtml(u) {
	const earned = u.badges
		.map((b) => `<span class="ach earned" title="${esc(u.badgeDescs?.[b] || "No description")}">${esc(b)}</span>`)
		.join("")
	const next = u.nextBadge
		? `<span class="ach next" title="Next up">? ${esc(u.nextBadge.name)} · ${u.nextBadge.min} words</span>`
		: ""
	return earned + next || '<span class="subtle">Write your first line to start earning badges.</span>'
}

// Streak ring: an SVG circle filled to streak/best (full ring when at best).
export function streakRingHtml(streak, best) {
	const R = 26
	const C = 2 * Math.PI * R
	const pct = best > 0 ? Math.min(1, streak / best) : 0
	return (
		`<svg viewBox="0 0 64 64" class="streak-ring" role="img" aria-label="${streak}-day streak">` +
		`<circle cx="32" cy="32" r="${R}" class="ring-bg"></circle>` +
		`<circle cx="32" cy="32" r="${R}" class="ring-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"></circle>` +
		`<text x="32" y="29" class="ring-emoji">🔥</text>` +
		`<text x="32" y="45" class="ring-num">${streak}d</text>` +
		`</svg>`
	)
}
