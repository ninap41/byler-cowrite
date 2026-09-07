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

// ---- solo writes ----
// A chapter on its own, or the whole work with every chapter headed and ruled
// apart. Chapter html is sanitizeDoc()-clean already; titles are esc()'d.
const chapterHead = (ch, n) => `<h2 class="chapter">${esc(ch.title || `Chapter ${n}`)}</h2>`
export const exportChapterHtml = (doc, ch, n = (doc.chapters || []).indexOf(ch) + 1 || 1) =>
	`<h1>${esc(doc.title || "Untitled")}</h1>\n${chapterHead(ch, n)}\n${ch.html || ""}`
export const exportWork = (doc) =>
	`<h1>${esc(doc.title || "Untitled")}</h1>\n` +
	(doc.chapters || []).map((ch, i) => `${chapterHead(ch, i + 1)}\n${ch.html || ""}`).join("\n<hr>\n")
// a filename from a title: letters/digits/dashes, nothing else
export const slugOf = (t, fallback = "story") =>
	String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback

// Self-contained, styled HTML document for download.
export function exportDocument(html) {
	return (
		`<!doctype html><html><head><meta charset="utf-8"><title>${esc(siteName())}</title>` +
		`<style>body{font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:48px auto;` +
		`padding:0 20px;line-height:1.75;font-size:18px;color:#1a1a1a}` +
		`h3.prompt{font-style:italic;color:#666;font-weight:normal;margin-bottom:1.5em;white-space:pre-line}p{margin:0 0 1em}` +
		`h1{font-size:1.6em}h2{font-size:1.35em}h3:not(.prompt){font-size:1.15em}` +
		`hr{border:0;border-top:1px solid #ccc;margin:1.4em 0}.al-c{text-align:center}.al-r{text-align:right}` +
		`h2.chapter{margin-top:2.4em}</style>` +
		`</head><body>${html}</body></html>`
	)
}
