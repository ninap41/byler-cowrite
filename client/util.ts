// Shared client kernel: palette, escaping, and tiny render helpers.
// The palette mirrors PALETTE in src/sanitize.js — the server validates against it.
import type { HexColor, RichHtml } from "./shared/brands.js"
import type { Who } from "./shared/wire.js"

export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"] as HexColor[]

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
/** Escape text for html. The result is safe to inject, so it is RichHtml. */
export const esc = (s: unknown): RichHtml => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c) as RichHtml

// Any #rrggbb is a writer colour (custom ones come from the settings picker);
// the strict shape is what keeps it safe in a style= attribute.
export const isHex = (c: unknown): c is HexColor => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)
export const safeColor = (c: unknown): HexColor => (isHex(c) ? (c.toLowerCase() as HexColor) : PALETTE[0]!)

// The app's name, from the <meta name="site-name"> the server renders into
// every page out of content/site.json (a jsdom test page has none → fallback).
export const siteName = (): string =>
	(typeof document !== "undefined" && document.querySelector<HTMLMetaElement>('meta[name="site-name"]')?.content) || "Cowrite"

// "(host)" marker, placed AFTER a name everywhere it appears.
export const whoMarks = (o?: Pick<Who, "host" | "isHost"> | null): string => (o?.host || o?.isHost ? '<span class="host-tag">(host)</span>' : "")

// Gradient emojis, like the ones in an <h1>: wrap the LEADING emoji of an
// element's first text node in <span class="emoji-grad"> so CSS can fill it
// with the theme gradient (background-clip: text). Idempotent (a data flag),
// and it only touches a leading emoji so the label text is untouched. A pure
// emoji-only span (a nav/tab icon) is gradiented by CSS directly instead.
const LEAD_EMOJI = /^(\s*)(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[︀-️\u{1F3FB}-\u{1F3FF}])*)/u
export function gradEmoji(el: HTMLElement | null | undefined): void {
	if (!el || el.dataset.gradEmoji) return
	const t = el.firstChild
	if (!t || t.nodeType !== 3) return
	const m = LEAD_EMOJI.exec(t.nodeValue || "")
	if (!m || !m[2]) return
	el.dataset.gradEmoji = "1"
	const span = el.ownerDocument.createElement("span")
	span.className = "emoji-grad"
	span.textContent = (m[1] ?? "") + m[2]
	t.nodeValue = (t.nodeValue || "").slice(m[0].length)
	el.insertBefore(span, t)
}
export const gradEmojisIn = (root: ParentNode | null | undefined, sel: string): void =>
	(root || document).querySelectorAll<HTMLElement>(sel).forEach(gradEmoji)

// Gradient EVERY emoji on the page (not just a leading one), the way an <h1>'s
// emoji is filled — EXCEPT rank/badge emojis (those are meaningful coloured
// rewards) and anything inside an editable surface or form field (wrapping a
// span there would corrupt what the user is writing). A MutationObserver keeps
// re-rendered UI (chat, live games, toasts) gradiented too.
const EMOJI_ONE = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[︀-️\u{1F3FB}-\u{1F3FF}])*/u
const EMOJI_ALL = new RegExp(EMOJI_ONE.source, "gu")
// Subtrees we must not touch: editors/inputs (content integrity), the
// rank/badge economy (kept in full colour), and the two conversation surfaces —
// the game's chat section and the write page's comments drawer, its edge tab and
// the Comment chip — whose icons and messages stay plain.
const EMOJI_SKIP =
	'[contenteditable], .editor, .doc-editor, #docEditor, #docSource, .ProseMirror, textarea, input, script, style, ' +
	'.emoji-grad, .badge-chip, .ach-strip, [data-badge], .rk-badge, .rk-ladder, .rk-usage, .ladder-acc, .rung, ' +
	'.rank-bar, .rank-label, .tier-name, .rk-tier, .ts-badges, ' +
	'#chatCard, #docSide, #commentsOpen, #commentToggle, #imgBtn, .react-pick, ' +
	// the solo editor's head row is icon-only chips: each one IS its emoji
	'.head-chip, .vis-chip, .vis-menu, ' +
	// the SuperSoaker's gun IS the 🔫 emoji (mirrored and rotated to the aim), so a
	// gradient outline there paints a hollow gun — the whole layer stays plain
	'.sk-layer, .sk-gunbtn'
