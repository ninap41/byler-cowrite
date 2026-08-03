// Chat message markup: names/badges/text are plain text and always esc()'d.
import { esc, safeColor, whoMarks } from "../util.js"
import { statusDot } from "../status.js"

export function chatMessageHtml(m) {
	const col = safeColor(m.color)
	return (
		(m.sys ? "" : statusDot(m.name) + whoMarks(m)) +
		`<span class="cn" style="color:${col}">${esc(m.name)}</span>` +
		`${m.badge && !m.sys ? `<span class="badge-chip">${esc(m.badge)}</span>` : ""}` +
		esc(m.text)
	)
}
