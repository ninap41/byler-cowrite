// Row builders for the admin page. Pure string functions, like the other
// *-view modules: everything user-supplied is esc()'d, and the buttons carry
// their action in data-* so one delegated listener can drive the whole page.
import { esc } from "./util.js"

const DAY = 86_400_000

// "3 days ago" is what a moderator is actually judging inactivity on, so lead
// with the gap and keep the exact date as the tooltip.
export function agoLabel(ts, now) {
	if (!ts) return "never signed in"
	const d = Math.floor((now - ts) / DAY)
	if (d <= 0) return "today"
	if (d === 1) return "yesterday"
	if (d < 30) return `${d} days ago`
	const m = Math.floor(d / 30)
	return m < 12 ? `${m} month${m === 1 ? "" : "s"} ago` : `${Math.floor(d / 365)}y ago`
}

const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unknown")

export function adminGamesHtml(games) {
	const live = (games || []).filter((g) => g.phase !== "over")
	if (!live.length) return `<p class="subtle" style="text-align:left">No games are running right now.</p>`
	return live
		.map(
			(g) =>
				`<div class="row" style="justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">` +
				`<span><strong>${esc(g.name) || esc(g.code)}</strong> ` +
				`<span class="gc-meta" style="display:inline">${esc(g.code)} · ${esc(g.phase)} · ` +
				`${g.players} writer${g.players === 1 ? "" : "s"} · ${g.lines} line${g.lines === 1 ? "" : "s"}` +
				(g.hostName ? ` · host ${esc(g.hostName)}` : "") +
				`</span></span>` +
				`<span class="row" style="gap:8px;flex:none">` +
				`<a class="ghost" style="text-decoration:none;padding:8px 12px;border-radius:10px" href="/game?code=${encodeURIComponent(g.code)}">Join</a>` +
				`<button class="ghost" data-admin-act="end" data-admin-target="${esc(g.code)}">End</button>` +
				`<button class="ghost danger" data-admin-act="delete-game" data-admin-target="${esc(g.code)}">Delete</button>` +
				`</span></div>`,
		)
		.join("")
}

export function adminUsersHtml(users, now) {
	if (!users || !users.length) return `<p class="subtle" style="text-align:left">No accounts yet.</p>`
	return users
		.map(
			(u) =>
				`<div class="row" style="justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">` +
				`<span><strong>${esc(u.username)}</strong>${u.admin ? ' <span class="host-tag">admin</span>' : ""}` +
				(u.online ? ' <span class="host-tag">online</span>' : "") +
				`<br /><span class="gc-meta" style="display:inline" data-tip="${esc(when(u.lastSeen))}">${esc(u.email)} · ` +
				`${esc(agoLabel(u.lastSeen, now))} · ${u.wordCount} words · ${u.games} game${u.games === 1 ? "" : "s"}</span></span>` +
				(u.admin
					? `<span class="gc-meta" style="flex:none">protected</span>`
					: `<button class="ghost danger" style="flex:none" data-admin-act="delete-user" data-admin-target="${esc(u.username)}">Remove</button>`) +
				`</div>`,
		)
		.join("")
}
