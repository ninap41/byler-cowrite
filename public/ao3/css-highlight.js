// A small CSS syntax highlighter for the previewer's editor — pure (a string
// in, HTML out), no dependency, no DOM. The editor is a transparent textarea
// laid over a <pre> filled with this output, so the two must agree character
// for character: every byte of the input comes back out, escaped, in order,
// with nothing added but <span> wrappers. Each line is its own
// `.hl-line` so a lint error can tint the line it sits on.
//
// Token classes (styled in preview.css under both themes):
//   hl-comment  /* … */          hl-at      @media, @font-face …
//   hl-sel      selector text     hl-sel-id  #workskin   hl-sel-class .note
//   hl-sel-pseudo :hover          hl-punct   { } : ; , > + ~ ( )
//   hl-prop     property name     hl-custom  --custom-prop
//   hl-val      plain value word  hl-num     12px 50% .5
//   hl-color    #900 (underlined in itself)  hl-str  "…" '…'
//   hl-fn       rgba( url(        hl-imp     !important

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

const HEX_RE = /^#[0-9a-f]{3,8}$/i

// ---- pass 1: coarse tokens by state (top / block / comment / string) ----
// At-rules whose block holds RULES (so a prelude follows the brace), as
// opposed to @font-face / @page, whose block holds declarations.
const GROUP_AT = /^@(media|supports|layer|container|document|keyframes|-webkit-keyframes|scope)\b/i

function coarse(text) {
	const out = []
	let i = 0
	// a stack of what the open blocks hold: "rules" (top level, @media…) or "decls"
	const stack = ["rules"]
	let lastPrelude = null
	const push = (type, s) => s && out.push({ type, text: s })
	while (i < text.length) {
		const ch = text[i]
		if (ch === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2)
			const stop = end === -1 ? text.length : end + 2
			push("comment", text.slice(i, stop))
			i = stop
			continue
		}
		if (ch === "{") {
			push("punct", ch)
			stack.push(lastPrelude === "at-group" ? "rules" : "decls")
			lastPrelude = null
			i++
			continue
		}
		if (ch === "}") {
			push("punct", ch)
			if (stack.length > 1) stack.pop()
			i++
			continue
		}
		if (/\s/.test(ch)) {
			let j = i
			while (j < text.length && /\s/.test(text[j])) j++
			push("ws", text.slice(i, j))
			i = j
			continue
		}
		if (stack[stack.length - 1] === "rules" || ch === "@") {
			// a prelude: selector or at-rule, up to `{`, `;` or `}` (comments break it)
			let j = i
			while (j < text.length && !"{};".includes(text[j]) && !(text[j] === "/" && text[j + 1] === "*")) j++
			const s = text.slice(i, j)
			const isAt = s.trimStart().startsWith("@")
			push(isAt ? "at" : "prelude", s)
			lastPrelude = isAt ? (GROUP_AT.test(s.trimStart()) ? "at-group" : "at-decls") : "selector"
			i = j
			if (text[i] === ";") (push("punct", ";"), i++, (lastPrelude = null))
			continue
		}
		// inside a declaration block: `prop : value ;`
		let j = i
		while (j < text.length && !":;}".includes(text[j]) && !(text[j] === "/" && text[j + 1] === "*")) j++
		if (text[j] === ":") {
			push("prop", text.slice(i, j))
			push("punct", ":")
			i = j + 1
			let k = i
			let quote = null
			let depth = 0
			while (k < text.length) {
				const c = text[k]
				if (quote) {
					if (c === quote && text[k - 1] !== "\\") quote = null
				} else if (c === '"' || c === "'") quote = c
				else if (c === "(") depth++
				else if (c === ")") depth = Math.max(0, depth - 1)
				else if ((c === ";" || c === "}") && depth === 0) break
				else if (c === "/" && text[k + 1] === "*") break
				k++
			}
			push("value", text.slice(i, k))
			i = k
			if (text[i] === ";") (push("punct", ";"), i++)
		} else {
			// a bare word with no colon — still a declaration slot, just broken
			push("prop", text.slice(i, j))
			i = j
			if (text[i] === ";") (push("punct", ";"), i++)
		}
	}
	return out
}

