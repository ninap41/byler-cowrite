// Cross-page "your turn" alert. The game page renders its own toast off
// game-state broadcasts; every OTHER signed-in page polls /api/dashboard
// and, when one of your games is waiting on you, pins the same toast with
// a link into the game. Persistent: it only leaves when dismissed or when
// the turn stops being yours. Dismissing snoozes that game's code until
// its myTurn flag drops and rises again.
import { api, getToken } from "./api.js"
import { esc } from "./util.js"

const POLL_MS = 10_000

export function mountTurnAlert() {
	if (!getToken()) return
	const snoozed = new Set() // codes dismissed for the current turn
	let el = null

	function hideToast() {
		el?.remove()
		el = null
	}
	function showToast(g) {
		if (el?.dataset.code === g.code) return // already up for this game
		hideToast()
		el = document.createElement("div")
		el.className = "turn-toast"
		el.dataset.code = g.code
		el.setAttribute("role", "alert")
		el.innerHTML =
			`<span>✒ Your turn in “${esc(g.name || g.code)}”!</span>` +
			`<a class="turn-toast-go" href="/game?code=${encodeURIComponent(g.code)}">Go write →</a>` +
			`<button type="button" class="turn-toast-close" title="Dismiss">✕</button>`
		el.querySelector(".turn-toast-close").onclick = () => {
			snoozed.add(g.code)
			hideToast()
		}
		document.body.appendChild(el)
	}

	async function poll() {
		let d
		try {
			d = await api("/api/dashboard", null, "GET")
		} catch (e) {
			return // signed out / offline: leave things as they are
		}
		const mine = (d.myGames || []).filter((g) => g.myTurn && (g.players || []).length > 1)
		for (const code of [...snoozed]) if (!mine.some((g) => g.code === code)) snoozed.delete(code)
		const next = mine.find((g) => !snoozed.has(g.code))
		if (next) showToast(next)
		else hideToast()
	}
	poll()
	setInterval(poll, POLL_MS)
}
