// The story as a PDF, drawn with jsPDF (loaded from the CDN only when someone
// asks for one) — the same lines the html export carries, with an optional
// bold `name:` opening each line, and the browser's print-to-PDF as the
// fallback when the CDN is out of reach.
import { exportDocument, type ExportLine } from "./export.js"

/** The slice of jsPDF the export uses. */
export interface JsPdfDoc {
	internal: { pageSize: { getWidth(): number; getHeight(): number } }
	setFont(name: string, style: string): void
	setFontSize(n: number): void
	setDrawColor(n: number): void
	splitTextToSize(text: string, width: number): string[]
	getTextWidth(text: string): number
	text(text: string, x: number, y: number, opts?: { align?: string }): void
	line(x1: number, y1: number, x2: number, y2: number): void
	addPage(): void
	save(name: string): void
}
export interface JsPdfModule {
	jsPDF: new (opts: { unit: string; format: string }) => JsPdfDoc
}
declare global {
	interface Window {
		jspdf?: JsPdfModule
	}
}

let jsPdfPromise: Promise<JsPdfModule> | null = null
export const loadJsPdf = (): Promise<JsPdfModule> =>
	(jsPdfPromise ??= new Promise<JsPdfModule>((res, rej) => {
		if (window.jspdf) return res(window.jspdf)
		const s = document.createElement("script")
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
		s.onload = () => res(window.jspdf!)
		s.onerror = () => {
			jsPdfPromise = null
			rej(new Error("Could not load the PDF library."))
		}
		document.head.appendChild(s)
	}))

export interface PdfOpts {
	bylines?: boolean
	doc?: Document
}

/** One story line's shape for the page: tag, alignment, text. Pure. */
export function pdfLine(html: string, doc: Document = document): { tag: string; align: "left" | "center" | "right"; text: string } {
	const m = /^<(h1|h2|h3|p|blockquote|ul|ol|hr)( class="(al-c|al-r)")?[ >]/.exec(html)
	const tag = m?.[1] || "p"
	const align = m?.[3] === "al-c" ? "center" : m?.[3] === "al-r" ? "right" : "left"
	const tmp = doc.createElement("div")
	// a list item becomes a bulleted line of its own
	tmp.innerHTML = html.replace(/<br\s*\/?>/g, "\n").replace(/<li[^>]*>/g, "• ").replace(/<\/li>/g, "\n")
	return { tag, align, text: (tmp.textContent || "").trim() }
}

export function storyToPdf(jspdf: JsPdfModule, prompt: string, story: ExportLine[], file: string, { bylines = false, doc: dom = document }: PdfOpts = {}) {
	const doc = new jspdf.jsPDF({ unit: "pt", format: "a4" })
	const M = 64,
		W = doc.internal.pageSize.getWidth() - M * 2,
		BOTTOM = doc.internal.pageSize.getHeight() - M
	let y = M
	const newLine = (lh: number) => {
		if (y + lh > BOTTOM) {
			doc.addPage()
			y = M
		}
	}
	const xFor = (align: string) => (align === "center" ? M + W / 2 : align === "right" ? M + W : M)
	// a run of lines in one face; `lead` is a bold run drawn at the start of
	// the first line, the text flowing on after it
	const put = (text: string, size: number, style: string, align = "left", lead = "") => {
		doc.setFontSize(size)
		const lh = size * 1.55
		let lines: string[]
		if (lead) {
			doc.setFont("times", "bold")
			const lw = doc.getTextWidth(lead + " ")
			doc.setFont("times", style)
			const first = doc.splitTextToSize(text, Math.max(40, W - lw))
			const head = first[0] || ""
			const rest = text.slice(head.length).trim()
			lines = [head, ...(rest ? doc.splitTextToSize(rest, W) : [])]
			newLine(lh)
			if (align === "left") {
				doc.setFont("times", "bold")
				doc.text(lead, M, y)
				doc.setFont("times", style)
				doc.text(head, M + lw, y)
			} else {
				// centred/right text has no fixed left edge: place the pair as one measured run
				const tw = doc.getTextWidth(head)
				const x0 = align === "center" ? M + W / 2 - (lw + tw) / 2 : M + W - lw - tw
				doc.setFont("times", "bold")
				doc.text(lead, x0, y)
				doc.setFont("times", style)
				doc.text(head, x0 + lw, y)
			}
			y += lh
			lines = lines.slice(1)
		} else {
			doc.setFont("times", style)
			lines = doc.splitTextToSize(text, W)
		}
		for (const ln of lines) {
			newLine(lh)
			doc.text(ln, xFor(align), y, { align })
			y += lh
		}
	}
	if (prompt) {
		put(prompt, 13, "italic")
		y += 10
	}
	for (const l of story) {
		const { tag, align, text } = pdfLine(l.html || "", dom)
		if (tag === "hr") {
			newLine(20)
			doc.setDrawColor(180)
			doc.line(M, y, M + W, y)
			y += 20
			continue
		}
		if (!text) continue
		const size = tag === "h1" ? 22 : tag === "h2" ? 18 : tag === "h3" ? 15 : 12
		const style = tag === "h1" || tag === "h2" || tag === "h3" ? "bold" : tag === "blockquote" ? "italic" : "normal"
		// a signed list item keeps its bullet ahead of the name: "• name: item"
		const bullet = text.startsWith("• ") ? "• " : ""
		put(bullet ? text.slice(2) : text, size, style, align, bylines ? `${bullet}${l.name || "someone"}:` : "")
		y += 8
	}
	doc.save(file)
}

/** No jsPDF (offline, CDN blocked): open the html and let the browser print it. */
export function printFallback(html: string): boolean {
	const w = window.open("", "_blank")
	if (!w) return false
	w.document.write(exportDocument(html))
	w.document.close()
	w.focus()
	w.print()
	return true
}
