// The gimmick dock: every gimmick can be out at once, but their HUD panels
// all live bottom-left — so each panel gets a minimize control, and a
// minimized panel becomes an icon tab stacked on the LEFT EDGE of the screen.
// Clicking the tab brings the panel back. The dock never touches a gimmick's
// state: the toy (die, cup, brush…) stays out while its panel is tabbed away.
//
// It works on the HUDs the components already own: each entry names a HUD
// element, the dock folds a minimize button into it and mirrors its
// open/closed state (the component toggling `.hidden` on exit) through a
// MutationObserver — so a gimmick leaving takes its tab with it, no wiring
// inside the components themselves.
import { esc } from "../util.js"

export const dockHtml = () => `<div class="gk-tabs" id="gkTabs" aria-label="Minimized gimmicks"></div>`

// opts: { document, items: [{ id, icon, title, hud }] } — hud is a selector
// or element for that gimmick's panel.
export function mountGimmickDock(opts = {}) {
	const doc = opts.document || document
	doc.body.insertAdjacentHTML("beforeend", dockHtml())
	const tabsBox = doc.getElementById("gkTabs")
	const entries = new Map() // id -> { hudEl, tab, minned }

	function sync(id) {
		const e = entries.get(id)
		if (!e) return
		const gimmickOpen = !e.hudEl.classList.contains("hidden")
		if (!gimmickOpen) e.minned = false // the gimmick left — its tab goes too
		e.hudEl.classList.toggle("gk-minned", e.minned)
		e.tab.classList.toggle("hidden", !(gimmickOpen && e.minned))
	}
	function setMin(id, min) {
		const e = entries.get(id)
		if (!e) return
		e.minned = min
		sync(id)
	}

	for (const item of opts.items || []) {
		const hudEl = typeof item.hud === "string" ? doc.querySelector(item.hud) : item.hud
		if (!hudEl) continue
		hudEl.insertAdjacentHTML(
			"afterbegin",
			`<button type="button" class="gk-min" data-gk-min="${esc(item.id)}" title="Minimize to the edge" aria-label="Minimize ${esc(item.title || item.id)}">▁</button>`
		)
		const tab = doc.createElement("button")
		tab.type = "button"
		tab.className = "gk-tab hidden"
		tab.textContent = item.icon || "🎲"
		tab.title = item.title || item.id
		tab.addEventListener("click", () => setMin(item.id, false))
		tabsBox.appendChild(tab)
		entries.set(item.id, { hudEl, tab, minned: false })
		hudEl.addEventListener("click", (ev) => {
			if (ev.target.closest(`[data-gk-min="${item.id}"]`)) setMin(item.id, true)
		})
		// the component hides/shows its own hud (exit, friendly switch, restart):
		// mirror that into the tab so a closed gimmick never leaves one behind
		const win = doc.defaultView
		if (win?.MutationObserver) {
			new win.MutationObserver(() => sync(item.id)).observe(hudEl, { attributes: true, attributeFilter: ["class"] })
		}
	}

	return {
		minimize: (id) => setMin(id, true),
		restore: (id) => setMin(id, false),
		get tabs() {
			return [...entries.entries()].filter(([, e]) => !e.tab.classList.contains("hidden")).map(([id]) => id)
		},
	}
}
