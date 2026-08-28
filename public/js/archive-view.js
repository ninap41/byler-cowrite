// Previous-games archive render helpers (pure string builders).
import { esc, safeColor, whoMarks, oneLinePrompt } from "./util.js"
import { coverStyle } from "./dashboard-view.js"

export const fmtWhen = (ts) =>
	ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unknown date"

// Only the ORIGINAL host may continue a story from the archive — a
// contributor can read it, but picking the story back up is the host's call
// (and the server's `continue-writing` enforces the same). Matched by
// username, since that's what the archive carries.
export const canContinue = (g, username) => !!g && !!username && !!g.hostName && g.hostName === username

export function gameCardHtml(g) {
	// Title line: the game's name when the host set one, otherwise the prompt.
	return (
		`<span class="gc-date">${fmtWhen(g.savedAt)}</span>` +
		`<span class="gc-cover" style="${coverStyle(g)}"></span>` +
		`<p class="gc-prompt"${g.name ? ' style="font-weight:700"' : ""}>${esc(g.name) || esc(oneLinePrompt(g.prompt)) || "<em>No prompt yet</em>"}</p>` +
		`<span class="gc-meta">` +
		`<span>${esc(g.code)}</span>` +
		(g.hostName ? `<span>${esc(g.hostName)} <span class="host-tag">(host)</span></span>` : "") +
		`<span>${g.writers.length} writer${g.writers.length === 1 ? "" : "s"} · ${Number(g.words || 0).toLocaleString()} words</span>` +
		`<span>${g.phase === "over" ? "finished" : g.phase === "waiting" ? "gathering writers" : "paused"}</span>` +
		`<span>${esc(g.writers.map((w) => w.name + (w.isHost ? " (host)" : "")).join(", "))}</span>` +
		`</span>`
	)
}

// A public solo write on the all-stories shelf. Same card shape as a game so
// the two read as one library, but it says plainly which it is and who wrote
// it — a write has no code, no host and no turns.
export function writeCardHtml(d) {
	return (
		`<span class="gc-date">${fmtWhen(d.savedAt)}</span>` +
		`<span class="gc-cover" style="${coverStyle({ code: d.id || "", cover: "" })}"></span>` +
		`<p class="gc-prompt" style="font-weight:700">${esc(d.name) || "<em>Untitled</em>"}</p>` +
		`<span class="gc-meta">` +
		`<span>✒️ solo write</span>` +
		(d.viewable === false ? `<span>🔒 private</span>` : d.visibility && d.visibility !== "public" ? `<span>👥 readers</span>` : "") +
		(d.hostName ? `<span>by ${esc(d.hostName)}</span>` : "") +
		`</span>`
	)
}

// ---- how the shelf is laid out ----
// A library is browsed differently depending on what you're doing: reading the
// details of a few, or scanning the covers of many. The choice is the reader's
// and it sticks (localStorage), because it's a habit, not a per-visit decision.
// "list" is one wide card per row (the original); the rest are column counts.
export const STORY_VIEWS = [
	{ key: "list", label: "List", glyph: "☰", cols: 1 },
	{ key: "g3", label: "3 across", glyph: "▤", cols: 3 },
	{ key: "g4", label: "4 across", glyph: "▦", cols: 4 },
	{ key: "g6", label: "6 across", glyph: "⣿", cols: 6 },
]
export const DEFAULT_STORY_VIEW = "list"
export const storyView = (key) => STORY_VIEWS.find((v) => v.key === key) || STORY_VIEWS[0]
export const cleanStoryView = (key) => storyView(key).key

// A segmented control: the pressed segment IS the current layout.
export const viewToggleHtml = (current) =>
	`<div class="st-views" id="stViews" role="group" aria-label="Layout">` +
	STORY_VIEWS.map(
		(v) =>
			`<button type="button" class="st-view${v.key === cleanStoryView(current) ? " on" : ""}" ` +
			`data-view="${v.key}" aria-pressed="${v.key === cleanStoryView(current)}" ` +
			`data-tip="${v.label}" aria-label="${v.label}">${v.glyph}${v.cols > 1 ? `<span class="st-view-n">${v.cols}</span>` : ""}</button>`,
	).join("") +
	`</div>`

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
