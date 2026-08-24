// Build both a formatted-HTML and a plain-text version of the story —
// prose only, with formatting preserved and NO usernames or colors.
import { esc, siteName } from "./util.js"

export function buildExports(prompt, story, doc = document) {
	// block-formatted lines stand on their own; inline-only lines get a <p>
	const body = story
		.map((l) => (/^<(h1|h2|h3|p|hr)[ >]/.test(l.html || "") ? l.html : `<p>${l.html || ""}</p>`))
		.join("\n")
	const html = `<h3 class="prompt"><em>${esc(prompt)}</em></h3>\n${body}`
	const tmp = doc.createElement("div")
	const plain =
		`${prompt}\n\n` +
		story
			.map((l) => {
				tmp.innerHTML = (l.html || "").replace(/<br\s*\/?>/g, "\n")
				return tmp.textContent
			})
			.join("\n\n")
	return { html, plain }
}

// Self-contained, styled HTML document for download.
export function exportDocument(html) {
	return (
		`<!doctype html><html><head><meta charset="utf-8"><title>${esc(siteName())}</title>` +
		`<style>body{font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:48px auto;` +
		`padding:0 20px;line-height:1.75;font-size:18px;color:#1a1a1a}` +
		`h3.prompt{font-style:italic;color:#666;font-weight:normal;margin-bottom:1.5em;white-space:pre-line}p{margin:0 0 1em}` +
		`h1{font-size:1.6em}h2{font-size:1.35em}h3:not(.prompt){font-size:1.15em}` +
		`hr{border:0;border-top:1px solid #ccc;margin:1.4em 0}.al-c{text-align:center}.al-r{text-align:right}</style>` +
		`</head><body>${html}</body></html>`
	)
}
