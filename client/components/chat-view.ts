// Chat message markup: names/text are plain text and always esc()'d.
// The person tag is deliberately minimal: avatar + name + "(host)".
import { esc, safeColor, miniAvatar } from "../util.js"
import type { ChatMessage } from "../shared/wire.js"

export function chatMessageHtml(m: ChatMessage): string {
	const col = safeColor(m.color)
	const sys = "sys" in m && m.sys === true
	const host = !sys && "host" in m && (m.host || m.isHost)
	return (
		(sys ? "" : miniAvatar(m as Extract<ChatMessage, { spec?: unknown }>)) +
		`<span class="cn" style="color:${col}">${esc(m.name)}</span>` +
		(host ? `<span class="cn-host">(host)</span>` : "") +
		esc(m.text)
	)
}
