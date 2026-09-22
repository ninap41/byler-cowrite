// Pure string builders for the solo-write pages (same convention as
// archive-view.js / dashboard-view.js: no DOM access, so tests can call them
// directly). Doc html arrives already sanitizeDoc()'d server-side and is
// injected as-is by design; every name/title/comment is esc()'d here.
import { esc, safeColor, miniAvatar } from "./util.js"
import type { UserRef } from "./dashboard-view.js"
import { reactionsHtml } from "./shared/reactions.js"
import type { Reactions } from "./shared/reactions.js"

// ---- the shapes the solo-write pages render ----
/** A document as a shelf lists it (docSummary + mine/viewable, src/docs.js). */
export interface DocSummary {
	id: string
	title?: string
	wordCount?: number
	sprintWords?: number
	visibility?: string
	updatedAt?: number
	owner?: string
	readers?: string[]
	comments?: number
	mine?: boolean
	/** mine, or the viewer is an admin: the row offers Delete */
	deletable?: boolean
	viewable?: boolean
}
/** A comment row as the socket ships it (commentRows in src/game.js). */
export interface CommentRow {
	id: string
	cid?: string | null
	quote?: string
	text?: string
	suggestion?: string | null
	ts?: number
	resolved?: boolean
	accepted?: boolean
	orphaned?: boolean
	chapterId?: string | null
	author: string
	color?: string
	avatar?: string
	avatarFit?: string
	isAuthor?: boolean
	declined?: boolean
	edited?: boolean
	replies?: ReplyRow[]
	reactions?: Reactions
	pos?: { chapterId: string; start: number; text: string; before: string; after: string } | null
}
/** One reply in a comment's thread (DocReplyRow in shared/wire.ts). */
export interface ReplyRow {
	id: string
	/** the reply this one answers; null/absent = the note itself */
	parentId?: string | null
	reactions?: Reactions
	text: string
	ts?: number
	edited?: boolean
	author: string
	color?: string
	avatar?: string
	avatarFit?: string
	isAuthor?: boolean
}
export interface CommentViewOpts {
	isOwner?: boolean
	meName?: string
	/** the viewer may write on this document (author or invited beta reader) */
	canReply?: boolean
}
/** A writer in the invite picker: a /api/users row plus whether they're a friend. */
export interface InviteRow extends UserRef {
	friend: boolean
	requested?: boolean
}
export interface Chapter {
	id?: string | null
	title?: string
	html?: string
	wordCount?: number
}
export interface Sprint {
	docId?: string
	title?: string
	words?: number
	seconds?: number
	at?: number
}

