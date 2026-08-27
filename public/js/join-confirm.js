// The confirm step for a game link that arrived from somewhere casual — a
// Discord button, say — where a single click shouldn't seat someone before
// they've seen what they're joining. Pure builder: game.html shows it on
// `gameMsgCard` when the URL carries `from=discord` and only calls
// join-session once #joinConfirmBtn is pressed. A plain `?code=` link (the
// dashboard, an invite note) still joins on load.
import { esc } from "./util.js"

export const CONFIRM_SOURCES = ["discord"]
export const needsJoinConfirm = (from) => CONFIRM_SOURCES.includes(String(from || "").toLowerCase())

export function joinConfirmHtml(g) {
	const lobby = g.phase === "waiting"
	const n = g.players ?? 0
	return (
		`<div class="join-confirm">` +
		`<h3 style="margin:0 0 6px">${lobby ? "Join" : "Ask to join"} “${esc(g.name || g.code)}”?</h3>` +
		`<p class="subtle" style="margin:0 0 12px;text-align:left">${g.hostName ? `Hosted by ${esc(g.hostName)} · ` : ""}${n} writer${n === 1 ? "" : "s"} · code <b>${esc(g.code)}</b>` +
		`${lobby ? " · gathering writers, you'll take a seat in the lobby." : " · underway, the host will be asked to let you in."}</p>` +
		`<button type="button" class="primary" id="joinConfirmBtn">${lobby ? "Join the lobby" : "Ask to join"}</button>` +
		`</div>`
	)
}
