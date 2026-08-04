// Story feed markup. l.html is already sanitized server-side (sanitizeRich)
// — it is injected as-is by design; names/colors go through esc/safeColor.
import { esc, safeColor, whoMarks } from "../util.js"
import { statusDot } from "../status.js"

export const EMPTY_STORY_HTML = '<p class="empty">The page is blank. The first line is coming…</p>'

// freshFrom: lines at index >= freshFrom get the "fresh" entrance animation.
// mineId: the signed-in account id — that author's lines get ✎ edit and ✕ delete buttons.
export function storyHtml(story, { freshFrom = Infinity, mineId = null } = {}) {
	if (!story.length) return EMPTY_STORY_HTML
	return story
		.map((l, i) => {
			const col = safeColor(l.color)
			const mine = mineId && l.userId === mineId
			// chapter headers: centered, no byline — just the heading (+ edit for its author)
			if (l.header)
				return (
					`<div class="story-line header-line ${i >= freshFrom ? "fresh" : ""}" data-idx="${i}">` +
					(mine
						? '<button class="line-edit line-del" title="Delete your header" type="button">✕</button>' +
							'<button class="line-edit" title="Edit your header" type="button">✎</button>'
						: "") +
					(l.html || "") +
					`</div>`
				)
			// the byline sits on its own line ABOVE the contribution
			return (
				`<div class="story-line ${i >= freshFrom ? "fresh" : ""}" data-idx="${i}">` +
				`<span class="line-by">${statusDot(l.name)}<span class="who" style="color:${col}">${esc(l.name)}</span>${whoMarks(l)}` +
				(l.edited ? '<span class="edited-tag" title="This line was revised">edited</span>' : "") +
				`</span>` +
				(mine
					? '<button class="line-edit line-del" title="Delete your line" type="button">✕</button>' +
						'<button class="line-edit" title="Edit your line" type="button">✎</button>'
					: "") +
				(l.html || "") +
				`</div>`
			)
		})
		.join("")
}

// Another writer's live, in-progress line (html already re-sanitized server-side).
export function livePreviewHtml(html, name, color) {
	return `${statusDot(name)}<span class="who" style="color:${color}">${esc(name)}</span>${html}<span class="caret"></span>`
}