export const fmtWhen = (ts: number | null | undefined): string => {
	if (!ts) return ""
	const d = new Date(ts)
	const mins = Math.round((Date.now() - ts) / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	if (mins < 1440) return `${Math.round(mins / 60)}h ago`
	return d.toLocaleDateString()
}

export const wordsLabel = (n: number | undefined): string => `${n || 0} word${n === 1 ? "" : "s"}`

// ---- html source pretty-printing ----
// The HTML view puts one block per line so a 7k-word chapter isn't a single wall
// of text. The newlines go ONLY at tag boundaries — between a `>` and the next
// block-level `<` — never inside text, and unformatSource() strips them again
// before the string is parsed or saved. That's what keeps the cosmetic breaks
// from ever turning into <br>s or stray whitespace in the rich text.
const BLOCK_TAG = /^<\/?(?:p|h1|h2|h3|hr|ul|ol|li|blockquote|figure|figcaption|div)[\s>/]/i
export const formatSource = (html: unknown): string => String(html || "").replace(/>(?=<)/g, (m: string, i: number, s: string) => (BLOCK_TAG.test(s.slice(i + 1)) ? ">\n" : m))
export const unformatSource = (src: unknown): string => String(src || "").replace(/>[\t ]*\n[\t \n]*</g, "><").trim()

// ---- clear formatting ----
// What the ✕ actually means: give me back plain left-aligned paragraphs. Every
// inline tag and every fs-* size span becomes its text, links lose their href,
// headings/list items/quotes all flatten to <p>, and <hr>s go. Line breaks are
// deliberately KEPT — clearing formatting shouldn't silently join two lines.
const PBH_BLOCKS = new Set(["P", "H1", "H2", "H3", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "TABLE", "TR", "TD"])
export function plainBlockHtml(html: unknown): string {
	const box = document.createElement("div")
	box.innerHTML = String(html || "")
	const out: string[] = []
	let cur = ""
	const flush = () => {
		const t = cur.replace(/^[ \t]+|[ \t]+$/g, "")
		if (t) out.push(t)
		cur = ""
	}
	const walk = (node: Node): void => {
		for (const c of [...node.childNodes]) {
			if (c.nodeType === 3) cur += c.nodeValue
			else if (c.nodeType !== 1) continue
			else {
				const n = c as Element
				if (n.tagName === "BR") cur += "\n"
				else if (n.tagName === "HR" || n.tagName === "IMG") flush()
				else if (PBH_BLOCKS.has(n.tagName)) (flush(), walk(n), flush())
				else walk(n)
			} // inline (b/i/u/s/em/strong/a/span/font) — keep only the text
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
export interface ScrollTargetOpts {
	rectTop: number
	rectH?: number
	scrollY: number
	viewportH: number
	headH?: number
	maxScroll?: number
}
export function scrollTargetFor({ rectTop, rectH = 0, scrollY, viewportH, headH = 0, maxScroll = Infinity }: ScrollTargetOpts): number {
	const usable = Math.max(0, viewportH - headH)
	const want = scrollY + rectTop - headH - Math.max(0, (usable - rectH) / 2)
	return Math.max(0, Math.min(Math.round(want), Math.max(0, Math.round(maxScroll))))
}

// ---- visibility ----
// One vocabulary for all three levels, used by the editor's chip, its menu and
// the listing pills — so the thing you set and the thing you see are visibly
// the same object. Mirrors VISIBILITIES in src/docs.js.
export type Visibility = "private" | "readers" | "public"
export const VIS: Record<Visibility, { icon: string; label: string; blurb: string }> = {
	private: { icon: "🔒", label: "Private", blurb: "Only you." },
	readers: { icon: "👥", label: "Beta readers", blurb: "The friends you invite can read and comment." },
	public: { icon: "🌍", label: "Public", blurb: "Anyone with an account can read it. Only your beta readers can comment." },
}
export const visOf = (v: unknown) => VIS[v as Visibility] || VIS.private
export const visLabel = (v: unknown): string => `${visOf(v).icon} ${visOf(v).label}`

// The chip in the editor head: it names the CURRENT state rather than an
// action, so you can read where you stand without decoding a checkbox.
export const visChipHtml = (v: string): string =>
	`<button type="button" class="vis-chip" id="visChip" aria-haspopup="menu" aria-expanded="false" ` +
	`aria-label="${esc(visOf(v).label)}: who can see this write" data-tip="${esc(visOf(v).label)}: ${esc(visOf(v).blurb)} Click to change." ` +
	`data-vis="${esc(v)}">${visLabel(v)}<span class="chev">&#9662;</span></button>`

// Three options, each with its consequence spelled out. A radio list, not a
// switch: three states can't be a toggle.
export const visOptionsHtml = (current: string): string =>
	Object.entries(VIS)
		.map(
			([key, v]) =>
				`<button type="button" class="vis-opt${key === current ? " on" : ""}" role="menuitemradio" ` +
				`aria-checked="${key === current}" data-vis="${key}">` +
				`<span class="vis-opt-label">${v.icon} ${esc(v.label)}</span>` +
				`<span class="vis-opt-blurb">${esc(v.blurb)}</span></button>`,
		)
		.join("")
export const visMenuHtml = (current: string): string => `<div class="vis-menu" id="visMenu" role="menu">${visOptionsHtml(current)}</div>`

// ---- /writes listing ----
export function docCardHtml(d: DocSummary): string {
	const v = d.visibility || "private"
	return (
		`<article class="doc-card" data-id="${esc(d.id)}">` +
		`<span class="doc-date">${esc(fmtWhen(d.updatedAt))}</span>` +
		`<h3 class="doc-card-title">${esc(d.title)}</h3>` +
		`<p class="doc-card-meta">${esc(wordsLabel(d.wordCount))}` +
		(d.mine ? "" : ` · by ${esc(d.owner)}`) +
		`</p>` +
		`<p class="doc-card-tags">` +
		(d.mine
			? `<span class="doc-pill ${v === "private" ? "" : "on"}">${visLabel(v)}</span>`
			: `<span class="doc-pill on">${v === "public" ? "📖 Public read" : "📖 Beta reading"}</span>`) +
		(d.comments ? `<span class="doc-pill">💬 ${d.comments}</span>` : "") +
		(d.readers?.length ? `<span class="doc-pill">✍ ${esc(d.readers.join(", "))}</span>` : "") +
		`</p>` +
		`<div class="doc-card-actions">` +
		`<a class="ghost doc-open" href="/write?id=${encodeURIComponent(d.id)}">Open</a>` +
		(d.mine ? `<button class="ghost danger doc-del" type="button">Delete</button>` : "") +
		`</div>` +
		`</article>`
	)
}

export const docListHtml = (docs: DocSummary[] | null | undefined): string =>
	!docs || !docs.length
		? `<p class="empty">Nothing written yet. Start something: no timer, no turns, just the page.</p>`
		: docs.map(docCardHtml).join("")

// The shelf holds two different relationships to a document — the ones you
// WRITE and the ones you were invited to READ — and they want different things
// from you, so they get their own sections rather than one mixed pile sorted
// by date. Each section keeps its own grid; an empty one simply isn't drawn
// (a "no beta reads" box is noise on a shelf that is mostly your own work).
export const DOC_GROUPS: readonly { key: "mine" | "reading"; title: string; blurb: string }[] = [
	{ key: "mine", title: "✒️ My solo writes", blurb: "" },
	{ key: "reading", title: "📖 Beta reading", blurb: "Invited by someone else, you can comment, not edit." },
]

export function docShelfHtml(docs: DocSummary[] | null | undefined): string {
	const all = docs || []
	if (!all.length) return docListHtml(all) // one empty state, not two
	const groups = { mine: all.filter((d) => d.mine), reading: all.filter((d) => !d.mine) }
	return DOC_GROUPS.filter((g) => groups[g.key].length)
		.map(
			(g) =>
				`<section class="doc-group" data-group="${g.key}">` +
				`<h3 class="doc-group-head">${g.title}<span class="doc-group-count">${groups[g.key].length}</span></h3>` +
				(g.blurb ? `<p class="doc-group-blurb subtle">${esc(g.blurb)}</p>` : "") +
				`<div class="doc-grid">${groups[g.key].map(docCardHtml).join("")}</div>` +
				`</section>`,
		)
		.join("")
}

// ---- presence ----
// Beta readers currently viewing. Tooltips come from the shared data-tip system.
export const presenceHtml = (viewers: UserRef[] | null | undefined): string =>
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
export function commentHtml(c: CommentRow, { isOwner = false, meName = "", canReply = false }: CommentViewOpts = {}): string {
	// The buttons are the server's rules made visible: you edit only your own
	// words, you delete your own (the document's author may delete anyone's),
	// and only the comment's writer or the author may close a thread. Showing
	// more would just be a click that does nothing.
	const mine = !!meName && c.author === meName
	const canManage = isOwner || mine
	const replies = c.replies || []
	const cls = ["doc-comment", c.resolved && "resolved", c.orphaned && "orphaned", c.suggestion != null && "suggested"]
	const state = !c.resolved
		? ""
		: c.suggestion != null
			? c.accepted ? "✓ Accepted" : "Not taken"
			: c.declined ? "✕ declined" : "✓ resolved"
	const head =
		`<span class="dc-who">${miniAvatar({ avatar: c.avatar, avatarFit: c.avatarFit, name: c.author, color: c.color })}` +
		`<b style="color:${safeColor(c.color)}" data-tip="${roleTip(c.isAuthor)}">${esc(c.author)}</b>` +
		(c.orphaned ? orphanFlag() : "") +
		(state ? `<span class="dc-state">${state}</span>` : "") +
		`<span class="dc-when">${esc(fmtWhen(c.ts))}${c.edited ? " · edited" : ""}</span>` +
		`</span>`
	const open = !c.resolved
	const acts = actsHtml(c.reactions, meName, {
		reply: canReply && open, react: canReply && open, edit: mine && open, del: canManage, reopen: canManage && !open,
	})
	const body =
		(c.suggestion != null
			? `<p class="dc-suggest"><s>${esc(c.quote || "")}</s> <span class="dc-arrow">→</span> <ins>${esc(c.suggestion)}</ins></p>`
			: c.quote
				? `<p class="dc-quote">${esc(c.quote)}</p>`
				: "") + (c.text ? `<p class="dc-text">${esc(c.text)}</p>` : "")
	// Replies in reading order (each under what it answers); a long thread
	// folds everything past the first few behind "Show N more".
	const ordered = threadOrder(replies)
	const hidden = ordered.length > FOLD_AFTER ? ordered.length - FOLD_AFTER : 0
	const thread = ordered.length
		? `<ul class="dc-replies">${ordered
				.map(({ reply, depth }, i) => replyHtml(reply, { isOwner, meName, canReply, open, depth, extra: hidden > 0 && i >= FOLD_AFTER }))
				.join("")}</ul>` +
			(hidden ? `<button class="dc-show-more" type="button">▾ Show ${hidden} more ${hidden === 1 ? "reply" : "replies"}</button>` : "")
		: ""
	// A closed thread folds to one line; a click opens it to read, not to write.
	const tail = c.resolved
		? replies.length
			? `<p class="dc-count">${replies.length} ${replies.length === 1 ? "reply" : "replies"}</p>`
			: ""
		: (c.suggestion != null && isOwner
				? `<span class="dc-actions"><button class="dc-accept" type="button">✓ Accept</button><button class="dc-reject" type="button">✕ Reject</button></span>`
				: isOwner
					? `<span class="dc-actions"><button class="dc-resolve" type="button">✓ Resolve</button><button class="dc-decline" type="button">✕ Reject</button></span>`
					: mine
						? `<span class="dc-actions"><button class="dc-resolve" type="button">✓ Resolve</button></span>`
						: "")
	return (
		`<li class="${cls.filter(Boolean).join(" ")}" data-id="${esc(c.id)}" data-cid="${esc(c.cid || "")}">` +
		head + body + acts + thread + tail +
		`</li>`
	)
}

/** How many replies a thread shows before the rest fold away. */
export const FOLD_AFTER = 3
/** Indent stops here — the rail is narrow; deeper replies stay at this level. */
export const MAX_DEPTH = 4

/**
 * A thread in reading order: every reply followed by what answers it, oldest
 * first at each level. A reply whose parent is gone (or that names itself in
 * a loop) answers the note. Depth 1 = answers the note.
 */
export function threadOrder(replies: ReplyRow[]): { reply: ReplyRow; depth: number }[] {
	const ids = new Set(replies.map((r) => r.id))
	const kids = new Map<string, ReplyRow[]>()
	for (const r of replies) {
		const p = r.parentId && r.parentId !== r.id && ids.has(r.parentId) ? r.parentId : ""
		kids.set(p, [...(kids.get(p) || []), r])
	}
	const out: { reply: ReplyRow; depth: number }[] = []
	const seen = new Set<string>()
	const walk = (parent: string, depth: number) => {
		for (const r of kids.get(parent) || []) {
			if (seen.has(r.id)) continue
			seen.add(r.id)
			out.push({ reply: r, depth: Math.min(depth, MAX_DEPTH) })
			walk(r.id, depth + 1)
		}
	}
	walk("", 1)
	// a parent loop never reaches the root: those still show, under the note
	for (const r of replies) if (!seen.has(r.id)) out.push({ reply: r, depth: 1 })
	return out
}

/** The one reply box, opened under the message being answered. */
export const replyBoxHtml = (name: string): string =>
	`<span class="dc-reply"><input class="dc-reply-input" type="text" maxlength="1000" placeholder="Reply to ${esc(name)}…" aria-label="Reply to ${esc(name)}" />` +
	`<button class="dc-send" type="button" aria-label="Send reply"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button></span>`

/** Who is speaking rides the NAME as a tooltip — the author, or a beta reader — not a pill beside it. */
const roleTip = (isAuthor?: boolean): string => (isAuthor ? "The author" : "Beta reader")
/** A comment whose words are gone wears a small ! with the explanation in its tooltip. */
const orphanFlag = (): string =>
	`<span class="dc-flag" data-tip="This comment was left on text that has since changed" role="img" aria-label="Left on text that has since changed">!</span>`

/**
 * What you can do to one message, in a row under it — Reply · Edit · Delete
 * (Reopen on a closed note), the reaction smiley, then the reaction chips.
 * Only what the viewer may actually do is drawn; chips always show.
 */
interface Acts { reply?: boolean; react?: boolean; edit?: boolean; del?: boolean; reopen?: boolean }
function actsHtml(reactions: Reactions | undefined, meName: string, { reply = false, react = false, edit = false, del = false, reopen = false }: Acts): string {
	// The reaction chips sit in the row; everything you can DO — Reply · Edit ·
	// Add reaction · Delete — waits behind a ⋯ so the row stays one short
	// line even on a busy note. Reopen alone leads the row on a closed note.
	const lead = reopen ? `<button class="dc-act dc-reopen" type="button">Reopen</button>` : ""
	const items =
		(reply ? `<button class="dc-act dc-reply-btn" type="button" role="menuitem"><i class="fa-solid fa-reply" aria-hidden="true"></i>Reply</button>` : "") +
		(edit ? `<button class="dc-act dc-edit" type="button" role="menuitem"><i class="fa-solid fa-pen" aria-hidden="true"></i>Edit</button>` : "") +
		(react ? `<button class="dc-act react-add" type="button" role="menuitem"><i class="fa-regular fa-face-smile" aria-hidden="true"></i>Add reaction</button>` : "") +
		(del ? `<button class="dc-act dc-del" type="button" role="menuitem"><i class="fa-regular fa-trash-can" aria-hidden="true"></i>Delete</button>` : "")
	const more = items
		? `<span class="dc-more"><button class="dc-more-btn" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false">⋯</button><span class="dc-menu" role="menu">${items}</span></span>`
		: ""
	const chips = reactionsHtml(reactions, meName || null)
	if (!lead && !more && !chips) return ""
	return `<span class="dc-acts">${lead}<span class="reacts">${chips}</span>${more}</span>`
}

export function replyHtml(
	r: ReplyRow,
	{ isOwner = false, meName = "", canReply = false, open = true, depth = 1, extra = false }: CommentViewOpts & { open?: boolean; depth?: number; extra?: boolean } = {},
): string {
	const mine = !!meName && r.author === meName
	return (
		`<li class="dc-reply-item${extra ? " extra" : ""}" data-rid="${esc(r.id)}" data-author="${esc(r.author)}" style="--d:${Math.max(1, Math.min(MAX_DEPTH, depth | 0))}">` +
		`<span class="dc-who">${miniAvatar({ avatar: r.avatar, avatarFit: r.avatarFit, name: r.author, color: r.color })}` +
		`<b style="color:${safeColor(r.color)}" data-tip="${roleTip(r.isAuthor)}">${esc(r.author)}</b>` +
		`<span class="dc-when">${esc(fmtWhen(r.ts))}${r.edited ? " · edited" : ""}</span>` +
		`</span>` +
		`<p class="dc-text">${esc(r.text)}</p>` +
		actsHtml(r.reactions, meName, { reply: canReply && open, react: canReply && open, edit: mine && open, del: isOwner || mine }) +
		`</li>`
	)
}

// Comments grouped under the block they're anchored to, plus any that lost
// their anchor when the author edited that text.
/**
 * The strip pinned to the top of the editor while comment mode is on: it
 * names the mode, says the gesture, and — for the author, who can leave —
 * carries the way out. A beta reader is always in comment mode (they can't
 * edit), so their strip says so and has no Done.
 */
export function commentModeBannerHtml({ canExit = true, count = 0 }: { canExit?: boolean; count?: number } = {}): string {
	const notes = count > 0 ? ` · ${count} note${count === 1 ? "" : "s"}` : ""
	return (
		`<span class="cmb-what">💬 <b>${canExit ? "Comment mode" : "Reading to comment"}</b></span>` +
		`<span class="cmb-how">${canExit ? "Select any words to leave a note" : "Select any words to leave the author a note"}${notes}</span>` +
		(canExit ? `<button class="cmb-done" id="commentDone" type="button">Done</button>` : "")
	)
}

export function commentThreadHtml(comments: CommentRow[], { orphaned = false, isOwner = false, meName = "", canReply = false }: CommentViewOpts & { orphaned?: boolean } = {}): string {
	if (!comments.length) return ""
	// an orphaned card says so itself (the ! in its head); the group needs no heading
	void orphaned
	return `<ul class="dc-list">${comments.map((c) => commentHtml(c, { isOwner, meName, canReply })).join("")}</ul>`
}

// ---- version history ----
/** One kept copy as GET /api/docs/:id/history lists it. */
export interface VersionRow {
	at: number
	reason: "time" | "drop" | "restore" | string
	words: number
	chapters: number
}
const VERSION_WHY: Record<string, string> = {
	drop: "Kept because the next save was much shorter",
	restore: "What a restore replaced",
}
/** The list in the Version history dialog, newest first; `nowWords` lets each row say how it differs from the page. */
export function versionListHtml(versions: VersionRow[] | null | undefined, nowWords = 0, nowChapters = 0): string {
	if (!versions || !versions.length)
		return `<p class="subtle">No earlier copies yet. They start appearing once you have been writing here for a little while.</p>`
	// The figure every row is measured against, so "more than now" is checkable.
	const now = `<p class="history-now">Now: <b>${Number(nowWords).toLocaleString()} word${nowWords === 1 ? "" : "s"}</b>${nowChapters > 1 ? ` · ${nowChapters} chapters` : ""}</p>`
	return (
		now +
		`<ul class="history-rows">` +
		versions
			.map((v) => {
				const diff = v.words - nowWords
				const delta = diff === 0 ? "same length as now" : `${Math.abs(diff).toLocaleString()} ${diff > 0 ? "more" : "fewer"} than now`
				const when = new Date(v.at)
				return (
					`<li class="history-row${v.reason === "drop" ? " drop" : ""}" data-at="${Number(v.at)}">` +
					`<span class="history-when"><b>${esc(when.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</b> ${esc(when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</span>` +
					`<span class="history-what">${Number(v.words).toLocaleString()} word${v.words === 1 ? "" : "s"} · ${esc(delta)}${v.chapters > 1 ? ` · ${v.chapters} chapters` : ""}` +
					(VERSION_WHY[v.reason] ? `<em class="history-why">${esc(VERSION_WHY[v.reason])}</em>` : "") +
					`</span>` +
					`<span class="history-acts"><button class="ghost history-get" type="button">Download</button><button class="primary history-restore" type="button">Restore</button></span>` +
					`</li>`
				)
			})
			.join("") +
		`</ul>`
	)
}

// ---- inviting a beta reader ----
// The picker lists EVERY writer, because you shouldn't have to remember how a
// username is spelled to find it. Friends come first and wear a chip, since
// they're the only ones who can actually be invited (the server enforces that
// — sharing a draft is a trust decision). Everyone else is listed but not
// offerable, which answers "why isn't so-and-so here?" without an error.
export interface InviteOptionsInput {
	users?: (UserRef & { requested?: boolean })[]
	friends?: Pick<UserRef, "username">[]
	readers?: Pick<UserRef, "username">[]
	me?: string
	q?: string
}
export function inviteOptions({ users = [], friends = [], readers = [], me = "", q = "" }: InviteOptionsInput = {}): InviteRow[] {
	const isFriend = new Set(friends.map((f) => f.username))
	const taken = new Set([...readers.map((r) => r.username), me].filter(Boolean))
	const s = String(q || "").trim().toLowerCase()
	return users
		.filter((u) => !taken.has(u.username) && (!s || u.username.toLowerCase().includes(s)))
		.map((u) => ({ ...u, friend: isFriend.has(u.username) }))
		.sort((a, b) => Number(b.friend) - Number(a.friend) || a.username.localeCompare(b.username))
}

// A friend's row is a button that invites them. Anyone else's is a plain row
// (not a disabled button — a button can't hold another) carrying the way to
// become friends: an Add friend button, or "requested" once it has been sent
// (`requested` rides on /api/users rows).
export const inviteRowHtml = (u: InviteRow): string => {
	const who =
		miniAvatar({ avatar: u.avatar, avatarFit: u.avatarFit, name: u.username, color: u.color }) +
		`<span class="pick-name" style="color:${safeColor(u.color)}">${esc(u.username)}</span>`
	if (u.friend) return `<button type="button" class="pick-row" data-user="${esc(u.username)}">${who}<span class="pick-chip">friend</span></button>`
	const state = u.requested
		? `<span class="pick-chip requested">requested</span>`
		: `<button type="button" class="ghost add-friend" data-add-friend="${esc(u.username)}">Add friend</button>`
	return `<div class="pick-row not-friend" data-user="${esc(u.username)}">${who}<span class="pick-note">not a friend yet</span>${state}</div>`
}

export const inviteListHtml = (rows: InviteRow[] | null | undefined): string =>
	!rows || !rows.length
		? `<p class="subtle pick-empty">Nobody here by that name.</p>`
		: rows.map(inviteRowHtml).join("")

// ---- beta-reader chips ----
export const readerChipsHtml = (readers: UserRef[] | null | undefined, canManage: boolean): string =>
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

// ---- solo writes as a compact list (profile + dashboard) ----
// One row per document. What the row OFFERS depends on who's looking:
//   mine      → Continue (the editor) + Delete (two-click: the first arms it)
//   deletable → an admin: Delete beside Read/🔒 (moderation, never a pen)
//   viewable  → Read (public, or I'm a beta reader)
//   otherwise → 🔒 listed but not openable — a private write exists, it just
//               isn't yours to read. That's deliberate: the list is the
//               writer's shelf, and the lock says why a card won't open.
export function soloRowHtml(d: DocSummary): string {
	const v = d.visibility || "private"
	const title = esc(d.title || "Untitled")
	const meta = `${esc(wordsLabel(d.wordCount))}` + (d.sprintWords ? ` · ⏱ ${esc(String(d.sprintWords))} sprinted` : "")
	const pill = `<span class="doc-pill ${v === "private" ? "" : "on"}">${visLabel(v)}</span>`
	const open = `/write?id=${encodeURIComponent(d.id)}`
	let acts: string
	if (d.mine)
		acts =
			`<a class="ghost solo-open" href="${open}">Continue</a>` +
			`<button type="button" class="ghost danger solo-del" data-id="${esc(d.id)}" data-title="${title}">Delete</button>`
	else if (d.viewable) acts = `<a class="ghost solo-open" href="${open}">Read</a>`
	else acts = `<span class="solo-lock" title="Private, only its author can open it">🔒 Private</span>`
	if (!d.mine && d.deletable) acts += `<button type="button" class="ghost danger solo-del" data-id="${esc(d.id)}" data-title="${title}">Delete</button>`
	const head = d.mine || d.viewable ? `<a class="solo-title" href="${open}">${title}</a>` : `<span class="solo-title locked">${title}</span>`
	return (
		`<div class="solo-row${d.mine || d.viewable ? "" : " locked"}" data-id="${esc(d.id)}">` +
		`<span class="solo-date">${esc(fmtWhen(d.updatedAt))}</span>` +
		`<span class="solo-info">${head}<span class="solo-meta">${meta} ${pill}</span></span>` +
		`<span class="solo-acts">${acts}</span>` +
		`</div>`
	)
}
// Docs I was invited to beta read belong to OTHER writers, so they never sit
// under "my solo writes": they get their own section, grouped by whose fic it
// is — "📖 Beta reading for <owner>" — with each of that writer's writes as a
// row underneath. Nothing here is mine to edit or delete (soloRowHtml shows a
// Read/🔒 row for a non-mine doc). Empty → "".
export function betaReadingHtml(docs: DocSummary[] | null | undefined, { limit = 20 }: { limit?: number } = {}): string {
	const reading = (docs || []).filter((d) => !d.mine)
	if (!reading.length) return ""
	const byOwner = new Map<string, DocSummary[]>()
	for (const d of reading.slice(0, limit)) {
		const owner = d.owner || "someone"
		if (!byOwner.has(owner)) byOwner.set(owner, [])
		byOwner.get(owner)!.push(d)
	}
	return [...byOwner.entries()]
		.map(
			([owner, list]) =>
				`<section class="beta-group" data-owner="${esc(owner)}">` +
				`<h4 class="dash-h dash-sub-h" style="margin:14px 0 6px">📖 Beta reading for ${esc(owner)}` +
				`<span class="doc-group-count">${list.length}</span></h4>` +
				list.map(soloRowHtml).join("") +
				`</section>`,
		)
		.join("")
}

export const soloListHtml = (docs: DocSummary[] | null | undefined, { empty = "No solo writes yet.", limit = 5 }: { empty?: string; limit?: number } = {}): string =>
	!docs || !docs.length
		? `<p class="subtle" style="text-align:left;margin:0">${esc(empty)}</p>`
		: docs.slice(0, limit).map(soloRowHtml).join("")

// Wire the two-click delete on a list container: the first click arms the
// button ("Delete? ✓"), the second deletes; anything else disarms it.
export function wireSoloDeletes(box: HTMLElement, onDelete: (id: string | undefined, title: string | undefined) => Promise<unknown> | unknown): void {
	box.addEventListener("click", async (e) => {
		const b = (e.target as Element | null)?.closest<HTMLButtonElement>(".solo-del")
		if (!b) return
		if (b.dataset.armed !== "1") {
			box.querySelectorAll<HTMLElement>(".solo-del[data-armed]").forEach((x) => {
				delete x.dataset.armed
				x.textContent = "Delete"
			})
			b.dataset.armed = "1"
			b.textContent = "Delete? ✓"
			return
		}
		b.disabled = true
		try {
			await onDelete(b.dataset.id, b.dataset.title)
			b.closest(".solo-row")?.remove()
		} catch (err) {
			b.disabled = false
			b.textContent = (err instanceof Error && err.message) || "Couldn't delete"
		}
	})
	box.addEventListener(
		"focusout",
		() =>
			setTimeout(() => {
				if (!box.contains(document.activeElement))
					box.querySelectorAll<HTMLElement>(".solo-del[data-armed]").forEach((x) => {
						delete x.dataset.armed
						x.textContent = "Delete"
					})
			}, 0),
		true,
	)
}

// ---- chapters ----
// The chapter list beside the editor. An author's rows carry ↑ ↓ ✎ ✕
// (buttons, not drag: touch-safe and testable); a reader's are a table of
// contents. `openId` marks the chapter on screen; `commentCounts` maps a
// chapter id to how many comments sit in it. A chapter not yet saved has no
// id — its row is keyed by index instead (`data-i`), and every row carries it.
export const countWordsHtml = (html: unknown): number => {
	const text = String(html || "").replace(/<\/?(?:b|i|u|s|strong|em|del|span|a)(?:\s[^>]*)?>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, "x").trim()
	return text ? text.split(/\s+/).filter(Boolean).length : 0
}
export function chapterListHtml(chapters: Chapter[] | null | undefined, { openIdx = 0, canEdit = false, commentCounts = {} }: { openIdx?: number; canEdit?: boolean; commentCounts?: Record<string, number> } = {}): string {
	const list = chapters || []
	const total = list.reduce((n, c) => n + (c.wordCount ?? countWordsHtml(c.html)), 0)
	const rows = list
		.map((c, i) => {
			const words = c.wordCount ?? countWordsHtml(c.html)
			const notes = c.id && commentCounts[c.id] ? `<span class="chap-notes" title="${commentCounts[c.id]} comment${commentCounts[c.id] === 1 ? "" : "s"}">💬 ${commentCounts[c.id]}</span>` : ""
			const acts = canEdit
				? `<span class="chap-acts">` +
					`<button type="button" class="chap-up" data-i="${i}" title="Move up" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button>` +
					`<button type="button" class="chap-down" data-i="${i}" title="Move down" aria-label="Move down"${i === list.length - 1 ? " disabled" : ""}>↓</button>` +
					`<button type="button" class="chap-rename" data-i="${i}" title="Rename" aria-label="Rename">✎</button>` +
					`<button type="button" class="chap-del" data-i="${i}" title="${list.length === 1 ? "A story keeps at least one chapter" : "Delete chapter"}" aria-label="Delete chapter"${list.length === 1 ? " disabled" : ""}>✕</button>` +
					`</span>`
				: ""
			return (
				`<div class="chap-row${i === openIdx ? " open" : ""}" data-i="${i}"${c.id ? ` data-id="${esc(c.id)}"` : ""}>` +
				`<button type="button" class="chap-open" data-i="${i}"><span class="chap-n">${i + 1}</span><span class="chap-title">${esc(c.title || `Chapter ${i + 1}`)}</span>` +
				`<span class="chap-meta">${esc(wordsLabel(words))}${notes}</span></button>` +
				acts +
				`</div>`
			)
		})
		.join("")
	const foot =
		`<div class="chap-foot"><span class="chap-total">${list.length} chapter${list.length === 1 ? "" : "s"} · ${esc(wordsLabel(total))}</span>` +
		(canEdit ? `<button type="button" class="ghost chap-add">+ Add chapter</button>` : "") +
		`</div>`
	const head =
		`<div class="doc-side-head chap-head"><h3>📑 Chapters</h3>` +
		`<button type="button" class="ghost doc-side-close chap-close" aria-label="Close the chapter panel" data-tip="Close">✕</button></div>`
	return `${head}<div class="chap-list">${rows}</div>${foot}`
}

// Prev / Next at the foot of the page, for readers and author alike.
export function chapNavHtml(chapters: Chapter[] | null | undefined, idx: number): string {
	const list = chapters || []
	const n = list.length
	if (n < 2) return ""
	// tiny arrows either side of the position; each names its chapter on hover,
	// and the ends keep a disabled arrow so the words stay centred
	const arrow = (cls: string, to: number, glyph: string) => {
		const t = list[to]
		const name = t ? t.title || `Chapter ${to + 1}` : ""
		return t
			? `<button type="button" class="chap-arrow ${cls}" data-i="${to}" aria-label="${esc(name)}" data-tip="${esc(name)}">${glyph}</button>`
			: `<button type="button" class="chap-arrow ${cls}" disabled aria-hidden="true">${glyph}</button>`
	}
	return `<nav class="chap-nav" aria-label="Chapters">${arrow("chap-prev", idx - 1, "‹")}<span class="chap-pos">Chapter ${idx + 1} of ${n}</span>${arrow("chap-next", idx + 1, "›")}</nav>`
}

// The head-row chip that opens the chapter panel. Closed, it says what
// pressing it does; open, it names where you are.
// One word, always: the chip is a door, and where you are is the panel's job.
// (The signature stays for the callers and the tests.)
// The chip names the chapter you are IN — plain text (the page sets it with
// textContent), cut by CSS when the title is long. A blank title falls back
// to its number, the way the panel numbers it.
export const chapChipLabel = (chapters: { title?: string }[] | null | undefined, idx: number, _open = true): string => {
	const title = String(chapters?.[idx]?.title ?? "").trim()
	return chapters?.length ? `📑 ${title || `Chapter ${idx + 1}`}` : "📑"
}

// ---- sprints ----
// A sprint row: when, how many words, how long, and the project it was written
// in (linked — the reader may not be allowed in, but the write page says so).
const fmtDur = (sec: number | undefined): string => {
	const s = Math.max(0, Math.floor(sec || 0))
	const m = Math.floor(s / 60)
	return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`
}
export function sprintRowHtml(sp: Sprint, { mine = false }: { mine?: boolean } = {}): string {
	const title = esc(sp.title || "Untitled")
	const open = `/write?id=${encodeURIComponent(sp.docId || "")}`
	const del = mine
		? `<span class="solo-acts"><button type="button" class="ghost danger sprint-del" data-at="${esc(String(sp.at || ""))}">Delete</button></span>`
		: ""
	return (
		`<div class="solo-row sprint-row" data-doc="${esc(sp.docId || "")}" data-at="${esc(String(sp.at || ""))}">` +
		`<span class="solo-date">${esc(fmtWhen(sp.at))}</span>` +
		`<span class="solo-info"><a class="solo-title" href="${open}">${title}</a>` +
		`<span class="solo-meta">⏱ ${esc(String(sp.words || 0))} word${sp.words === 1 ? "" : "s"} in ${esc(fmtDur(sp.seconds))}</span></span>` +
		del +
		`</div>`
	)
}
export const sprintListHtml = (sprints: Sprint[] | null | undefined, { total = 0, count = 0, mine = false, empty = "No sprints yet: start one from the ⏱ button in a solo write." }: { total?: number; count?: number; mine?: boolean; empty?: string } = {}): string =>
	!sprints || !sprints.length
		? `<p class="subtle" style="text-align:left;margin:0">${esc(empty)}</p>`
		: `<p class="subtle" style="text-align:left;margin:0 0 8px">${esc(String(total))} word${total === 1 ? "" : "s"} across ${count} sprint${count === 1 ? "" : "s"}</p>` +
			sprints.map((sp) => sprintRowHtml(sp, { mine })).join("")

// Two-click delete for sprint rows (owner's own profile only), mirroring
// wireSoloDeletes: first click arms, second calls onDelete(at) and drops the row.
export function wireSprintDeletes(box: HTMLElement, onDelete: (at: string | undefined) => Promise<unknown> | unknown): void {
	box.addEventListener("click", async (e) => {
		const b = (e.target as Element | null)?.closest<HTMLButtonElement>(".sprint-del")
		if (!b) return
		if (b.dataset.armed !== "1") {
			box.querySelectorAll<HTMLElement>(".sprint-del[data-armed]").forEach((x) => {
				delete x.dataset.armed
				x.textContent = "Delete"
			})
			b.dataset.armed = "1"
			b.textContent = "Delete? ✓"
			return
		}
		b.disabled = true
		try {
			await onDelete(b.dataset.at)
			b.closest(".sprint-row")?.remove()
		} catch (err) {
			b.disabled = false
			b.textContent = (err instanceof Error && err.message) || "Couldn't delete"
		}
	})
	box.addEventListener("focusout", () =>
		setTimeout(() => {
			if (!box.contains(document.activeElement))
				box.querySelectorAll<HTMLElement>(".sprint-del[data-armed]").forEach((x) => {
					delete x.dataset.armed
					x.textContent = "Delete"
				})
		}, 0),
	)
}

// The prompt as it goes INTO a document: one centred paragraph, every
// "Category: choice" line with its category in bold, lines stacked with
// <br>; a curated one-liner is just the centred text. Only sanitizeDoc's
// subset (p.al-c, b, br) so it round-trips the editor and the server.
const PROMPT_CAT_RE = /^(?:\u2022 )?([A-Z][a-z]+): (.*)$/
export function promptInsertHtml(prompt: unknown): string {
	const lines = String(prompt || "")
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
	if (!lines.length) return ""
	const body = lines
		.map((l) => {
			const m = l.match(PROMPT_CAT_RE)
			return m ? `<b>${esc(m[1])}:</b> ${esc(m[2])}` : esc(l)
		})
		.join("<br>")
	return `<p class="al-c">${body}</p>`
}
// Where it goes: right after the first heading, else at the very top.
export function insertAfterHeading(root: Element, html: string): Element | null {
	const tpl = root.ownerDocument.createElement("template")
	tpl.innerHTML = html
	const node = tpl.content.firstElementChild
	if (!node) return null
	const heading = root.querySelector("h1, h2, h3")
	if (heading) heading.after(node)
	else root.prepend(node)
	return node
}
