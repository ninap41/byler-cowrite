// Chat message markup: names/text are plain text and always esc()'d.
// The person tag is deliberately minimal: avatar + name + "(host)".
import { esc, safeColor, miniAvatar } from "../util.js"

export function chatMessageHtml(m) {
	const col = safeColor(m.color)
	return (
		(m.sys ? "" : miniAvatar(m)) +
		`<span class="cn" style="color:${col}">${esc(m.name)}</span>` +
		(!m.sys && (m.host || m.isHost) ? `<span class="cn-host">(host)</span>` : "") +
		esc(m.text)
	)
}
