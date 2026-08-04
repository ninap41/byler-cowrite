// Previous-games archive render helpers (pure string builders).
import { esc, safeColor, whoMarks } from "./util.js"

export const fmtWhen = (ts) =>
	ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unknown date"

export function gameCardHtml(g) {
	// Title line: the game's name when the host set one, otherwise the prompt.
	return (
		`<p class="gc-prompt"${g.name ? ' style="font-weight:700"' : ""}>${esc(g.name) || esc(g.prompt) || "<em>No prompt yet</em>"}</p>` +
		`<span class="gc-meta">` +
		`<span>${esc(g.code)}</span>` +
		(g.hostName ? `<span>${esc(g.hostName)} <span class="host-tag">(host)</span></span>` : "") +
		`<span>${g.lines} line${g.lines === 1 ? "" : "s"}</span>` +
		`<span>${g.phase === "over" ? "finished" : "paused"}</span>` +
		`<span>${esc(g.writers.map((w) => w.name + (w.isHost ? " (host)" : "")).join(", "))}</span>` +
		`<span>${fmtWhen(g.savedAt)}</span>` +
		`</span>`
	)
}

export const archiveMetaText = (g) => `${g.code} · ${g.phase === "over" ? "finished" : "paused"} · ${fmtWhen(g.savedAt)}`

// Story html in snapshots already passed through sanitizeRich() server-side.
export function archiveStoryHtml(story) {
	if (!story.length) return '<p class="empty">Nothing written yet.</p>'
	return story
		.map(
			(l) =>
				`<div class="story-line"><span class="line-by"><span class="who" style="color:${safeColor(l.color)}">${esc(l.name)}</span>${whoMarks(l)}</span>${l.html || ""}</div>`,
		)
		.join("")
}