// ---- pass 2: split the coarse tokens into fine ones ----
function fine(tok) {
	const { type, text } = tok
	if (type === "prelude") return selectorTokens(text)
	if (type === "value") return valueTokens(text)
	if (type === "prop") {
		const m = text.match(/^(\s*)(\S.*?)(\s*)$/s)
		if (!m) return [{ cls: "hl-ws", text }]
		return [{ cls: "hl-ws", text: m[1] }, { cls: m[2].startsWith("--") ? "hl-custom" : "hl-prop", text: m[2] }, { cls: "hl-ws", text: m[3] }].filter((t) => t.text)
	}
	const cls = { comment: "hl-comment", at: "hl-at", punct: "hl-punct", ws: "hl-ws" }[type] || "hl-val"
	return [{ cls, text }]
}

function selectorTokens(text) {
	const out = []
	const re = /(\s+)|(#[\w-]+)|(\.[\w-]+)|(::?[\w-]+(?:\([^)]*\))?)|(\[[^\]]*\])|([>+~,])|("[^"]*"|'[^']*')|([^\s#.:\[\]>+~,"']+)/g
	let m
	while ((m = re.exec(text))) {
		if (m[1]) out.push({ cls: "hl-ws", text: m[1] })
		else if (m[2]) out.push({ cls: "hl-sel-id", text: m[2] })
		else if (m[3]) out.push({ cls: "hl-sel-class", text: m[3] })
		else if (m[4]) out.push({ cls: "hl-sel-pseudo", text: m[4] })
		else if (m[5]) out.push({ cls: "hl-sel-attr", text: m[5] })
		else if (m[6]) out.push({ cls: "hl-punct", text: m[6] })
		else if (m[7]) out.push({ cls: "hl-str", text: m[7] })
		else out.push({ cls: "hl-sel", text: m[8] })
	}
	return out
}

function valueTokens(text) {
	const out = []
	const re = /(\s+)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(!\s*important)|(#[0-9a-f]{3,8}\b)|(-?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)?)|([a-z-]+(?=\())|([(),\/])|([^\s"'!#(),\/]+)/gi
	let m
	while ((m = re.exec(text))) {
		if (m[1]) out.push({ cls: "hl-ws", text: m[1] })
		else if (m[2]) out.push({ cls: "hl-str", text: m[2] })
		else if (m[3]) out.push({ cls: "hl-imp", text: m[3] })
		else if (m[4]) out.push({ cls: "hl-color", text: m[4], color: m[4] })
		else if (m[5]) out.push({ cls: "hl-num", text: m[5] })
		else if (m[6]) out.push({ cls: "hl-fn", text: m[6] })
		else if (m[7]) out.push({ cls: "hl-punct", text: m[7] })
		else out.push({ cls: "hl-val", text: m[8] })
	}
	return out
}

export function tokenize(text) {
	return coarse(String(text ?? "")).flatMap(fine)
}

/**
 * highlightCss(text, { badLines, warnLines }) → HTML for the highlight layer.
 * Every character of `text` is present in order (escaped); lines are wrapped
 * in `.hl-line`, tinted `.hl-bad` / `.hl-warn` when their 1-based number is in
 * the given sets. A trailing newline still yields a final (empty) line so the
 * layer is exactly as tall as the textarea.
 */
export function highlightCss(text, { badLines = new Set(), warnLines = new Set() } = {}) {
	const src = String(text ?? "")
	const lines = [[]]
	for (const t of tokenize(src)) {
		const parts = t.text.split("\n")
		parts.forEach((p, idx) => {
			if (idx) lines.push([])
			if (p) lines[lines.length - 1].push({ ...t, text: p })
		})
	}
	return lines
		.map((toks, i) => {
			const n = i + 1
			const cls = ["hl-line", badLines.has(n) && "hl-bad", warnLines.has(n) && "hl-warn"].filter(Boolean).join(" ")
			const body = toks
				.map((t) => {
					if (t.cls === "hl-ws") return esc(t.text)
					// a colour token is underlined in its own colour — an inline style,
					// but only ever a validated hex, and it adds NO width, which an
					// inline swatch would (the layer must stay under the textarea's text)
					const style = t.cls === "hl-color" && HEX_RE.test(t.color) ? ` style="text-decoration-color:${t.color}"` : ""
					return `<span class="${t.cls}"${style}>${esc(t.text)}</span>`
				})
				.join("")
			return `<span class="${cls}">${body}\n</span>`
		})
		.join("")
}

// The plain text a highlight layer would show — the invariant tests pin.
export const plainOf = (html) =>
	html
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
