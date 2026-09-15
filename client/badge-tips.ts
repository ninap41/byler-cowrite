// Hover any rank/usage badge chip anywhere in the app to see its description
// in the shared theme-aware tooltip (js/tooltip.js — no native-title delay).
// Descriptions come from /api/achievements (public, no auth), fetched lazily
// on the first hover and cached. Badges with no description say so.
import { api } from "./api.js"
import type { Tips } from "./tooltip.js"

interface BadgeMeta {
	wordTiers?: { name: string; desc?: string }[]
	usage?: { name: string; desc?: string }[]
}

let descs: Record<string, string> | null = null
async function loadDescs(): Promise<Record<string, string>> {
	if (descs) return descs
	let meta: BadgeMeta | null = null
	try {
		meta = await api<BadgeMeta>("/api/achievements", null, "GET")
	} catch {}
	const map: Record<string, string> = {}
	;(meta?.wordTiers || []).concat(meta?.usage || []).forEach((b) => (map[b.name] = b.desc || ""))
	descs = map
	return map
}

export function initBadgeTips(doc: Document = document, tips: Tips | null = null): void {
	doc.addEventListener("mouseover", async (e) => {
		const el = (e.target as Element | null)?.closest?.<HTMLElement>(".badge-chip, .ach, .tier")
		if (!el || el.dataset.tipped) return
		el.dataset.tipped = "1"
		const map = await loadDescs()
		const name = (el.classList.contains("tier") ? el.querySelector(".tier-name")?.textContent : el.textContent) || ""
		if (el.title) {
			el.dataset.tip = el.title
			el.removeAttribute("title")
		}
		if (!el.dataset.tip) el.dataset.tip = map[name.replace(/^🔒\s*/, "").replace(/^\?\s*/, "").trim()] || "No description"
		// the description arrived async — if the pointer is still here, show it now
		if (tips && el.matches(":hover")) tips.show(el, el.dataset.tip)
	})
}
