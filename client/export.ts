// Build both a formatted-HTML and a plain-text version of the story —
// prose only, with formatting preserved and NO usernames or colors.
import { esc, siteName } from "./util.js"

export interface Exports {
	html: string
	plain: string
}
// the export's filename: the site's name and the game code, slugged
export const exportFileName = (code: string | undefined, ext: string): string => `${slugOf(siteName())}-${slugOf(code, "story")}.${ext}`

export interface ExportOpts {
	/** open every line with the writer's name — `<b>name:</b>` in bold, no colour */
	bylines?: boolean
}
export interface ExportLine {
	html?: string
	name?: string
}

const BLOCK_OPEN = /^<(h1|h2|h3|p|blockquote|ul|ol|hr)(\s[^>]*)?>/
const isBlock = (html: string): boolean => BLOCK_OPEN.test(html)

// The writer's signature for one line: `<b>name:</b> ` — bold, never a colour
// (AO3 drops style attributes and a pasted document shouldn't carry sixteen
// hues), and INSIDE the line's own first block so it sits on the same line as
// the words and keeps the block's alignment (a centred line stays centred, a
// heading stays a heading). A rule has no words, so it gets no name; a list
// signs its first item; an inline-only line is wrapped in a <p> first.
export const signature = (name: string | undefined): string => `<b>${esc(name || "someone")}:</b> `
export function signLine(html: string, name: string | undefined): string {
	const h = html || ""
	if (/^<hr[\s>]/.test(h)) return h
	if (!isBlock(h)) return `<p>${signature(name)}${h}</p>`
	// walk into the first block's opening tags — a blockquote's first <p>, a
	// list's first <li> — so the name lands beside the words, never on a line
	// of its own above them
	let at = 0
	for (;;) {
		const m = /^\s*<(p|h1|h2|h3|blockquote|ul|ol|li)(\s[^>]*)?>/.exec(h.slice(at))
		if (!m) break
		at += m[0].length
	}
	if (!at) return `<p>${signature(name)}${h}</p>`
	return h.slice(0, at) + signature(name) + h.slice(at)
}

export function buildExports(prompt: string, story: ExportLine[], doc: Document = document, { bylines = false }: ExportOpts = {}): Exports {
	// block-formatted lines stand on their own; inline-only lines get a <p>
	const body = story
		.map((l) => (bylines ? signLine(l.html || "", l.name) : isBlock(l.html || "") ? l.html : `<p>${l.html || ""}</p>`))
		.join("\n")
	const html = `<h3 class="prompt"><em>${esc(prompt)}</em></h3>\n${body}`
	const tmp = doc.createElement("div")
	const plain =
		`${prompt}\n\n` +
		story
			.map((l) => {
				tmp.innerHTML = (l.html || "").replace(/<br\s*\/?>/g, "\n").replace(/<\/li>\s*<li[^>]*>/g, "\n")
				const text = tmp.textContent || ""
				return bylines && !/^<hr[\s>]/.test(l.html || "") ? `${l.name || "someone"}: ${text}` : text
			})
			.join("\n\n")
	return { html, plain }
}

// ---- solo writes ----
export interface ExportChapter {
	title?: string
	html?: string
}
export interface ExportDoc {
	title?: string
	chapters?: ExportChapter[]
}
// A chapter on its own, or the whole work with every chapter headed and ruled
// apart. Chapter html is sanitizeDoc()-clean already; titles are esc()'d.
const chapterHead = (ch: ExportChapter, n: number): string => `<h2 class="chapter">${esc(ch.title || `Chapter ${n}`)}</h2>`
export const exportChapterHtml = (doc: ExportDoc, ch: ExportChapter, n: number = (doc.chapters || []).indexOf(ch) + 1 || 1): string =>
	`<h1>${esc(doc.title || "Untitled")}</h1>\n${chapterHead(ch, n)}\n${ch.html || ""}`
export const exportWork = (doc: ExportDoc): string =>
	`<h1>${esc(doc.title || "Untitled")}</h1>\n` + (doc.chapters || []).map((ch, i) => `${chapterHead(ch, i + 1)}\n${ch.html || ""}`).join("\n<hr>\n")
// a filename from a title: letters/digits/dashes, nothing else
export const slugOf = (t: unknown, fallback = "story"): string =>
	String(t || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || fallback

// Self-contained, styled HTML document for download.
export function exportDocument(html: string): string {
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
