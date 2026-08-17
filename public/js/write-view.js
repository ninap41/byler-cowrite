// Pure string builders for the solo-write pages (same convention as
// archive-view.js / dashboard-view.js: no DOM access, so tests can call them
// directly). Doc html arrives already sanitizeDoc()'d server-side and is
// injected as-is by design; every name/title/comment is esc()'d here.
import { esc, safeColor, miniAvatar } from "./util.js"

export const fmtWhen = (ts) => {
	if (!ts) return ""
	const d = new Date(ts)
	const mins = Math.round((Date.now() - ts) / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	if (mins < 1440) return `${Math.round(mins / 60)}h ago`
	return d.toLocaleDateString()
}

export const wordsLabel = (n) => `${n || 0} word${n === 1 ? "" : "s"}`

// ---- html source pretty-printing ----
// The HTML view puts one block per line so a 7k-word chapter isn't a single wall
// of text. The newlines go ONLY at tag boundaries — between a `>` and the next
// block-level `<` — never inside text, and unformatSource() strips them again
// before the string is parsed or saved. That's what keeps the cosmetic breaks
// from ever turning into <br>s or stray whitespace in the rich text.
const BLOCK_TAG = /^<\/?(?:p|h1|h2|h3|hr|ul|ol|li|blockquote|figure|figcaption|div)[\s>/]/i
export const formatSource = (html) => String(html || "").replace(/>(?=<)/g, (m, i, s) => (BLOCK_TAG.test(s.slice(i + 1)) ? ">\n" : m))
export const unformatSource = (src) => String(src || "").replace(/>[\t ]*\n[\t \n]*</g, "><").trim()

// ---- clear formatting ----
// What the ✕ actually means: give me back plain left-aligned paragraphs. Every
// inline tag and every fs-* size span becomes its text, links lose their href,
// headings/list items/quotes all flatten to <p>, and <hr>s go. Line breaks are
// deliberately KEPT — clearing formatting shouldn't silently join two lines.
const PBH_BLOCKS = new Set(["P", "H1", "H2", "H3", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "TABLE", "TR", "TD"])
export function plainBlockHtml(html) {
	const box = document.createElement("div")
	box.innerHTML = String(html || "")
	const out = []
	let cur = ""
	const flush = () => {
		const t = cur.replace(/^[ \t]+|[ \t]+$/g, "")
		if (t) out.push(t)
		cur = ""
	}
	const walk = (node) => {
		for (const n of [...node.childNodes]) {
			if (n.nodeType === 3) cur += n.nodeValue
			else if (n.nodeType !== 1) continue
			else if (n.tagName === "BR") cur += "\n"
			else if (n.tagName === "HR" || n.tagName === "IMG") flush()
			else if (PBH_BLOCKS.has(n.tagName)) (flush(), walk(n), flush())
			else walk(n) // inline (b/i/u/s/em/strong/a/span/font) — keep only the text
		}
	}
	walk(box)
	flush()
	return out.map((t) => `<p>${esc(t).replace(/\n/g, "<br>")}</p>`).join("")
}

// Where the page has to scroll to put a comment's words in the middle of the
// window, clear of the sticky head. Pure arithmetic so it can be tested — the
// element-and-window part is the caller's problem.
//   rectTop   – the words' current offset from the top of the viewport
//   rectH     – their height
//   scrollY   – where the page is now
//   viewportH – the window's height
//   headH     – the sticky head, which is not usable space
//   maxScroll – the furthest the page can go (doc height - viewport)
export function scrollTargetFor({ rectTop, rectH = 0, scrollY, viewportH, headH = 0, maxScroll = Infinity }) {
	const usable = Math.max(0, viewportH - headH)
	const want = scrollY + rectTop - headH - Math.max(0, (usable - rectH) / 2)
	return Math.max(0, Math.min(Math.round(want), Math.max(0, Math.round(maxScroll))))
}

// ---- visibility ----
// One vocabulary for all three levels, used by the editor's chip, its menu and
// the listing pills — so the thing you set and the thing you see are visibly
// the same object. Mirrors VISIBILITIES in src/docs.js.
export const VIS = {
	private: { icon: "🔒", label: "Private", blurb: "Only you." },
	readers: { icon: "👥", label: "Beta readers", blurb: "The friends you invite can read and comment." },
	public: { icon: "🌍", label: "Public", blurb: "Anyone with an account can read it. Only your beta readers can comment." },
}
export const visOf = (v) => VIS[v] || VIS.private
export const visLabel = (v) => `${visOf(v).icon} ${visOf(v).label}`

// The chip in the editor head: it names the CURRENT state rather than an
// action, so you can read where you stand without decoding a checkbox.
export const visChipHtml = (v) =>
	`<button type="button" class="vis-chip" id="visChip" aria-haspopup="menu" aria-expanded="false" ` +
	`data-tip="Who can see this write" data-vis="${esc(v)}">${visLabel(v)}<span class="chev">&#9662;</span></button>`

// Three options, each with its consequence spelled out. A radio list, not a
// switch: three states can't be a toggle.
export const visMenuHtml = (current) =>
	`<div class="vis-menu" id="visMenu" role="menu">` +
	Object.entries(VIS)
		.map(
			([key, v]) =>
				`<button type="button" class="vis-opt${key === current ? " on" : ""}" role="menuitemradio" ` +
				`aria-checked="${key === current}" data-vis="${key}">` +
				`<span class="vis-opt-label">${v.icon} ${esc(v.label)}</span>` +
				`<span class="vis-opt-blurb">${esc(v.blurb)}</span></button>`,
		)
		.join("") +
	`</div>`

// ---- /writes listing ----
export function docCardHtml(d) {
	const v = d.visibility || "private"
	return (
		`<article class="doc-card" data-id="${esc(d.id)}">` +
		`<h3 class="doc-card-title">${esc(d.title)}</h3>` +
		`<p class="doc-card-meta">${esc(wordsLabel(d.wordCount))} · ${esc(fmtWhen(d.updatedAt))}` +
		(d.mine ? "" : ` · by ${esc(d.owner)}`) +
		`</p>` +
		`<p class="doc-card-tags">` +
		(d.mine
			? `<span class="doc-pill ${v === "private" ? "" : "on"}">${visLabel(v)}</span>`
			: `<span class="doc-pill on">${v === "public" ? "📖 Public read" : "📖 Beta reading"}</span>`) +
		(d.comments ? `<span class="doc-pill">💬 ${d.comments}</span>` : "") +
		(d.readers?.length ? `<span class="doc-pill">✍ ${esc(d.readers.join(", "))}</span>` : "") +
		`</p>` +
		`<div class="row doc-card-actions">` +
		`<a class="ghost doc-open" href="/write?id=${encodeURIComponent(d.id)}">Open</a>` +
		(d.mine ? `<button class="ghost danger doc-del" type="button">Delete</button>` : "") +
		`</div>` +
		`</article>`
	)
}

export const docListHtml = (docs) =>
	!docs || !docs.length
		? `<p class="empty">Nothing written yet. Start something — no timer, no turns, just the page.</p>`
		: docs.map(docCardHtml).join("")

// ---- presence ----
// Beta readers currently viewing. Tooltips come from the shared data-tip system.
export const presenceHtml = (viewers) =>
	!viewers || !viewers.length
		? ""
		: viewers
				.map(
					(v) =>
						`<span class="presence-av" data-tip="${esc(v.username)}">${miniAvatar({
							avatar: v.avatar,
							avatarFit: v.avatarFit,
							name: v.username,
							color: v.color,
						})}</span>`,
				)
				.join("")

// ---- comments ----
// A card knows what it's pinned to (`cid`), so clicking it can jump to the
// underlined words and the underline can jump back. A comment carrying a
// `suggestion` is a proposed rewrite: the AUTHOR gets Accept/Reject, everyone
// else just sees what was proposed — the server enforces that either way.
export function commentHtml(c, { isOwner = false, meName = "" } = {}) {
	// Resolve/Delete are the server's rule made visible: only the comment's own
	// author or the document's author may touch it. Showing those buttons to a
	// beta reader on someone else's note would just be a click that does nothing.
	const canManage = isOwner || (!!meName && c.author === meName)
	const cls = ["doc-comment", c.resolved && "resolved", c.orphaned && "orphaned", c.suggestion != null && "suggested"]
	const decided = c.resolved && c.suggestion != null
	return (
		`<li class="${cls.filter(Boolean).join(" ")}" data-id="${esc(c.id)}" data-cid="${esc(c.cid || "")}">` +
		`<span class="dc-who">${miniAvatar({ avatar: c.avatar, avatarFit: c.avatarFit, name: c.author, color: c.color })}` +
		`<b style="color:${safeColor(c.color)}">${esc(c.author)}</b>` +
		(c.isAuthor ? `<span class="dc-tag">author</span>` : "") +
		`<span class="dc-when">${esc(fmtWhen(c.ts))}</span></span>` +
		(c.suggestion != null
			? `<p class="dc-suggest"><s>${esc(c.quote || "")}</s> <span class="dc-arrow">→</span> <ins>${esc(c.suggestion)}</ins></p>`
			: c.quote
				? `<p class="dc-quote">${esc(c.quote)}</p>`
				: "") +
		(c.text ? `<p class="dc-text">${esc(c.text)}</p>` : "") +
		(decided ? `<p class="dc-verdict">${c.accepted ? "✓ Accepted" : "Not taken"}</p>` : "") +
		`<span class="dc-actions">` +
		(c.suggestion != null && !c.resolved && isOwner
			? `<button class="linky dc-accept" type="button">Accept</button><button class="linky dc-reject" type="button">Reject</button>`
			: canManage
				? `<button class="linky dc-resolve" type="button">${c.resolved ? "Unresolve" : "Resolve"}</button>`
				: "") +
		(canManage ? `<button class="linky dc-del" type="button">Delete</button>` : "") +
		`</span>` +
		`</li>`
	)
}

// Comments grouped under the block they're anchored to, plus any that lost
// their anchor when the author edited that text.
export function commentThreadHtml(comments, { orphaned = false, isOwner = false, meName = "" } = {}) {
	if (!comments.length) return ""
	return (
		(orphaned
			? `<p class="dc-orphan-note">${comments.length === 1 ? "This comment was" : "These comments were"} left on text that has since changed:</p>`
			: "") +
		`<ul class="dc-list">${comments.map((c) => commentHtml(c, { isOwner, meName })).join("")}</ul>`
	)
}

// ---- beta-reader chips ----
export const readerChipsHtml = (readers, canManage) =>
	!readers || !readers.length
		? `<p class="subtle">No beta readers yet. Invite a friend to read along and comment.</p>`
		: readers
				.map(
					(r) =>
						`<span class="reader-chip" data-user="${esc(r.username)}">` +
						miniAvatar({ avatar: r.avatar, avatarFit: r.avatarFit, name: r.username, color: r.color }) +
						`<span>${esc(r.username)}</span>` +
						(canManage ? `<button class="reader-x" type="button" title="Remove">×</button>` : "") +
						`</span>`,
				)
				.join("")
