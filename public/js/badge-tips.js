// Hover any rank/usage badge chip anywhere in the app to see its description
// as a native tooltip. Descriptions come from /api/achievements (public, no
// auth), fetched lazily on the first hover and cached. Badges with no
// description say so.
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

export function initBadgeTips(doc = document) {
	doc.addEventListener("mouseover", async (e) => {
		const el = e.target.closest?.(".badge-chip, .ach, .tier")
		if (!el || el.dataset.tipped) return
		el.dataset.tipped = "1"
		const map = await loadDescs()
		const name = (el.classList.contains("tier") ? el.querySelector(".tier-name")?.textContent : el.textContent) || ""
		if (!el.title) el.title = map[name.replace(/^🔒\s*/, "").replace(/^\?\s*/, "").trim()] || "No description"
	})
}
