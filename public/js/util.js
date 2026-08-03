// Shared client kernel: palette, escaping, and tiny render helpers.
// The palette mirrors PALETTE in server.js — the server validates against it.
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"]

export const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

export const safeColor = (c) => (PALETTE.includes(c) ? c : PALETTE[0])

// 👑 host marker with tooltip, used beside names everywhere.
export const whoMarks = (o) => (o?.host || o?.isHost ? '<span class="who-mark" title="Host">👑</span>' : "")
