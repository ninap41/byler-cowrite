// Live presence dots. The name -> connected map refreshes from every roster
// / game-state broadcast; statusDot() renders a dot that refreshStatusDots()
// keeps current everywhere — even old chat lines. "Connected" means the
// account has this game open right now (lobby or play): a seat is In game
// or Not in game, and the writers panel says which in words.
import { esc } from "./util.js"

const liveStatus = new Map()

export const presenceLabel = (on) => (on ? "In game" : "Not in game")
export const statusDot = (name) => `<span class="st-dot unknown" data-status-name="${esc(name || "")}"></span>`
// The dot plus the words, for the writers/players lists.
export const presenceHtml = (on) =>
	`<span class="st-dot ${on ? "on" : "off"}" title="${presenceLabel(on)}"></span><span class="st-label ${on ? "on" : "off"}">${presenceLabel(on)}</span>`

export function refreshStatusDots(root = document) {
	root.querySelectorAll("[data-status-name]").forEach((el) => {
		const st = liveStatus.get(el.dataset.statusName)
		el.classList.toggle("unknown", st === undefined)
		el.classList.toggle("on", st === true)
		el.classList.toggle("off", st === false)
		el.title = st === undefined ? "" : presenceLabel(st)
	})
}

export function updateLiveStatus(writers, root = document) {
	if (!Array.isArray(writers)) return
	liveStatus.clear()
	writers.forEach((w) => liveStatus.set(w.name, w.connected !== false))
	refreshStatusDots(root)
}
