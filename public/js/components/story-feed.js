// Story feed markup. l.html is already sanitized server-side (sanitizeRich)
// — it is injected as-is by design; names/colors go through esc/safeColor.
import { esc, safeColor, whoMarks } from "../util.js"
import { statusDot } from "../status.js"

export const EMPTY_STORY_HTML = '<p class="empty">The page is blank. The first line is coming…</p>'

// freshFrom: lines at index >= freshFrom get the "fresh" entrance animation.
export function storyHtml(story, { freshFrom = Infinity } = {}) {
	if (!story.length) return EMPTY_STORY_HTML
	return story
		.map((l, i) => {
			const col = safeColor(l.color)
			return `<div class="story-line ${i >= freshFrom ? "fresh" : ""}">${statusDot(l.name)}${whoMarks(l)}<span class="who" style="color:${col}">${esc(l.name)}</span>${l.html || ""}</div>`
		})
		.join("")
}

// Another writer's live, in-progress line (html already re-sanitized server-side).
export function livePreviewHtml(html, name, color) {
	return `${statusDot(name)}<span class="who" style="color:${color}">${esc(name)}</span>${html}<span class="caret"></span>`
}
