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

// A prompt is a stack of bulleted clauses when it was assembled by guided mode
// (lib/prompt-gen.js). Anywhere it stands in for a TITLE — a card, a listing,
// a delete confirmation — it has to collapse back to one line first.
export const oneLinePrompt = (prompt) =>
	String(prompt || "")
		.split("\n")
		.map((l) => l.replace(/^\u2022 /, "").trim())
		.filter(Boolean)
		.join(" ")