function wrapEmojis(node: Text): void {
	const val = node.nodeValue || ""
	EMOJI_ALL.lastIndex = 0
	if (!EMOJI_ALL.test(val)) return
	EMOJI_ALL.lastIndex = 0
	const doc = node.ownerDocument
	const frag = doc.createDocumentFragment()
	let last = 0
	let m: RegExpExecArray | null
	while ((m = EMOJI_ALL.exec(val))) {
		if (m.index > last) frag.appendChild(doc.createTextNode(val.slice(last, m.index)))
		const span = doc.createElement("span")
		span.className = "emoji-grad"
		span.textContent = m[0]
		frag.appendChild(span)
		last = m.index + m[0].length
	}
	if (last < val.length) frag.appendChild(doc.createTextNode(val.slice(last)))
	node.parentNode?.replaceChild(frag, node)
}
export function gradAllEmojis(root: Node | null | undefined): void {
	if (!root) return
	const rootEl: Element = root.nodeType === 1 ? (root as Element) : document.body
	if (rootEl.closest && rootEl.closest(EMOJI_SKIP)) return
	const doc = rootEl.ownerDocument || document
	const walker = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, {
		acceptNode(n) {
			if (!n.nodeValue || !n.parentElement) return 2 /* REJECT */
			if (n.parentElement.closest(EMOJI_SKIP)) return 2
			EMOJI_ALL.lastIndex = 0
			return EMOJI_ALL.test(n.nodeValue) ? 1 /* ACCEPT */ : 2
		},
	})
	const nodes: Text[] = []
	while (walker.nextNode()) nodes.push(walker.currentNode as Text)
	nodes.forEach(wrapEmojis)
}
let emojiObserver: MutationObserver | null = null
export function watchEmojis(root: Node = document.body): void {
	gradAllEmojis(root)
	if (emojiObserver || typeof MutationObserver === "undefined") return
	let queued = new Set<Element>()
	let scheduled = false
	const flush = () => {
		scheduled = false
		const batch = [...queued]
		queued = new Set()
		for (const el of batch) if (el.isConnected) gradAllEmojis(el)
	}
	emojiObserver = new MutationObserver((muts) => {
		for (const mu of muts)
			for (const n of mu.addedNodes) {
				if (n.nodeType === 1) queued.add(n as Element)
				else if (n.nodeType === 3 && n.parentElement) queued.add(n.parentElement)
			}
		if (queued.size && !scheduled) {
			scheduled = true
			;(window.requestAnimationFrame || setTimeout)(flush)
		}
	})
	emojiObserver.observe(root, { childList: true, subtree: true })
}

/** What miniAvatar needs: a picture, or a name (either spelling) and a colour for the initial disc. */
export interface Avatarish {
	avatar?: string | null
	avatarFit?: string | null
	name?: string | null
	username?: string | null
	color?: string | null
}
// Tiny round profile pic used beside names (roster, chat, players row,
// writers directory). Empty string when the account has no picture.
// avatarFit is the user's preference: "cover" crops to fill, "contain" zooms
// out to fit the whole image.
// Without a picture: a disc in the user's chosen color with their initial.
export const miniAvatar = (o?: Avatarish | null): string => {
	if (!o) return ""
	if (o.avatar)
		return `<img class="mini-avatar fit-${o.avatarFit === "contain" ? "contain" : "cover"}" src="${esc(o.avatar)}" alt="" loading="lazy">`
	const name = o.name || o.username
	if (!name) return ""
	return `<span class="mini-avatar mini-initial" style="background:${safeColor(o.color)}">${esc(String(name).charAt(0).toUpperCase())}</span>`
}

// A guided prompt's clauses open "Category: choice" (lib/prompt-gen.js
// CATEGORIES). promptHtml escapes the whole prompt and, when every line is a
// clause, lays them out as a grid of category | choice rows — the category
// name in a span classed by that name so `.pc-season` etc. in base.css give
// each one the same colour everywhere. A curated prompt has no such prefix
// and comes back as plain escaped text; nothing user-typed can become markup.
// What each category means — the tooltip on its name.
export const PROMPT_CAT_TIPS = {
	Season: "When it's set, which season of the show, or after it. Fixes how old they are.",
	Canon: "How close to the show: compliant, one thing diverges, or an alternate universe.",
	Place: "Where the scene happens.",
	Relationship: "Where they stand with each other when the story opens.",
	Situation: "What kind of moment this is.",
	Trope: "A fanfic trope to build the story around.",
	Tone: "The feel of the piece.",
	Rating: "Explicit: on the page. Only in Season 4, Season 5 or a future fic.",
	Kinks: "How it starts, the dynamic between them, what happens, and the emotional key it's played in.",
} as const
export type PromptCategory = keyof typeof PROMPT_CAT_TIPS
const PROMPT_CATS = Object.keys(PROMPT_CAT_TIPS) as PromptCategory[]
const CAT_RE = new RegExp("^(?:\\u2022 )?(" + PROMPT_CATS.join("|") + "): ")
export const promptHtml = (prompt: unknown): RichHtml => {
	const lines = String(prompt || "").split("\n").filter((l) => l.trim())
	const rows = lines.map((l) => l.match(CAT_RE))
	if (!lines.length || rows.some((m) => !m)) return esc(String(prompt || ""))
	return `<span class="prompt-grid">${lines
		.map((l, i) => {
			const m = rows[i]!
			const cat = m[1] as PromptCategory
			return `<span class="pc pc-${cat.toLowerCase()}" title="${esc(PROMPT_CAT_TIPS[cat])}">${cat}</span><span class="pc-val">${esc(l.slice(m[0].length))}</span>`
		})
		.join("")}</span>` as RichHtml
}

// A prompt is a stack of bulleted clauses when it was assembled by guided mode
// (lib/prompt-gen.js). Anywhere it stands in for a TITLE — a card, a listing,
// a delete confirmation — it has to collapse back to one line first.
export const oneLinePrompt = (prompt: unknown): string =>
	String(prompt || "")
		.split("\n")
		.map((l) => l.replace(/^• /, "").trim())
		.filter(Boolean)
		.join(" ")
