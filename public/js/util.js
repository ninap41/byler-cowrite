// Shared client kernel: palette, escaping, and tiny render helpers.
// The palette mirrors PALETTE in server.js — the server validates against it.
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"]

export const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

export const safeColor = (c) => (PALETTE.includes(c) ? c : PALETTE[0])

// "(host)" marker, placed AFTER a name everywhere it appears.
export const whoMarks = (o) => (o?.host || o?.isHost ? '<span class="host-tag">(host)</span>' : "")

// Tiny round profile pic used beside names (roster, chat, players row,
// writers directory). Empty string when the account has no picture.
// avatarFit is the user's preference: "cover" crops to fill, "contain" zooms
// out to fit the whole image.
export const miniAvatar = (o) =>
	o?.avatar
		? `<img class="mini-avatar fit-${o.avatarFit === "contain" ? "contain" : "cover"}" src="${esc(o.avatar)}" alt="" loading="lazy">`
		: ""
