// Live online/offline presence dots. The name -> connected map refreshes from
// every roster / game-state broadcast; statusDot() renders a dot that
// refreshStatusDots() keeps current everywhere — even old chat lines.
import { esc } from "./util.js"

const liveStatus = new Map()

export const statusDot = (name) => `<span class="st-dot unknown" data-status-name="${esc(name || "")}"></span>`

export function refreshStatusDots(root = document) {
	root.querySelectorAll("[data-status-name]").forEach((el) => {
		const st = liveStatus.get(el.dataset.statusName)
		el.classList.toggle("unknown", st === undefined)
		el.classList.toggle("on", st === true)
		el.classList.toggle("off", st === false)
		el.title = st === undefined ? "" : st ? "Online" : "Offline"
	})
}

export function updateLiveStatus(writers, root = document) {
	if (!Array.isArray(writers)) return
	liveStatus.clear()
	writers.forEach((w) => liveStatus.set(w.name, w.connected !== false))
	refreshStatusDots(root)
}
