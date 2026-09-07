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

export const docListHtml = (docs) =>
	!docs || !docs.length
		? `<p class="empty">Nothing written yet. Start something: no timer, no turns, just the page.</p>`
		: docs.map(docCardHtml).join("")

// The shelf holds two different relationships to a document — the ones you
// WRITE and the ones you were invited to READ — and they want different things
// from you, so they get their own sections rather than one mixed pile sorted
// by date. Each section keeps its own grid; an empty one simply isn't drawn
// (a "no beta reads" box is noise on a shelf that is mostly your own work).
export const DOC_GROUPS = [
	{ key: "mine", title: "✒️ My solo writes", blurb: "" },
	{ key: "reading", title: "📖 Beta reading", blurb: "Invited by someone else, you can comment, not edit." },
]

export function docShelfHtml(docs) {
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

// ---- inviting a beta reader ----
// The picker lists EVERY writer, because you shouldn't have to remember how a
// username is spelled to find it. Friends come first and wear a chip, since
// they're the only ones who can actually be invited (the server enforces that
// — sharing a draft is a trust decision). Everyone else is listed but not
// offerable, which answers "why isn't so-and-so here?" without an error.
export function inviteOptions({ users = [], friends = [], readers = [], me = "", q = "" } = {}) {
	const isFriend = new Set(friends.map((f) => f.username))
	const taken = new Set([...readers.map((r) => r.username), me].filter(Boolean))
	const s = String(q || "").trim().toLowerCase()
	return users
		.filter((u) => !taken.has(u.username) && (!s || u.username.toLowerCase().includes(s)))
		.map((u) => ({ ...u, friend: isFriend.has(u.username) }))
		.sort((a, b) => b.friend - a.friend || a.username.localeCompare(b.username))
}

// A friend's row is a button that invites them. Anyone else's is a plain row
// (not a disabled button — a button can't hold another) carrying the way to
// become friends: an Add friend button, or "requested" once it has been sent
// (`requested` rides on /api/users rows).
export const inviteRowHtml = (u) => {
	const who =
		miniAvatar({ avatar: u.avatar, avatarFit: u.avatarFit, name: u.username, color: u.color }) +
		`<span class="pick-name" style="color:${safeColor(u.color)}">${esc(u.username)}</span>`
	if (u.friend) return `<button type="button" class="pick-row" data-user="${esc(u.username)}">${who}<span class="pick-chip">friend</span></button>`
	const state = u.requested
		? `<span class="pick-chip requested">requested</span>`
		: `<button type="button" class="ghost add-friend" data-add-friend="${esc(u.username)}">Add friend</button>`
	return `<div class="pick-row not-friend" data-user="${esc(u.username)}">${who}<span class="pick-note">not a friend yet</span>${state}</div>`
}

export const inviteListHtml = (rows) =>
	!rows || !rows.length
		? `<p class="subtle pick-empty">Nobody here by that name.</p>`
		: rows.map(inviteRowHtml).join("")

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

// ---- solo writes as a compact list (profile + dashboard) ----
// One row per document. What the row OFFERS depends on who's looking:
//   mine      → Continue (the editor) + Delete (two-click: the first arms it)
//   viewable  → Read (public, or I'm a beta reader)
//   otherwise → 🔒 listed but not openable — a private write exists, it just
//               isn't yours to read. That's deliberate: the list is the
//               writer's shelf, and the lock says why a card won't open.
export function soloRowHtml(d) {
	const v = d.visibility || "private"
	const title = esc(d.title || "Untitled")
	const meta = `${esc(wordsLabel(d.wordCount))}` + (d.sprintWords ? ` · ⏱ ${esc(String(d.sprintWords))} sprinted` : "")
	const pill = `<span class="doc-pill ${v === "private" ? "" : "on"}">${visLabel(v)}</span>`
	const open = `/write?id=${encodeURIComponent(d.id)}`
	let acts
	if (d.mine)
		acts =
			`<a class="ghost solo-open" href="${open}">Continue</a>` +
			`<button type="button" class="ghost danger solo-del" data-id="${esc(d.id)}" data-title="${title}">Delete</button>`
	else if (d.viewable) acts = `<a class="ghost solo-open" href="${open}">Read</a>`
	else acts = `<span class="solo-lock" title="Private, only its author can open it">🔒 Private</span>`
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
export function betaReadingHtml(docs, { limit = 20 } = {}) {
	const reading = (docs || []).filter((d) => !d.mine)
	if (!reading.length) return ""
	const byOwner = new Map()
	for (const d of reading.slice(0, limit)) {
		const owner = d.owner || "someone"
		if (!byOwner.has(owner)) byOwner.set(owner, [])
		byOwner.get(owner).push(d)
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

export const soloListHtml = (docs, { empty = "No solo writes yet.", limit = 5 } = {}) =>
	!docs || !docs.length
		? `<p class="subtle" style="text-align:left;margin:0">${esc(empty)}</p>`
		: docs.slice(0, limit).map(soloRowHtml).join("")

// Wire the two-click delete on a list container: the first click arms the
// button ("Delete? ✓"), the second deletes; anything else disarms it.
export function wireSoloDeletes(box, onDelete) {
	box.addEventListener("click", async (e) => {
		const b = e.target.closest(".solo-del")
		if (!b) return
		if (b.dataset.armed !== "1") {
			box.querySelectorAll(".solo-del[data-armed]").forEach((x) => {
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
			b.textContent = err?.message || "Couldn't delete"
		}
	})
	box.addEventListener(
		"focusout",
		() =>
			setTimeout(() => {
				if (!box.contains(document.activeElement))
					box.querySelectorAll(".solo-del[data-armed]").forEach((x) => {
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
export const countWordsHtml = (html) => {
	const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, "x").trim()
	return text ? text.split(/\s+/).filter(Boolean).length : 0
}
export function chapterListHtml(chapters, { openIdx = 0, canEdit = false, commentCounts = {} } = {}) {
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
export function chapNavHtml(chapters, idx) {
	const n = (chapters || []).length
	if (n < 2) return ""
	const prev = idx > 0 ? `<button type="button" class="ghost chap-prev" data-i="${idx - 1}">← ${esc(chapters[idx - 1].title || `Chapter ${idx}`)}</button>` : `<span></span>`
	const next = idx < n - 1 ? `<button type="button" class="ghost chap-next" data-i="${idx + 1}">${esc(chapters[idx + 1].title || `Chapter ${idx + 2}`)} →</button>` : `<span></span>`
	return `<nav class="chap-nav" aria-label="Chapters">${prev}<span class="chap-pos">Chapter ${idx + 1} of ${n}</span>${next}</nav>`
}

// The head-row chip that opens the chapter panel. Closed, it says what
// pressing it does; open, it names where you are.
export const chapChipLabel = (chapters, idx, open = true) => {
	if (!open) return "📑 View chapters"
	const n = (chapters || []).length
	return n > 1 ? `📑 Chapter ${idx + 1} of ${n}` : "📑 Chapters"
}

// ---- sprints ----
// A sprint row: when, how many words, how long, and the project it was written
// in (linked — the reader may not be allowed in, but the write page says so).
const fmtDur = (sec) => {
	const s = Math.max(0, Math.floor(sec || 0))
	const m = Math.floor(s / 60)
	return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`
}
export function sprintRowHtml(sp, { mine = false } = {}) {
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
export const sprintListHtml = (sprints, { total = 0, count = 0, mine = false, empty = "No sprints yet: start one from the ⏱ button in a solo write." } = {}) =>
	!sprints || !sprints.length
		? `<p class="subtle" style="text-align:left;margin:0">${esc(empty)}</p>`
		: `<p class="subtle" style="text-align:left;margin:0 0 8px">${esc(String(total))} word${total === 1 ? "" : "s"} across ${count} sprint${count === 1 ? "" : "s"}</p>` +
			sprints.map((sp) => sprintRowHtml(sp, { mine })).join("")

// Two-click delete for sprint rows (owner's own profile only), mirroring
// wireSoloDeletes: first click arms, second calls onDelete(at) and drops the row.
export function wireSprintDeletes(box, onDelete) {
	box.addEventListener("click", async (e) => {
		const b = e.target.closest(".sprint-del")
		if (!b) return
		if (b.dataset.armed !== "1") {
			box.querySelectorAll(".sprint-del[data-armed]").forEach((x) => {
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
			b.textContent = err?.message || "Couldn't delete"
		}
	})
	box.addEventListener("focusout", () =>
		setTimeout(() => {
			if (!box.contains(document.activeElement))
				box.querySelectorAll(".sprint-del[data-armed]").forEach((x) => {
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
export function promptInsertHtml(prompt) {
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
export function insertAfterHeading(root, html) {
	const tpl = root.ownerDocument.createElement("template")
	tpl.innerHTML = html
	const node = tpl.content.firstElementChild
	if (!node) return null
	const heading = root.querySelector("h1, h2, h3")
	if (heading) heading.after(node)
	else root.prepend(node)
	return node
}
