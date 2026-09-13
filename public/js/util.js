// Shared client kernel: palette, escaping, and tiny render helpers.
// The palette mirrors PALETTE in server.js — the server validates against it.
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"]

export const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// Any #rrggbb is a writer colour (custom ones come from the settings picker);
// the strict shape is what keeps it safe in a style= attribute.
export const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)
export const safeColor = (c) => (isHex(c) ? c.toLowerCase() : PALETTE[0])

// The app's name, from the <meta name="site-name"> the server renders into
// every page out of content/site.json (a jsdom test page has none → fallback).
export const siteName = () =>
	(typeof document !== "undefined" && document.querySelector('meta[name="site-name"]')?.content) || "Cowrite"

// "(host)" marker, placed AFTER a name everywhere it appears.
export const whoMarks = (o) => (o?.host || o?.isHost ? '<span class="host-tag">(host)</span>' : "")

// Gradient emojis, like the ones in an <h1>: wrap the LEADING emoji of an
// element's first text node in <span class="emoji-grad"> so CSS can fill it
// with the theme gradient (background-clip: text). Idempotent (a data flag),
// and it only touches a leading emoji so the label text is untouched. A pure
// emoji-only span (a nav/tab icon) is gradiented by CSS directly instead.
const LEAD_EMOJI = /^(\s*)(\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}])*)/u
export function gradEmoji(el) {
	if (!el || el.dataset.gradEmoji) return
	const t = el.firstChild
	if (!t || t.nodeType !== 3) return
	const m = LEAD_EMOJI.exec(t.nodeValue || "")
	if (!m || !m[2]) return
	el.dataset.gradEmoji = "1"
	const span = el.ownerDocument.createElement("span")
	span.className = "emoji-grad"
	span.textContent = m[1] + m[2]
	t.nodeValue = (t.nodeValue || "").slice(m[0].length)
	el.insertBefore(span, t)
}
export const gradEmojisIn = (root, sel) => (root || document).querySelectorAll(sel).forEach(gradEmoji)

// Gradient EVERY emoji on the page (not just a leading one), the way an <h1>'s
// emoji is filled — EXCEPT rank/badge emojis (those are meaningful coloured
// rewards) and anything inside an editable surface or form field (wrapping a
// span there would corrupt what the user is writing). A MutationObserver keeps
// re-rendered UI (chat, live games, toasts) gradiented too.
const EMOJI_ONE = /\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}])*/u
const EMOJI_ALL = new RegExp(EMOJI_ONE.source, "gu")
// Subtrees we must not touch: editors/inputs (content integrity), the
// rank/badge economy (kept in full colour), and the two conversation surfaces —
// the game's chat section and the write page's comments drawer, its edge tab and
// the Comment chip — whose icons and messages stay plain.
const EMOJI_SKIP =
	'[contenteditable], .editor, .doc-editor, #docEditor, #docSource, .ProseMirror, textarea, input, script, style, ' +
	'.emoji-grad, .badge-chip, .ach-strip, [data-badge], .rk-badge, .rk-ladder, .rk-usage, .ladder-acc, .rung, ' +
	'.rank-bar, .rank-label, .tier-name, .rk-tier, .ts-badges, ' +
	'#chatCard, #docSide, #commentsOpen, #commentToggle, #imgBtn'
function wrapEmojis(node) {
	const val = node.nodeValue || ""
	EMOJI_ALL.lastIndex = 0
	if (!EMOJI_ALL.test(val)) return
	EMOJI_ALL.lastIndex = 0
	const doc = node.ownerDocument
	const frag = doc.createDocumentFragment()
	let last = 0, m
	while ((m = EMOJI_ALL.exec(val))) {
		if (m.index > last) frag.appendChild(doc.createTextNode(val.slice(last, m.index)))
		const span = doc.createElement("span")
		span.className = "emoji-grad"
		span.textContent = m[0]
		frag.appendChild(span)
		last = m.index + m[0].length
	}
	if (last < val.length) frag.appendChild(doc.createTextNode(val.slice(last)))
	node.parentNode.replaceChild(frag, node)
}
export function gradAllEmojis(root) {
	if (!root) return
	const rootEl = root.nodeType === 1 ? root : document.body
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
	const nodes = []
	while (walker.nextNode()) nodes.push(walker.currentNode)
	nodes.forEach(wrapEmojis)
}
let emojiObserver = null
export function watchEmojis(root = document.body) {
	gradAllEmojis(root)
	if (emojiObserver || typeof MutationObserver === "undefined") return
	let queued = new Set()
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
				if (n.nodeType === 1) queued.add(n)
				else if (n.nodeType === 3 && n.parentElement) queued.add(n.parentElement)
			}
		if (queued.size && !scheduled) {
			scheduled = true
			;(window.requestAnimationFrame || setTimeout)(flush)
		}
	})
	emojiObserver.observe(root, { childList: true, subtree: true })
}

// Tiny round profile pic used beside names (roster, chat, players row,
// writers directory). Empty string when the account has no picture.
// avatarFit is the user's preference: "cover" crops to fill, "contain" zooms
// out to fit the whole image.
// Without a picture: a disc in the user's chosen color with their initial.
export const miniAvatar = (o) => {
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
}
const PROMPT_CATS = Object.keys(PROMPT_CAT_TIPS)
const CAT_RE = new RegExp("^(?:\\u2022 )?(" + PROMPT_CATS.join("|") + "): ")
export const promptHtml = (prompt) => {
	const lines = String(prompt || "").split("\n").filter((l) => l.trim())
	const rows = lines.map((l) => l.match(CAT_RE))
	if (!lines.length || rows.some((m) => !m)) return esc(String(prompt || ""))
	return `<span class="prompt-grid">${lines
		.map((l, i) => {
			const cat = rows[i][1]
			return `<span class="pc pc-${cat.toLowerCase()}" title="${esc(PROMPT_CAT_TIPS[cat])}">${cat}</span><span class="pc-val">${esc(l.slice(rows[i][0].length))}</span>`
		})
		.join("")}</span>`
}

// A prompt is a stack of bulleted clauses when it was assembled by guided mode
// (lib/prompt-gen.js). Anywhere it stands in for a TITLE — a card, a listing,
// a delete confirmation — it has to collapse back to one line first.
export const oneLinePrompt = (prompt) =>
	String(prompt || "")
		.split("\n")
		.map((l) => l.replace(/^\u2022 /, "").trim())
		.filter(Boolean)
		.join(" ")
