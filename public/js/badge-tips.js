// Hover any rank/usage badge chip anywhere in the app to see its description
// in the shared theme-aware tooltip (js/tooltip.js — no native-title delay).
// Descriptions come from /api/achievements (public, no auth), fetched lazily
// on the first hover and cached. Badges with no description say so.
import { api } from "./api.js"

let descs = null
async function loadDescs() {
	if (descs) return descs
	let meta = null
	try {
		meta = await api("/api/achievements", null, "GET")
	} catch (e) {}
	descs = {}
	;(meta?.wordTiers || []).concat(meta?.usage || []).forEach((b) => (descs[b.name] = b.desc || ""))
	return descs
}

export function initBadgeTips(doc = document, tips = null) {
	doc.addEventListener("mouseover", async (e) => {
		const el = e.target.closest?.(".badge-chip, .ach, .tier")
		if (!el || el.dataset.tipped) return
		el.dataset.tipped = "1"
		const map = await loadDescs()
		const name = (el.classList.contains("tier") ? el.querySelector(".tier-name")?.textContent : el.textContent) || ""
		if (el.title) {
			el.dataset.tip = el.title
			el.removeAttribute("title")
		}
		if (!el.dataset.tip)
			el.dataset.tip = map[name.replace(/^🔒\s*/, "").replace(/^\?\s*/, "").trim()] || "No description"
		// the description arrived async — if the pointer is still here, show it now
		if (tips && el.matches(":hover")) tips.show(el, el.dataset.tip)
	})
}
