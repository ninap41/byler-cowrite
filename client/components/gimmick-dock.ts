// The gimmick dock: every gimmick can be out at once, but only ONE panel is
// ever open — each open gimmick gets an edge tab on the LEFT of the screen
// (the host drawer's .doc-side-tab, mirrored) and clicking a tab opens that
// gimmick's HUD, folding whichever was open. Clicking the open one folds it
// too, leaving the whole table visible. The dock never touches a gimmick's
// state: the toy (die, cup, brush…) stays out while its panel is tabbed away.
//
// It works on the HUDs the components already own: each entry names a HUD
// element and the dock mirrors its open/closed state (the component toggling
// `.hidden` on start/exit) through a MutationObserver — a gimmick opening
// takes the stage, a gimmick leaving takes its tab with it, and no wiring
// lives inside the components themselves.
import { esc } from "../util.js"

export const dockHtml = (): string => `<div class="gk-tabs" id="gkTabs" aria-label="Gimmick panels"></div>`

// The two corner controls every HUD glass carries: "−" folds the panel to
// its edge tab (the dock handles it — the toy stays out), "×" closes the
// gimmick (each component treats it exactly like its own "Put … away").
export const hudCtlHtml = (): string =>
	`<span class="gk-hud-ctl"><button type="button" data-hud="min" aria-label="Minimize" title="Minimize to the edge tab">−</button><button type="button" data-hud="close" aria-label="Close" title="Close">×</button></span>`

export interface DockItem {
	id: string
	icon?: string
	title?: string
	/** that gimmick's HUD panel: a selector or the element */
	hud: string | HTMLElement
}
export interface DockOpts {
	document?: Document
	items?: DockItem[]
}
export interface GimmickDock {
	open(id: string): void
	fold(): void
	readonly onStage: string | null
	readonly tabs: string[]
}
interface Entry {
	hudEl: HTMLElement
	tab: HTMLButtonElement
	wasOpen: boolean
	onStage: boolean
}

export function mountGimmickDock(opts: DockOpts = {}): GimmickDock {
	const doc = opts.document || document
	doc.body.insertAdjacentHTML("beforeend", dockHtml())
	const tabsBox = doc.getElementById("gkTabs")!
	const entries = new Map<string, Entry>()

	const isOut = (e: Entry) => !e.hudEl.classList.contains("hidden")
	function paint() {
		for (const [, e] of entries) {
			const out = isOut(e)
			e.hudEl.classList.toggle("gk-minned", out && !e.onStage)
			e.tab.classList.toggle("hidden", !out)
			e.tab.classList.toggle("on", out && e.onStage)
		}
	}
	// one panel on stage at a time (or none): opening one folds the rest
	function stage(id: string | null) {
		for (const [k, e] of entries) e.onStage = k === id
		paint()
	}
	function sync(id: string) {
		const e = entries.get(id)
		if (!e) return
		const out = isOut(e)
		if (out && !e.wasOpen) stage(id) // a gimmick just opened: it takes the stage
		if (!out) e.onStage = false // a gimmick left: its tab goes, the stage empties
		e.wasOpen = out
		paint()
	}

	for (const item of opts.items || []) {
		const hudEl = typeof item.hud === "string" ? doc.querySelector<HTMLElement>(item.hud) : item.hud
		if (!hudEl) continue
		const tab = doc.createElement("button")
		tab.type = "button"
		tab.className = "gk-tab hidden"
		tab.innerHTML = `${esc(item.icon || "🎲")}`
		tab.title = item.title || item.id
		tab.setAttribute("data-tip", item.title || item.id)
		tab.addEventListener("click", () => {
			const e = entries.get(item.id)
			if (!e || !isOut(e)) return
			// the open panel's own tab folds it; any other tab takes the stage
			stage(e.onStage ? null : item.id)
		})
		tabsBox.appendChild(tab)
		// the HUD's own "−": fold this panel (the toy stays out)
		hudEl.addEventListener("click", (e) => {
			if ((e.target as Element | null)?.closest?.('[data-hud="min"]')) stage(null)
		})
		entries.set(item.id, { hudEl, tab, wasOpen: !hudEl.classList.contains("hidden"), onStage: false })
		const win = doc.defaultView
		if (win?.MutationObserver) {
			new win.MutationObserver(() => sync(item.id)).observe(hudEl, { attributes: true, attributeFilter: ["class"] })
		}
		sync(item.id)
	}

	return {
		open: (id) => stage(id),
		fold: () => stage(null),
		get onStage() {
			return [...entries.entries()].find(([, e]) => e.onStage)?.[0] ?? null
		},
		get tabs() {
			return [...entries.entries()].filter(([, e]) => !e.tab.classList.contains("hidden")).map(([id]) => id)
		},
	}
}
