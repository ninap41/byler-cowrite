// Chat message markup: names/text are plain text and always esc()'d; the
// only html a person's text gains is a link per http(s) URL (linkifyText).
// The person tag is deliberately minimal: avatar + name + "(host)".
import { esc, safeColor, miniAvatar, linkifyText } from "../util.js"
import type { ChatMessage, LinkPreview } from "../shared/wire.js"

export function chatMessageHtml(m: ChatMessage): string {
	const col = safeColor(m.color)
	const sys = "sys" in m && m.sys === true
	const host = !sys && "host" in m && (m.host || m.isHost)
	return (
		(sys ? "" : miniAvatar(m as Extract<ChatMessage, { spec?: unknown }>)) +
		`<span class="cn" style="color:${col}">${esc(m.name)}</span>` +
		(host ? `<span class="cn-host">(host)</span>` : "") +
		(sys ? esc(m.text) : linkifyText(m.text))
	)
}

const HTTP = /^https?:\/\//i
const hostOf = (u: string): string => {
	try {
		return new URL(u).hostname.replace(/^www\./, "")
	} catch {
		return ""
	}
}
/** The preview card under a chat line: thumbnail (http(s) only), site, title, description. */
export function linkPreviewHtml(p: LinkPreview): string {
	if (!p || !HTTP.test(p.url)) return ""
	const img = p.image && HTTP.test(p.image) ? `<img class="cp-img" src="${esc(p.image)}" alt="" loading="lazy">` : ""
	const desc = p.description ? `<span class="cp-desc">${esc(p.description)}</span>` : ""
	return (
		`<a class="chat-preview" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow">${img}` +
		`<span class="cp-body"><span class="cp-site">${esc(p.site || hostOf(p.url))}</span>` +
		`<span class="cp-title">${esc(p.title || p.url)}</span>${desc}</span></a>`
	)
}
