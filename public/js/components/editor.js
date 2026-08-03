// Convert the contenteditable into the safe subset the server re-enables:
// b/i/u inline, h1-h3/p blocks (alignment as al-c / al-r classes), br, hr.
// This is convenience only, NOT a security control — sanitizeRich() on the
// server is the trust boundary. Text passes through RAW: the server escapes
// exactly once, so pre-escaping here would double-escape quotes/& (they'd
// render as literal &quot; in the story).
export function cleanHtml(el) {
	const inline = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u" }
	const blocks = { H1: "h1", H2: "h2", H3: "h3", P: "p", DIV: "p" }
	const alignCls = (n) => {
		const a = (n.style && n.style.textAlign) || n.getAttribute?.("align") || ""
		return a === "center" ? ' class="al-c"' : a === "right" ? ' class="al-r"' : ""
	}
	const walk = (node) => {
		let out = ""
		node.childNodes.forEach((n) => {
			if (n.nodeType === 3) {
				out += n.nodeValue
			} else if (n.nodeType === 1) {
				const tag = n.nodeName
				if (tag === "BR") out += "<br>"
				else if (tag === "HR") out += "<hr>"
				else if (inline[tag]) out += `<${inline[tag]}>` + walk(n) + `</${inline[tag]}>`
				else if (blocks[tag]) {
					const inner = walk(n)
					if (inner.trim() || inner.includes("<hr>")) out += `<${blocks[tag]}${alignCls(n)}>` + inner + `</${blocks[tag]}>`
				} else out += walk(n)
			}
		})
		return out
	}
	return walk(el)
}
