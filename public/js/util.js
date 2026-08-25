// Shared client kernel: palette, escaping, and tiny render helpers.
// The palette mirrors PALETTE in server.js — the server validates against it.
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"]

export const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

export const safeColor = (c) => (PALETTE.includes(c) ? c : PALETTE[0])

// The app's name, from the <meta name="site-name"> the server renders into
// every page out of content/site.json (a jsdom test page has none → fallback).
export const siteName = () =>
	(typeof document !== "undefined" && document.querySelector('meta[name="site-name"]')?.content) || "Cowrite"

// "(host)" marker, placed AFTER a name everywhere it appears.
export const whoMarks = (o) => (o?.host || o?.isHost ? '<span class="host-tag">(host)</span>' : "")

// Tiny round profile pic used beside names (roster, chat, players row,
// writers directory). Empty string when the account has no picture.
// avatarFit is the user's preference: "cover" crops to fill, "contain" zooms
// out to fit the whole image.
// Without a picture: a disc in the user's chosen color with their initial.
export const miniAvatar = (o) => {
	if (!o) return ""
	if (o.avatar)
		return `<img class="mini-avatar fit-${o.avatarFit === "contain" ? "contain" : "cover"}" src="${esc(o.avatar)}" alt="" loading="lazy">`
	const name = o.name || o.username
	if (!name) return ""
	return `<span class="mini-avatar mini-initial" style="background:${safeColor(o.color)}">${esc(String(name).charAt(0).toUpperCase())}</span>`
}

// A guided prompt's clauses open "Category: choice" (lib/prompt-gen.js
// CATEGORIES). promptHtml escapes the whole prompt and, when every line is a
// clause, lays them out as a grid of category | choice rows — the category
// name in a span classed by that name so `.pc-season` etc. in base.css give
// each one the same colour everywhere. A curated prompt has no such prefix
// and comes back as plain escaped text; nothing user-typed can become markup.
// What each category means — the tooltip on its name.
export const PROMPT_CAT_TIPS = {
	Season: "When it's set — which season of the show, or after it. Fixes how old they are.",
	Canon: "How close to the show: compliant, one thing diverges, or an alternate universe.",
	Place: "Where the scene happens.",
	Relationship: "Where they stand with each other when the story opens.",
	Situation: "What kind of moment this is.",
	Trope: "A fanfic trope to build the story around.",
	Tone: "The feel of the piece.",
	Rating: "How far it goes: suggestive fades to black; explicit is on the page (adults only).",
	Kinks: "How it starts, the dynamic between them, what happens, and the emotional key it's played in.",
}
const PROMPT_CATS = Object.keys(PROMPT_CAT_TIPS)
const CAT_RE = new RegExp("^(?:\\u2022 )?(" + PROMPT_CATS.join("|") + "): ")
export const promptHtml = (prompt) => {
	const lines = String(prompt || "").split("\n").filter((l) => l.trim())
	const rows = lines.map((l) => l.match(CAT_RE))
	if (!lines.length || rows.some((m) => !m)) return esc(String(prompt || ""))
	return `<span class="prompt-grid">${lines
		.map((l, i) => {
			const cat = rows[i][1]
			return `<span class="pc pc-${cat.toLowerCase()}" title="${esc(PROMPT_CAT_TIPS[cat])}">${cat}</span><span class="pc-val">${esc(l.slice(rows[i][0].length))}</span>`
		})
		.join("")}</span>`
}

// A prompt is a stack of bulleted clauses when it was assembled by guided mode
// (lib/prompt-gen.js). Anywhere it stands in for a TITLE — a card, a listing,
// a delete confirmation — it has to collapse back to one line first.
export const oneLinePrompt = (prompt) =>
	String(prompt || "")
		.split("\n")
		.map((l) => l.replace(/^\u2022 /, "").trim())
		.filter(Boolean)
		.join(" ")
