import { api, getToken, ApiError } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { cleanHtml, asterisksToTags, FONT_SIZES, newCid } from "/js/components/editor.js"
import {
	absorbFontTags,
	sizesInRange,
	nearestSize,
	parseSize,
	clearSizesInBlocks,
	headingOnly,
	DEFAULT_SIZE,
} from "/js/components/font-size.js"
import {
	loadPrefs,
	savePrefs,
	stepLine,
	DEFAULT_LINE,
	PAPERS,
	fontOf,
	fontListHtml,
	clampSide,
	DEFAULT_SIDE,
} from "/js/doc-prefs.js"
import { mountSlashPalette } from "/js/components/slash-palette.js"
import { mountPromptModes } from "/js/components/prompt-modes.js"
import { promptHtml } from "/js/util.js"
import { loadDraft, saveDraft, clearDraft, draftIsNewer } from "/js/doc-store.js"
import { createHistory } from "/js/components/history.js"
import { mountDocBanners } from "/js/components/doc-banner.js"
import { mountFindReplace, type FindReplaceApi } from "/js/components/find-replace.js"
import { htmlPushKind, pruneSource, stripAnchorInSource, applySuggestionInSource } from "/js/components/comment-sync.js"
import {
	presenceHtml,
	commentThreadHtml,
	commentModeBannerHtml,
	readerChipsHtml,
	wordsLabel,
	formatSource,
	unformatSource,
	plainBlockHtml,
	visChipHtml,
	promptInsertHtml,
	insertAfterHeading,
	visOptionsHtml,
	visOf,
	scrollTargetFor,
	inviteOptions,
	inviteListHtml,
	chapterListHtml,
	chapNavHtml,
	chapChipLabel,
	countWordsHtml,
} from "/js/write-view.js"
import { exportDocument, exportWork, exportChapterHtml, slugOf } from "/js/export.js"
import { esc } from "/js/util.js"
import type { Socket } from "socket.io-client"
import type { ServerToClient, ClientToServer } from "/js/shared/wire.js"
import type { ChipUser } from "/js/chrome.js"
import type { CommentRow, Chapter, InviteOptionsInput } from "/js/write-view.js"
import type { PromptMenus } from "/js/shared/wire.js"
import type { Sprint } from "/js/write-view.js"
import type { SlashPalette, RefBundle } from "/js/components/slash-palette.js"

/** A solo write as GET /api/docs/:id ships it (docPayload in src/docs.js). */
interface DocPayload {
	id: string
	title: string
	html?: string
	chapters?: Chapter[]
	comments?: CommentRow[]
	mine?: boolean
	visibility: string
	readerRows?: { username: string; color?: string; avatar?: string; avatarFit?: string }[]
	sprintWords?: number
	sprints?: Sprint[]
	updatedAt?: number
}
type DirectoryRow = NonNullable<InviteOptionsInput["users"]>[number]
/** execCommand's value slot for commands that take none — kept `null`, as the browser API has always been called here. */
const NOVAL = null as unknown as string

mountChrome({ page: "write" })
// The account controls are position:fixed on every other page, which
// would float them over this page's sticky header. Move them into it so
// the chip, the theme switch and the hamburger sit beside Save.
document.body.classList.add("doc-page")
// NB: plain getElementById — the $ helper is declared further down, and
// touching it here would throw before the page ever loads the document.
// Order: account chip, theme, then Save with the hamburger beside it.
const headRight = document.getElementById("docHeadRight")
const topbar = document.querySelector(".topbar")
const burger = document.querySelector(".hamburger")
if (headRight && topbar) headRight.prepend(topbar)
if (headRight && burger) headRight.appendChild(burger)
const me = await requireAuth<ChipUser>("/")
setUserChip(me)
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id)
const textarea = (id: string): HTMLTextAreaElement => $<HTMLTextAreaElement>(id)

const docId = new URLSearchParams(location.search).get("id") || ""
if (!docId) location.href = "/writes"

let doc: DocPayload | null = null
// The chapters, as the editor holds them: the OPEN one lives in the
// DOM (#docEditor / #docSource) and is written back into this array
// by stashCurrent() before anything reads the list. A chapter added
// since the last save has id null until the server names it.
let chapters: Chapter[] = []
let openIdx = 0
let dirty = false
let sourceMode = false
// mounted further down; a chapter or mode switch before that finds nothing to refresh
let finder: FindReplaceApi | null = null
let comments: CommentRow[] = []
let commentMode = false
let activeCid: string | null = null // the comment whose words are highlighted
let pendingRange: Range | null = null // the selection the composer is about to anchor
let composerTimer: ReturnType<typeof setTimeout> | undefined
let socket: Socket<ServerToClient, ClientToServer> | null = null

// A short-lived line in the head, for things the user just did (a
// visibility change) that deserve confirming without a modal.
let statusTimer: ReturnType<typeof setTimeout> | undefined
function setStatus(text: string) {
	$("saveState").textContent = text
	clearTimeout(statusTimer)
	statusTimer = setTimeout(() => setDirty(dirty), 2600)
}

// ---- dirty tracking ----
let lastEditAt = 0 // for the autosave: never save mid-sentence
const setDirty = (v: boolean) => {
	dirty = v
	if (v) lastEditAt = Date.now()
	$("saveState").textContent = v ? "Unsaved" : "Saved"
	$("saveState").classList.toggle("unsaved", v)
}

// The HTML view is pretty-printed (formatSource, one block per line); srcHtml()
// is the ONLY way to read it back, so the cosmetic newlines never reach the
// editor's innerHTML or the server. See write-view.js.
const srcHtml = () => unformatSource(textarea("docSource").value)

const currentHtml = () => (sourceMode ? srcHtml() : cleanHtml($("docEditor"), { doc: true }))
// The open chapter's words go back into the array — in memory only;
// `dirty` is untouched. Everything that persists reads allChapters().
const stashCurrent = () => {
	const ch = chapters[openIdx]
	if (ch) ch.html = currentHtml()
	return ch
}
const allChapters = () => {
	stashCurrent()
	return chapters.map(({ id, title, html }) => ({ id: id ?? null, title: title ?? "", html: html ?? "" }))
}
const openChapter = () => chapters[openIdx] || null

const updateWords = () => {
	const text = $("docEditor").innerText || ""
	const n = text.trim() ? text.trim().split(/\s+/).length : 0
	const rest = chapters.reduce((sum, c, i) => (i === openIdx ? sum : sum + (c.wordCount ?? countWordsHtml(c.html))), 0)
	$("wordCount").textContent = chapters.length > 1 ? `${wordsLabel(n)} · ${(n + rest).toLocaleString()} in all` : wordsLabel(n)
	// keep the open chapter's row and the panel's total in step while typing
	if (chapters[openIdx]) chapters[openIdx].wordCount = n
	const row = $("chapPanel").querySelector(".chap-row.open .chap-meta")
	if (row?.firstChild) row.firstChild.textContent = wordsLabel(n)
	const total = $("chapPanel").querySelector(".chap-total")
	if (total) total.textContent = `${chapters.length} chapter${chapters.length === 1 ? "" : "s"} · ${wordsLabel(n + rest)}`
}

// ---- load ----
async function load() {
	try {
		doc = (await api<{ doc: DocPayload }>("/api/docs/" + encodeURIComponent(docId), null, "GET")).doc
	} catch (e) {
		$("docErr").textContent = (e as Error).message
		return
	}
	input("docTitle").value = doc.title
	chapters = (doc.chapters || []).map((c) => ({ ...c }))
	if (!chapters.length) chapters = [{ id: null, title: "Chapter 1", html: doc.html || "" }]
	const want = parseInt(new URLSearchParams(location.search).get("ch") || "1", 10)
	openIdx = Math.min(chapters.length - 1, Math.max(0, (Number.isFinite(want) ? want : 1) - 1))
	$("docEditor").innerHTML = chapters[openIdx]?.html || ""
	renderVis() // the chip is part of the document's identity, so it loads with it
	comments = doc.comments || []
	const canEdit = !!doc.mine
	input("docTitle").disabled = !canEdit
	$("sprintBtn").classList.toggle("hidden", !canEdit)
	$("promptBtn").classList.toggle("hidden", !canEdit)
	if (!canEdit) {
		// Beta readers read the SAME editor element — that's what makes the
		// underlines and the click-to-jump identical for both sides — but
		// it is never contentEditable for them, and every writing control
		// is gone. Comment mode is the only mode they have.
		// The formatting controls go; the VIEW preferences stay. How a
		// story is set on your own screen — typeface, line spacing,
		// paper — is reading comfort, and reading is the whole of what
		// a beta reader came here to do.
		$("docToolbar").classList.add("hidden")
		$("modeSwitch").classList.add("hidden")
		$("commentToggle").classList.add("hidden")
		$("shareBtn").classList.add("hidden")
		$("saveBtn").classList.add("hidden")
		$("editorHint").classList.add("hidden")
	}
	setCommentMode(!canEdit) // readers start (and stay) in comment mode
	undoHistory.reset() // you can't undo your way back to the last document
	renderDoc()
	updateWords()
	renderChapters()
	setDirty(false)
	// A document whose anchors had to be repaired on the way in is
	// genuinely different from what's stored, so it reads as unsaved
	// rather than quietly writing itself back.
	if (repairedOnLoad) setDirty(true)

	const draft = loadDraft(docId)
	if (canEdit && draftIsNewer(draft, doc)) banners.show("restoreBar")
	connect()
}

// ---- comment mode ----
// Google Docs' model: a comment is pinned to the WORDS it's about, by a
// marker span living in the doc's html — <span class="cmt" data-cid="…">.
// The underline is that span's CSS, so it moves with the text and
// survives edits elsewhere in the paragraph. Clicking either half —
// underline or card — jumps to and highlights the other.
//
// Comment mode is a toggle for the author (off = the normal editor).
// Beta readers are locked INTO it: the editor is never editable for
// them, so their only way to change anything is to propose it, which
// is what makes "their edits turn into comments" true by construction
// rather than by politeness. The server re-checks all of this.
const canEditDoc = () => !!doc?.mine
const anchorsInDoc = () => [...$("docEditor").querySelectorAll<HTMLElement>("span.cmt[data-cid]")]

// A comment anchor is an INLINE marker. If it ever wraps a block —
// <span class="cmt"><p>…</p></span> — the browser gives it zero-height
// line boxes and draws the underline on nothing, so the commented words
// look uncommented. Selections that cross a paragraph boundary are the
// way in, so they're clamped to the block they start in.
let repairedOnLoad = false
const BLOCKS_SEL = "p,h1,h2,h3,blockquote,li"
const blockOf = (node: Node | null | undefined): Element | null => {
	let el: Element | null | undefined = node?.nodeType === 1 ? (node as Element) : node?.parentElement
	while (el && el !== $("docEditor")) {
		if (el.matches?.(BLOCKS_SEL)) return el
		el = el.parentElement
	}
	return null
}
function clampToBlock(range: Range | null): Range | null {
	if (!range) return range
	const block = blockOf(range.startContainer)
	if (!block || block.contains(range.endContainer)) return range
	const r = range.cloneRange()
	r.setEnd(block, block.childNodes.length)
	return r
}

function setCommentMode(on: boolean) {
	commentMode = canEditDoc() ? !!on : true // readers can never leave it
	palette?.close()
	$("docEditor").contentEditable = String(!commentMode && canEditDoc())
	$("commentToggle").classList.toggle("on", commentMode)
	$("commentToggle").setAttribute("aria-pressed", String(commentMode))
	$("commentToggle").setAttribute("aria-checked", String(commentMode))
	$("commentState").textContent = commentMode ? "On ✓" : "Off"
	$("docToolbar").classList.toggle("dimmed", commentMode || sourceMode)
	$("docEditor").classList.toggle("commenting", commentMode)
	renderCommentBanner()
	$("commentsHeading").dataset.tip = commentMode
		? "Select any words in the story to comment on them."
		: "Turn on comment mode to leave notes on your own words."
	if (!commentMode) clearComposer()
}

// The strip on the editor's top edge that says comment mode is ON and how
// to use it; Done leaves the mode (author only — a reader is always in it).
function renderCommentBanner() {
	const el = $("commentBanner")
	el.classList.toggle("hidden", !commentMode)
	if (!commentMode) return
	const count = comments.filter((c) => !c.resolved).length
	el.innerHTML = commentModeBannerHtml({ canExit: canEditDoc(), count })
}
$("commentBanner").addEventListener("click", (e) => {
	if ((e.target as HTMLElement).closest("#commentDone")) setCommentMode(false)
})

// Highlight one comment's words and its card together, and bring
// whichever half you didn't click into view.
// The sticky head's real height, published as a CSS variable so the
// comments pane can sit directly under it and a jumped-to word never
// lands beneath it. The head grows and shrinks — the unsaved-draft bar
// appears, the toolbar wraps on a narrow window — so it's measured, not
// guessed.
// The head only steals unusable space while it is PINNED. On a phone
// (≤760px) it is position:relative and scrolls away with the prose, so
// it costs a jump nothing — reporting its height there would push every
// jump target a headful too far down.
function stickyH() {
	const el = $("docShell")
	if (!el) return 0
	return getComputedStyle(el).position === "sticky" ? el.getBoundingClientRect().height : 0
}
function measureSticky() {
	document.documentElement.style.setProperty("--doc-sticky", Math.round(stickyH()) + "px")
}
if (window.ResizeObserver) new ResizeObserver(measureSticky).observe($("docShell"))
window.addEventListener("resize", measureSticky)
measureSticky()

// Put the commented words in the middle of the usable window. We aim at
// a computed position rather than handing it to scrollIntoView: the
// sticky head is not usable space, and a smooth scroll that silently
// does nothing (some browsers, some settings) would read as "clicking
// the comment is broken" — so we check and land it outright.
function scrollToAnchor(anchor: Element) {
	const rect = anchor.getBoundingClientRect()
	const top = scrollTargetFor({
		rectTop: rect.top,
		rectH: rect.height,
		scrollY: window.scrollY,
		viewportH: window.innerHeight,
		headH: stickyH(),
		maxScroll: document.documentElement.scrollHeight - window.innerHeight,
	})
	window.scrollTo({ top, behavior: "smooth" })
	setTimeout(() => {
		if (Math.abs(window.scrollY - top) > 4) window.scrollTo(0, top)
	}, 320)
}

// Bring a comment card into view. In two columns the pane is its own
// scroller and `nearest` moves it a few pixels — the page must not
// budge. In one column (phones) the pane is a plain block far below
// the prose, so the PAGE has to move, and `nearest` on a smooth
// scroll can silently do nothing — the same failure that made
// scrollToAnchor compute its own target. So: same treatment.
function scrollToCard(card: Element) {
	const pane = $("commentPane")
	if (pane && pane.scrollHeight > pane.clientHeight + 1) {
		card.scrollIntoView({ behavior: "smooth", block: "nearest" })
		return
	}
	const rect = card.getBoundingClientRect()
	const top = scrollTargetFor({
		rectTop: rect.top,
		rectH: rect.height,
		scrollY: window.scrollY,
		viewportH: window.innerHeight,
		headH: stickyH(),
		maxScroll: document.documentElement.scrollHeight - window.innerHeight,
	})
	window.scrollTo({ top, behavior: "smooth" })
	setTimeout(() => {
		if (Math.abs(window.scrollY - top) > 4) window.scrollTo(0, top)
	}, 320)
}

function focusComment(cid: string | null | undefined, { scroll = "both" }: { scroll?: "both" | "card" | "anchor" | "none" } = {}) {
	activeCid = cid || null
	anchorsInDoc().forEach((a) => a.classList.toggle("active", a.dataset.cid === cid))
	$("commentPane")
		.querySelectorAll<HTMLElement>(".doc-comment")
		.forEach((li) => li.classList.toggle("active", li.dataset.cid === cid))
	if (!cid) return
	const anchor = anchorsInDoc().find((a) => a.dataset.cid === cid)
	const card = $("commentPane").querySelector(`.doc-comment[data-cid="${CSS.escape(cid)}"]`)
	if (scroll !== "card" && anchor) {
		scrollToAnchor(anchor)
		// re-trigger the arrival flash even when the same comment is
		// clicked twice (an animation only plays on a class it just got)
		anchor.classList.remove("active")
		void anchor.offsetWidth
		anchor.classList.add("active")
	}
	if (scroll !== "anchor" && card) scrollToCard(card)
}

// Click an underline -> go to its comment. A closed drawer opens: the
// card is what the click is asking for, and a highlight nobody can see
// reads as a click that did nothing.
$("docEditor").addEventListener("click", (e) => {
	const a = (e.target as HTMLElement).closest<HTMLElement>("span.cmt[data-cid]")
	if (!a) return
	if (!prefs.sideOpen) setSideOpen(true)
	focusComment(a.dataset.cid, { scroll: "card" })
})

// Cards are ordered by where their words sit in the story, so the pane
// reads top-to-bottom like the prose does. Comments whose anchor is gone
// (the author rewrote that passage) fall to the bottom as orphans.
// Anchors we've just placed but the server hasn't echoed back yet —
// without this the prune below would strip a brand-new comment's
// underline in the moment between sending it and hearing about it.
const pendingCids = new Set<string>()

// The editor's mirror of writeDoc's rule: an underline is only legal
// while a live, unresolved comment stands behind it. Resolving,
// deleting, rejecting — and then undoing — all used to leave the span
// sitting in the html (visible in the HTML view, and saved back on the
// next save). The words always stay; only the marker goes.
function pruneLocalAnchors() {
	const live = new Set(comments.filter((c) => !c.resolved && c.cid).map((c) => c.cid!))
	let changed = false
	// Repair anchors that wrap a block (written before the clamp above,
	// or pasted in). Only the author may: a reader's copy of the html
	// has to stay byte-identical to the stored one or their next
	// comment is refused.
	if (canEditDoc()) {
		for (const a of anchorsInDoc()) {
			const block = a.querySelector(BLOCKS_SEL)
			if (!block) continue
			const cid = a.dataset.cid || ""
			a.replaceWith(...a.childNodes)
			const span = document.createElement("span")
			span.className = "cmt"
			span.dataset.cid = cid
			while (block.firstChild) span.appendChild(block.firstChild)
			block.appendChild(span)
			changed = true
		}
		if (changed) {
			repairedOnLoad = true // a real edit: it has to be saved
			if (doc) setDirty(true)
		}
	}
	for (const a of anchorsInDoc()) {
		const cid = a.dataset.cid || ""
		if (live.has(cid) || pendingCids.has(cid)) continue
		a.replaceWith(...a.childNodes)
		changed = true
	}
	// merge the text nodes the unwrap left split apart
	if (changed) $("docEditor").normalize()
	// The HTML view is raw text that nothing re-renders: the same anchors
	// have to come out of it, or a deleted comment's span stays on screen
	// and, since the textarea is what's read on the way back, comes back.
	if (sourceMode) {
		const src = textarea("docSource").value
		const pruned = pruneSource(src, [...live, ...pendingCids])
		if (pruned !== src) { textarea("docSource").value = pruned; changed = true }
	}
	return changed
}

function renderComments() {
	pruneLocalAnchors()
	const order = anchorsInDoc().map((a) => a.dataset.cid || "")
	const anchored = (c: CommentRow) => !!c.cid && order.includes(c.cid)
	// The rail shows the OPEN chapter's comments: a comment belongs to
	// the chapter whose html holds its anchor (chapterId, from the
	// server), which for the chapter on screen is the same as being
	// anchored in the DOM. Orphans belong to no chapter and always show;
	// resolved ones show with their chapter.
	const here = (c: CommentRow) => !c.chapterId || c.chapterId === openChapter()?.id
	const live = comments.filter((c) => !c.resolved && anchored(c))
	// Resolving or deciding a comment deliberately removes its anchor, so
	// "no anchor" alone doesn't mean orphaned — only an UNRESOLVED comment
	// whose words are gone has actually lost track of what it was about —
	// and a comment anchored in ANOTHER chapter isn't orphaned either.
	const orphans = comments.filter((c) => !c.resolved && !anchored(c) && !c.chapterId)
	const done = comments.filter((c) => c.resolved && here(c))
	const elsewhere = comments.filter((c) => !c.resolved && c.chapterId && c.chapterId !== openChapter()?.id).length
	live.sort((a, b) => order.indexOf(a.cid!) - order.indexOf(b.cid!))
	const isOwner = canEditDoc()
	const opts = { isOwner, meName: me?.username || "" }
	let html = live.map((c) => commentThreadHtml([c], opts)).join("")
	if (orphans.length)
		html += `<div class="dc-group orphan">${commentThreadHtml(orphans, { ...opts, orphaned: true })}</div>`
	if (done.length)
		html += `<div class="dc-group done"><p class="dc-orphan-note">Done (${done.length})</p>${commentThreadHtml(done, opts)}</div>`
	$("commentPane").innerHTML = html || `<p class="subtle">No comments${elsewhere ? " in this chapter" : " yet"}.</p>`
	// The edge tab carries the WHOLE story's count, so closing the drawer
	// hides the notes but never the fact that they exist; the heading
	// counts only the open chapter's.
	const total = live.length + orphans.length + elsewhere
	$("commentsOpenCount").textContent = total ? String(total) : ""
	$("commentsHeading").textContent = live.length + orphans.length ? `💬 Comments · ${live.length + orphans.length}` : "💬 Comments"
	paintChapterCounts()
	renderCommentBanner()
	if (activeCid) focusComment(activeCid, { scroll: "none" })
	renderComposer()
}

function renderDoc() {
	renderComments()
}

// ---- the composer ----
// Opened by selecting text in comment mode. It holds the note AND the
// suggestion box: typing a different wording there is how an edit
// becomes a proposal the author can accept.
// Motion. GSAP when it's there and the reader hasn't asked for less;
// otherwise the class/attribute change alone still does the job.
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
const anim = () => (window.gsap && !reduceMotion ? window.gsap : null)
function clearComposer() {
	pendingRange = null
	const box = $("commentComposer").firstElementChild
	const g = anim()
	const drop = () => $("commentComposer").replaceChildren()
	if (box && g) {
		g.killTweensOf(box)
		g.to(box, { opacity: 0, y: -6, duration: 0.15, ease: "power2.in", onComplete: drop })
		setTimeout(drop, 380) // rAF can be frozen; the box still has to go
	} else drop()
}

function renderComposer() {
	if (!pendingRange) return
	// A note has to be visible to be written: opening the composer opens
	// the drawer, whatever state it was left in.
	if (!prefs.sideOpen) setSideOpen(true)
	const quote = pendingRange.toString().trim()
	const box = document.createElement("div")
	box.className = "dc-new"
	box.innerHTML =
		`<p class="dc-quote">${esc(quote.slice(0, 200))}</p>` +
		// the choice of WHAT you're leaving comes before the box you
		// leave it in, since it decides which box that is
		`<label class="dc-suggest-toggle"><input type="checkbox" id="suggestOn" /> Suggest a rewrite</label>` +
		`<textarea id="newComment" rows="5" placeholder="Leave a note…"></textarea>` +
		`<textarea id="newSuggestion" class="hidden" rows="5"></textarea>` +
		`<div class="row"><button class="ghost" id="newCancel" type="button">Cancel</button>` +
		`<button class="primary" id="newSend" type="button">Comment</button></div>`
	$("commentComposer").replaceChildren(box)
	anim()?.from(box, { opacity: 0, y: -8, duration: 0.22, ease: "power2.out" })
	// Suggesting swaps the note out for the rewrite: the proposed words
	// ARE the message, and two boxes at once crowd a narrow rail.
	input("suggestOn").addEventListener("change", () => {
		const on = input("suggestOn").checked
		// a straight swap: the boxes are the same size, so animating
		// the change just made it wobble
		$("newComment").classList.toggle("hidden", on)
		$("newSuggestion").classList.toggle("hidden", !on)
		if (on) {
			textarea("newSuggestion").focus()
			textarea("newSuggestion").select()
		}
		// prefilled with the current words, so editing them IS the suggestion
		if (on) textarea("newSuggestion").value = quote
		$("newSend").textContent = on ? "Suggest" : "Comment"
	})
	$("newSend").addEventListener("click", sendComment)
	$("newCancel").addEventListener("click", () => (clearComposer(), renderComments()))
	// Autofocus is a DESKTOP convenience only. On a touch device, focusing
	// a textarea collapses the selection and tears down the selection
	// handles — you would lose the very words you just highlighted, and
	// the keyboard would cover them. There, the box waits to be tapped.
	if (!coarsePointer()) $("newComment").focus()
}

// Selecting words in comment mode offers to comment on them.
//
// Touch needs different timing from a mouse. A drag with a mouse is over
// when the movement stops, so a debounce is enough. A touch selection is
// NOT: the words appear selected and then you drag the handles to adjust
// them, which can take seconds — and anything that renders (or focuses)
// mid-gesture drops the selection and the handles with it. So on a coarse
// pointer the composer waits for the gesture to actually finish.
const coarsePointer = () => window.matchMedia?.("(pointer: coarse)").matches
let touchingText = false
for (const ev of ["pointerdown", "touchstart"])
	$("docEditor").addEventListener(ev, () => (touchingText = true), { passive: true })
for (const ev of ["pointerup", "pointercancel", "touchend", "touchcancel"])
	document.addEventListener(
		ev,
		() => {
			if (!touchingText) return
			touchingText = false
			// the handles settle a beat after the finger lifts
			if (pendingRange && commentMode) (clearTimeout(composerTimer), (composerTimer = setTimeout(renderComposer, 400)))
		},
		{ passive: true },
	)
document.addEventListener("selectionchange", () => {
	if (!commentMode || !doc) return
	const sel = window.getSelection()
	if (!sel || !sel.rangeCount || sel.isCollapsed) return
	const r = sel.getRangeAt(0)
	if (!$("docEditor").contains(r.commonAncestorContainer)) return
	if (!r.toString().trim()) return
	// clamped here too, so the quote in the composer is exactly the text
	// the underline will end up on
	pendingRange = clampToBlock(r.cloneRange())
	clearTimeout(composerTimer)
	// debounced: a drag fires selectionchange on every mousemove. While a
	// finger is still down the composer is not scheduled at all — the
	// pointerup handler above does it once the selection is final.
	if (!touchingText) composerTimer = setTimeout(() => renderComposer(), 250)
})

// Wrap the selected words in a fresh anchor and send the WHOLE html.
// The server accepts it only if stripping that one anchor gives back
// exactly what it stored — which is what stops a beta reader's
// "comment" from carrying an edit along with it.
function sendComment() {
	const text = textarea("newComment").value.trim()
	const suggestion = input("suggestOn")?.checked ? textarea("newSuggestion").value.trim() : null
	if ((!text && suggestion == null) || !pendingRange) return
	// a chapter the server hasn't seen yet has nowhere to file a comment
	if (chapters.length > 1 && !openChapter()?.id) return setStatus("Save first, then comment in the new chapter")
	const cid = newCid()
	const span = document.createElement("span")
	span.className = "cmt"
	span.dataset.cid = cid
	try {
		pendingRange.surroundContents(span)
	} catch (e) {
		// the selection crosses an element boundary — extract instead
		span.appendChild(pendingRange.extractContents())
		pendingRange.insertNode(span)
	}
	const html = cleanHtml($("docEditor"), { doc: true })
	socket?.emit("doc-comment", { auth: getToken(), id: docId, cid, chapterId: openChapter()?.id ?? null, html, text, suggestion })
	// The author owns the html, so their copy is now dirty and must be
	// saved; a reader's copy is only a local echo of what they proposed.
	if (canEditDoc()) setDirty(true)
	pendingCids.add(cid)
	clearComposer()
	window.getSelection()?.removeAllRanges()
	activeCid = cid
}

// Accept: the anchored words become the proposed ones. Reject: the words
// stand and only the underline goes. Mirrors applySuggestion/stripAnchor
// on the server, which stays the authority — this is the author's own
// view keeping up with their click.
function decideLocally(c: CommentRow | undefined, accept: boolean) {
	if (!c || !canEditDoc() || !c.cid) return
	const taking = accept && typeof c.suggestion === "string"
	if (sourceMode) {
		// the textarea is the live copy here; the hidden editor is re-parsed from it
		const src = textarea("docSource").value
		textarea("docSource").value = taking ? applySuggestionInSource(src, c.cid, c.suggestion as string) : stripAnchorInSource(src, c.cid)
		if (activeCid === c.cid) activeCid = null
		setDirty(true)
		return
	}
	const span = anchorsInDoc().find((a) => a.dataset.cid === c.cid)
	if (!span) return
	if (taking) span.replaceWith(document.createTextNode(c.suggestion as string))
	else span.replaceWith(...span.childNodes)
	if (activeCid === c.cid) activeCid = null
	setDirty(true)
	updateWords()
	undoHistory.record()
}

$("commentToggle").addEventListener("click", () => setCommentMode(!commentMode))

// ---- Prompt roller ----
// One mount of the game's prompt-mode picker (Simple / Advanced +
// knobs), a Roll that asks the server for ONE prompt, and Insert,
// which exists only once a prompt is on the card.
let rolled: { prompt: string } | null = null
const soloPrompt = mountPromptModes($("soloPrompt"), { prefix: "soloPm" })
let promptMenusLoaded = false
async function openPromptModal() {
	if (!promptMenusLoaded) {
		try {
			soloPrompt.setMenus(await api<PromptMenus>("/api/prompt-options", null, "GET"))
			promptMenusLoaded = true
		} catch (e) { /* Simple still works */ }
	}
	$("promptModal").classList.remove("hidden")
	$("promptRollBtn").focus()
}
function closePromptModal() {
	$("promptModal").classList.add("hidden")
}
function showRolled(r: { prompt: string }) {
	rolled = r
	$("promptCard").innerHTML = promptHtml(r.prompt)
	$("promptCard").classList.remove("hidden")
	$("promptInsert").classList.remove("hidden")
	$("promptRollBtn").textContent = "🎲 Reroll"
	$("promptRollHint").textContent = "Not it? Roll again."
}
$("promptBtn").addEventListener("click", openPromptModal)
$("promptCancel").addEventListener("click", closePromptModal)
$("promptModal").addEventListener("click", (e) => {
	if (e.target === $("promptModal")) closePromptModal()
})
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && !$("promptModal").classList.contains("hidden")) closePromptModal()
})
$("promptRollBtn").addEventListener("click", async () => {
	$("promptErr").textContent = ""
	const { promptMode, promptControls } = soloPrompt.values()
	try {
		showRolled(await api<{ prompt: string }>("/api/prompt/roll", { mode: promptMode, controls: promptControls }))
	} catch (e) {
		$("promptErr").textContent = (e as Error).message || "Couldn't roll."
	}
})
$("promptInsert").addEventListener("click", () => {
	if (!rolled) return
	// centred, categories in bold, right under the heading (or first)
	insertAfterHeading($("docEditor"), promptInsertHtml(rolled.prompt))
	onEdit({ immediate: true })
	closePromptModal()
})

$("commentPane").addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	const li = t.closest<HTMLElement>(".doc-comment")
	if (!li) return
	const commentId = li.dataset.id || ""
	// Whatever I do to it, it is no longer "just sent": the prune may take
	// its anchor the moment the server says the comment is gone.
	if (li.dataset.cid) pendingCids.delete(li.dataset.cid)
	if (t.closest(".dc-accept") || t.closest(".dc-reject")) {
		// The author is the only one who can decide, and it's their editor
		// that has to change. Apply it HERE as well as on the server: their
		// copy is dirty the moment they place an anchor, and a dirty editor
		// ignores incoming html pushes rather than moving their caret.
		const accept = !!t.closest(".dc-accept")
		decideLocally(
			comments.find((c) => c.id === commentId),
			accept,
		)
		socket?.emit("doc-comment-decide", { auth: getToken(), id: docId, commentId, accept })
	} else if (t.closest(".dc-resolve"))
		socket?.emit("doc-comment-resolve", {
			auth: getToken(),
			id: docId,
			commentId,
			resolved: !li.classList.contains("resolved"),
		})
	else if (t.closest(".dc-del")) socket?.emit("doc-comment-delete", { auth: getToken(), id: docId, commentId })
	// a plain click on the card jumps to the words it's about
	else focusComment(li.dataset.cid || null, { scroll: "anchor" })
})
// ---- editing ----
// Prefer real tags over <span style> for execCommand output.
try {
	document.execCommand("styleWithCSS", false, "false")
} catch (e) {}

$("docToolbar").addEventListener("mousedown", (e) => {
	const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-cmd]")
	if (!b) return
	e.preventDefault() // keep the selection
	document.execCommand(b.dataset.cmd || "", false, NOVAL)
	onEdit({ immediate: true })
})
// Choosing a block format is choosing a size: a heading carrying an
// old fs-* span renders at the SPAN's size (nearest ancestor wins), so
// the format would appear to do nothing. The spans in the blocks the
// selection touches go with the change.
$("blockFormat").addEventListener("change", () => {
	document.execCommand("formatBlock", false, "<" + $<HTMLSelectElement>("blockFormat").value + ">")
	const sel = window.getSelection()
	if (sel?.rangeCount) clearSizesInBlocks($("docEditor"), sel.getRangeAt(0))
	$("docEditor").focus()
	syncFontBox()
	onEdit({ immediate: true })
})
// Lists and alignment are each one dropdown: the options are mutually
// exclusive, so a select says what three toggle buttons only implied.
$("alignSelect").addEventListener("change", () => {
	document.execCommand($<HTMLSelectElement>("alignSelect").value, false, NOVAL)
	$("docEditor").focus()
	onEdit({ immediate: true })
})
$("listSelect").addEventListener("change", () => {
	const v = $<HTMLSelectElement>("listSelect").value
	// "No list" means: turn off whichever list the caret is currently in.
	if (v === "none") {
		;["insertUnorderedList", "insertOrderedList"].forEach((c) => {
			if (document.queryCommandState(c)) document.execCommand(c, false, NOVAL)
		})
	} else document.execCommand(v, false, NOVAL)
	$("docEditor").focus()
	onEdit({ immediate: true })
})
// ---- clear formatting (✕) ----
// execCommand("removeFormat") alone is why this button felt dead: it undoes
// b/i/u/s and nothing else — our class-based fs-* spans, links, headings,
// lists, quotes and alignment all survive it. So we rebuild the selection as
// plain paragraphs instead. With nothing selected we clear the block the
// caret sits in, so the button always does something visible.
const blockAt = (node: Node | null | undefined): Element | null => {
	let n: Element | null | undefined = node?.nodeType === 1 ? (node as Element) : node?.parentElement
	while (n && n !== $("docEditor")) {
		if (/^(P|H1|H2|H3|DIV|LI|BLOCKQUOTE|FIGURE)$/.test(n.tagName)) return n
		n = n.parentElement
	}
	return null
}
function clearFormatting() {
	const sel = window.getSelection()
	if (!sel || !sel.rangeCount) return
	if (!$("docEditor").contains(sel.getRangeAt(0).commonAncestorContainer)) return
	$("docEditor").focus()
	if (sel.isCollapsed) {
		const block = blockAt(sel.getRangeAt(0).startContainer)
		if (!block) return
		const r = document.createRange()
		r.selectNode(block) // the block itself, so its tag and alignment go too
		sel.removeAllRanges()
		sel.addRange(r)
	}
	// Leave any list first — otherwise the <ul> shell outlives its <li>s.
	;["insertUnorderedList", "insertOrderedList"].forEach((c) => {
		try {
			if (document.queryCommandState(c)) document.execCommand(c, false, NOVAL)
		} catch (e) {}
	})
	const box = document.createElement("div")
	box.appendChild(window.getSelection()!.getRangeAt(0).cloneContents())
	document.execCommand("insertHTML", false, plainBlockHtml(box.innerHTML) || "<p><br></p>")
	document.execCommand("justifyLeft", false, NOVAL)
	syncFontBox()
	onEdit({ immediate: true })
}
$("clearFmtBtn").addEventListener("mousedown", (e) => {
	e.preventDefault() // keep the selection
	clearFormatting()
})

$("emDashBtn").addEventListener("mousedown", (e) => {
	e.preventDefault()
	$("docEditor").focus()
	document.execCommand("insertText", false, "—")
	onEdit({ immediate: true })
})
// The range the size box will act on, remembered while the editor still
// has the selection (see rememberRange).
let sizeRange: Range | null = null
// ---- font size (document content) ----
// execCommand's fontSize only speaks 1–7, so we ask for the sentinel
// 7 and rewrite the <font> tags it produces into our class ladder
// (components/font-size.js). The ladder is a closed set, so nothing
// arbitrary reaches the html.
function applyFontSize(px: number) {
	// execCommand only works on the focused editable, and the size box
	// may well hold focus right now — focus FIRST, then command.
	$("docEditor").focus()
	document.execCommand("fontSize", false, "7")
	// Swapping the <font> tags out destroys the range, so re-select the
	// spans we just made. Resizing must LEAVE THE TEXT SELECTED, the way
	// every word processor does — otherwise you can't resize twice, or
	// bold what you just resized, without re-dragging.
	const made = absorbFontTags($("docEditor"), px)
	$("docEditor").focus()
	if (made.length) {
		const r = document.createRange()
		r.setStartBefore(made[0]!)
		r.setEndAfter(made[made.length - 1]!)
		const sel = window.getSelection()!
		sel.removeAllRanges()
		sel.addRange(r)
	}
	syncFontBox()
	onEdit({ immediate: true })
}
function sizesInSelection() {
	const sel = window.getSelection()
	if (!sel || !sel.rangeCount) return []
	return sizesInRange($("docEditor"), sel.getRangeAt(0))
}
const syncFontBox = () => {
	const sizes = sizesInSelection()
	// In a heading the size box is off, not lying: the heading owns its
	// size, so a number there would do nothing.
	const sel0 = window.getSelection()
	const inHeading = sel0?.rangeCount ? headingOnly($("docEditor"), sel0.getRangeAt(0)) : false
	for (const id of ["fsInput", "fsUp", "fsDown"]) $<HTMLInputElement | HTMLButtonElement>(id).disabled = inHeading
	$("fontStepper").dataset.tip = inHeading
		? "The heading style sets this text's size"
		: "Font size of the selected text"
	if (inHeading) input("fsInput").value = "—"
	else if (sizes.length > 1) input("fsInput").value = "Multi"
	else if (sizes.length === 1) input("fsInput").value = String(sizes[0])
	try {
		$<HTMLSelectElement>("listSelect").value = document.queryCommandState("insertUnorderedList")
			? "insertUnorderedList"
			: document.queryCommandState("insertOrderedList")
				? "insertOrderedList"
				: "none"
		$<HTMLSelectElement>("alignSelect").value = document.queryCommandState("justifyCenter")
			? "justifyCenter"
			: document.queryCommandState("justifyRight")
				? "justifyRight"
				: "justifyLeft"
		// Without a border on each button, the pressed state IS the only
		// signal that bold/italic/underline/strike are on — so keep it
		// in step with the caret.
		for (const [cls, cmd] of [
			["tb-b", "bold"],
			["tb-i", "italic"],
			["tb-u", "underline"],
			["tb-s", "strikeThrough"],
		])
			$("docToolbar")
				.querySelector("." + cls)
				?.classList.toggle("on", document.queryCommandState(cmd))
	} catch (e) {}
}
$("docEditor").addEventListener("keyup", syncFontBox)
$("docEditor").addEventListener("mouseup", syncFontBox)
// Drag-select with the mouse, extend with shift+arrows, undo — all of it
// moves the selection, and the toolbar should read the selection.
document.addEventListener("selectionchange", () => {
	if (commentMode || sourceMode) return
	syncFontBox()
	rememberRange() // the size box needs it AFTER focus has left the editor
})

// Stepping off a mixed selection starts from its smallest size, so
// "bigger" is always bigger than something actually on screen.
const sizeForStep = () => {
	const sizes = sizesInSelection()
	if (sizes.length) return Math.min(...sizes)
	return parseSize(input("fsInput").value) ?? DEFAULT_SIZE
}
const stepSize = (dir: number) => {
	const i = FONT_SIZES.indexOf(nearestSize(sizeForStep()) as (typeof FONT_SIZES)[number])
	applyFontSize(FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, i + dir))]!)
}
// mousedown, not click: the selection must survive the press
$("fsDown").addEventListener("mousedown", (e) => (e.preventDefault(), stepSize(-1)))
$("fsUp").addEventListener("mousedown", (e) => (e.preventDefault(), stepSize(1)))
// Typing in the size box moves focus out of the editor, and a browser
// keeps ONE selection: the moment the input takes focus the highlighted
// words are forgotten. So remember the range on the way out and put it
// back before applying — the text you highlighted is still the text
// that resizes.
// declared before the selectionchange listener above needs it
const rememberRange = () => {
	const sel = window.getSelection()
	if (!sel || !sel.rangeCount) return
	const r = sel.getRangeAt(0)
	if ($("docEditor").contains(r.commonAncestorContainer) && !r.collapsed) sizeRange = r.cloneRange()
}
const restoreRange = () => {
	if (!sizeRange || !$("docEditor").contains(sizeRange.commonAncestorContainer)) return false
	const sel = window.getSelection()!
	sel.removeAllRanges()
	sel.addRange(sizeRange)
	return true
}
// Keep the words visibly highlighted while the box is being edited. A
// browser dims the selection once focus leaves the editor, so paint it
// ourselves. Driven by mousedown rather than focus: the press happens
// before the selection moves, and it fires even when the window itself
// isn't focused.
// ::selection only paints a selection the browser still holds, and
// focusing the input takes it away — so re-paint the remembered range
// ourselves with the Custom Highlight API where it exists.
const HL = window.Highlight && CSS.highlights ? new Highlight() : null
if (HL) CSS.highlights.set("fs-sel", HL)
const holdSel = (on: boolean) => {
	$("docEditor").classList.toggle("hold-sel", on)
	if (!HL) return
	HL.clear()
	if (on && sizeRange) HL.add(sizeRange)
}
$("fontStepper").addEventListener("mousedown", () => (rememberRange(), holdSel(true)))
$("fsInput").addEventListener("blur", () => holdSel(false))
$("docEditor").addEventListener("mousedown", () => holdSel(false))
// Typing replaces what the box says — including "Multi" — the way a
// word processor's size box does.
input("fsInput").addEventListener("focus", () => input("fsInput").select())

const applyFromBox = () => {
	// "24px", "24 pt", a stray space — take the number out of whatever
	// was typed. Nothing numeric at all (an empty box, "Multi" left
	// untouched) leaves the selection's own size alone.
	const px = parseSize(input("fsInput").value)
	$("docEditor").focus() // take focus back before touching the selection
	restoreRange()
	applyFontSize(px ?? sizeForStep())
	holdSel(false)
}
$("fsInput").addEventListener("change", applyFromBox)
$("fsInput").addEventListener("keydown", (e) => {
	if (e.key !== "Enter") return
	e.preventDefault()
	applyFromBox()
})

// ---- undo / redo ----
// The number in the size box follows the selection, so after an undo it
// reports whatever the text is NOW rather than what was last typed.
function undoRedo(redo: boolean) {
	$("docEditor").focus()
	clearTimeout(typingTimer)
	undoHistory.record() // fold any in-flight typing in before stepping
	if (!(redo ? undoHistory.redo() : undoHistory.undo())) return
	setDirty(true)
	updateWords()
	renderComments() // anchors may have come back or gone away
	syncFontBox() // the size box reports the text as it is NOW
}
$("undoBtn").addEventListener("mousedown", (e) => (e.preventDefault(), undoRedo(false)))
$("redoBtn").addEventListener("mousedown", (e) => (e.preventDefault(), undoRedo(true)))
// Ctrl/⌘+Z anywhere on the page does what the button does. Bound on
// the document, not the editor: after clicking a toolbar control the
// focus may be on that control, and the shortcut has to keep working.
// Real text fields (the title, the HTML view, a modal input) keep the
// browser's own undo — theirs is the right one there.
const nativeUndoField = (el: EventTarget | Element | null) =>
	!!el && el !== $("docEditor") && ((el as Element).tagName === "INPUT" || (el as Element).tagName === "TEXTAREA")
document.addEventListener("keydown", (e) => {
	const meta = e.metaKey || e.ctrlKey
	if (!meta || e.key.toLowerCase() !== "z") return
	if (nativeUndoField(e.target) || nativeUndoField(document.activeElement)) return
	e.preventDefault()
	undoRedo(e.shiftKey)
})

// ---- line spacing (this reader's preference only) ----
// Applied as a CSS variable on the editor surfaces. It is never part
// of cleanHtml's output, so it cannot end up in the saved document.
let prefs = loadPrefs()
function applyLineHeight() {
	document.documentElement.style.setProperty("--doc-line", String(prefs.lineHeight))
	$("lsValue").textContent = prefs.lineHeight.toFixed(1)
}
const nudgeLine = (dir: number) => {
	// spread: savePrefs writes the whole blob, so dropping the other
	// preferences here would reset the paper colour on every nudge
	prefs = savePrefs({ ...prefs, lineHeight: stepLine(prefs.lineHeight, dir) })
	applyLineHeight()
}
$("lsDown").addEventListener("click", () => nudgeLine(-1))
$("lsUp").addEventListener("click", () => nudgeLine(1))
applyLineHeight()

// ---- paper colour (this writer's preference only) ----
// Stored beside line spacing and applied the same way: an attribute on
// the writing surfaces, never a change to the document.
function applyPaper() {
	for (const el of [$("docEditor"), $("docSource")]) el.dataset.paper = prefs.paper
	for (const b of $("paperSelect").querySelectorAll<HTMLElement>("[data-paper]")) {
		b.classList.toggle("on", b.dataset.paper === prefs.paper)
		b.setAttribute("aria-pressed", String(b.dataset.paper === prefs.paper))
	}
}
// ---- typeface (this writer's preference only) ----
// The families are the ones the site already loads (fonts.json), so a
// choice here costs nothing extra. Applied as a CSS variable on the
// writing surfaces: it never enters the document.
function applyFont() {
	const stack = fontOf(prefs.font).stack
	// Set on the page root, not on the two writing surfaces: the
	// typeface you chose dresses the whole page — title, toolbar,
	// comments and all — and the surfaces inherit it from here.
	// "theme" removes the property so every face falls back to the
	// theme's own.
	const root = document.body
	stack ? root.style.setProperty("--doc-font", stack) : root.style.removeProperty("--doc-font")
	$("fontSelect").innerHTML = fontListHtml(prefs.font)
}
$("fontSelect").addEventListener("click", (e) => {
	const row = (e.target as HTMLElement).closest<HTMLElement>("[data-font]")
	if (!row) return
	prefs = savePrefs({ ...prefs, font: row.dataset.font || "theme" })
	applyFont()
})
applyFont()

$("paperSelect").addEventListener("click", (e) => {
	const v = (e.target as HTMLElement).closest<HTMLElement>("[data-paper]")?.dataset.paper
	if (!v) return
	const paper = (PAPERS as readonly string[]).includes(v) ? (v as (typeof PAPERS)[number]) : "theme"
	prefs = savePrefs({ ...prefs, paper })
	applyPaper()
})
applyPaper()

// ---- the comments drawer (this writer's preference only) ----
// Open/closed and how wide, remembered per browser. Closing it gives the
// prose the whole width; the edge tab keeps the comment count visible so
// a closed drawer never hides the fact that there are notes waiting. The
// same number drives the grid column on desktop and the sheet's height on
// a phone, where the drawer comes up from the bottom instead of in from
// the side.
const phoneSide = () => window.matchMedia("(max-width: 860px)").matches
function applySide() {
	document.documentElement.style.setProperty("--doc-side-w", prefs.sideWidth + "px")
	document.querySelector(".doc-main")?.classList.toggle("side-closed", !prefs.sideOpen)
	$("docSide").classList.toggle("open", !!prefs.sideOpen)
	$("commentsOpen").classList.toggle("hidden", !!prefs.sideOpen)
	$("commentsOpen").setAttribute("aria-expanded", String(!!prefs.sideOpen))
}
function setSideOpen(open: boolean) {
	prefs = savePrefs({ ...prefs, sideOpen: !!open })
	applySide()
}
function setSideWidth(px: number) {
	prefs = savePrefs({ ...prefs, sideWidth: clampSide(px) })
	applySide()
}
$("commentsClose").addEventListener("click", () => setSideOpen(false))
$("commentsOpen").addEventListener("click", () => setSideOpen(true))

// Drag the grip: on desktop the pointer's distance from the right edge IS
// the width; on a phone the sheet's height is measured up from the bottom.
// Pointer events cover mouse, pen and touch in one path.
let sideDrag = false
const gripEnd = () => {
	sideDrag = false
	document.body.classList.remove("resizing-side")
}
$("docSideGrip").addEventListener("pointerdown", (e) => {
	sideDrag = true
	document.body.classList.add("resizing-side")
	$("docSideGrip").setPointerCapture?.(e.pointerId)
})
$("docSideGrip").addEventListener("pointermove", (e) => {
	if (!sideDrag) return
	e.preventDefault()
	setSideWidth(phoneSide() ? window.innerHeight - e.clientY : window.innerWidth - e.clientX)
})
$("docSideGrip").addEventListener("pointerup", gripEnd)
$("docSideGrip").addEventListener("pointercancel", gripEnd)
$("docSideGrip").addEventListener("dblclick", () => setSideWidth(DEFAULT_SIDE))
// Keyboard-reachable: a drag handle nobody can tab to is a control that
// doesn't exist for part of the audience.
$("docSideGrip").addEventListener("keydown", (e) => {
	const step = e.shiftKey ? 48 : 16
	if (e.key === "ArrowLeft") (e.preventDefault(), setSideWidth(prefs.sideWidth + step))
	else if (e.key === "ArrowRight") (e.preventDefault(), setSideWidth(prefs.sideWidth - step))
	else if (e.key === "Escape") setSideOpen(false)
})
applySide()

$("linkBtn").addEventListener("mousedown", (e) => {
	e.preventDefault()
	const url = prompt("Link URL (http:// or https://)")
	if (url && /^https?:\/\//i.test(url)) document.execCommand("createLink", false, url)
	onEdit()
})
$("imgBtn").addEventListener("mousedown", (e) => {
	e.preventDefault()
	const url = prompt("Image URL (http:// or https://)")
	if (url && /^https?:\/\//i.test(url)) document.execCommand("insertImage", false, url)
	onEdit()
})

// The editor keeps its own undo stack — see components/history.js for why
// the browser's can't be used here. Every mutation funnels through
// onEdit(), so that is the one place a state needs recording.
const undoHistory = createHistory($("docEditor"))
let typingTimer: ReturnType<typeof setTimeout> | undefined
function onEdit({ immediate = false }: { immediate?: boolean } = {}) {
	setDirty(true)
	updateWords()
	clearTimeout(typingTimer)
	// Typing coalesces into one undo step per pause, the way a word
	// processor does; a toolbar action is its own step immediately.
	if (immediate) undoHistory.record()
	else typingTimer = setTimeout(() => undoHistory.record(), 350)
}
$("docEditor").addEventListener("input", () => onEdit())
$("docTitle").addEventListener("input", () => setDirty(true))

// Paste from Google Docs / Word / anywhere. The browser's own paste
// would drop a pile of foreign markup into the contenteditable, so we
// run the clipboard through cleanHtml first (which reads the inline
// STYLES word processors use for italics) and then convert any literal
// *asterisk* markers a plain-text draft carried in.
$("docEditor").addEventListener("paste", (e) => {
	const cd = e.clipboardData || (window as unknown as { clipboardData?: DataTransfer }).clipboardData
	if (!cd) return
	e.preventDefault()
	const html = cd.getData("text/html")
	let out: string
	if (html) {
		const box = document.createElement("div")
		box.innerHTML = html
		out = cleanHtml(box, { doc: true })
	} else {
		// plain text: escape it, then keep the line breaks as paragraphs
		const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)
		out = esc(cd.getData("text/plain"))
			.split(/\n{2,}/)
			.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
			.join("")
	}
	document.execCommand("insertHTML", false, asterisksToTags(out))
	onEdit({ immediate: true })
})

// ---- rich text / html source mode ----
// setMode is idempotent: clicking the half you're already on is a no-op,
// so it never marks the doc dirty or re-parses for nothing.
function setMode(toSource: boolean) {
	if (toSource === sourceMode) return
	palette?.close() // don't leave the reference menu floating over the source
	if (toSource && commentMode) setCommentMode(false) // can't point at words you can't see
	if (toSource) {
		textarea("docSource").value = formatSource(cleanHtml($("docEditor"), { doc: true }))
	} else {
		// Drop the cosmetic newlines BEFORE parsing, then round-trip hand-typed
		// markup through cleanHtml so it's normalized to the supported subset.
		$("docEditor").innerHTML = srcHtml()
		$("docEditor").innerHTML = cleanHtml($("docEditor"), { doc: true })
	}
	sourceMode = toSource
	$("docEditor").classList.toggle("hidden", toSource)
	$("docSource").classList.toggle("hidden", !toSource)
	$("docToolbar").classList.toggle("dimmed", toSource)
	// the lit half is the mode you're IN
	$("modeRich").classList.toggle("on", !toSource)
	$("modeHtml").classList.toggle("on", toSource)
	$("modeRich").setAttribute("aria-pressed", String(!toSource))
	$("modeHtml").setAttribute("aria-pressed", String(toSource))
	finder?.refresh()
	$("editorHint").innerHTML = toSource
		? "Editing raw HTML: unsupported tags are stripped when you switch back or save."
		: "Type <b>/</b> for action verbs, dialogue tags and more · Ctrl/⌘+S to save · autosaves every 30s"
	if (!toSource) updateWords()
	;(toSource ? $("docSource") : $("docEditor")).focus()
	setDirty(true)
}
$("modeRich").addEventListener("click", () => setMode(false))
$("modeHtml").addEventListener("click", () => setMode(true))
$("docSource").addEventListener("input", () => setDirty(true))

// ---- saving ----
let saving = false
let conflicted = false // an autosave was refused: another tab saved first
// quiet: the 30s autosave — the server's sanitized copy is NOT painted
// back into the editor (that would jump the caret and reset undo while
// you type); the next save sends the editor's own copy again anyway.
async function save({ quiet = false }: { quiet?: boolean } = {}) {
	if (!doc?.mine) return true
	if (saving) return false
	saving = true
	$("docErr").textContent = ""
	const list = allChapters()
	const editedSince = lastEditAt
	try {
		// An autosave names the copy it started from and is refused (409) when
		// another tab saved since; a deliberate Save carries no base and wins.
		const body: Record<string, unknown> = { title: input("docTitle").value, chapters: list }
		if (quiet && typeof doc.updatedAt === "number") body.baseUpdatedAt = doc.updatedAt
		const r = await api<{ doc: DocPayload }>("/api/docs/" + encodeURIComponent(docId), body, "PUT")
		conflicted = false
		banners.hide("conflictBar")
		doc = r.doc
		comments = doc.comments || []
		// the server's copy is the truth now: ids for new chapters, sanitized
		// html, counts — order is preserved, so the open index still holds
		chapters = (doc.chapters || []).map((c) => ({ ...c }))
		openIdx = Math.min(openIdx, chapters.length - 1)
		// render the server's sanitized copy so what we see is what's stored
		if (!sourceMode && !quiet) $("docEditor").innerHTML = chapters[openIdx]?.html || ""
		// a keystroke that landed while the request was out keeps it dirty
		if (lastEditAt === editedSince) setDirty(false)
		clearDraft(docId)
		socket?.emit("doc-saved", { auth: getToken(), id: docId })
		renderComments()
		updateWords()
		renderChapters()
		return true
	} catch (e) {
		// A conflict stops the autosave (the message would otherwise repaint
		// every 30s over whatever you typed); Save still goes through.
		if (e instanceof ApiError && e.status === 409) {
			conflicted = true
			banners.show("conflictBar")
			return false
		}
		$("docErr").textContent = (e as Error).message
		return false
	} finally {
		saving = false
	}
}
$("saveBtn").addEventListener("click", () => save())
document.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
		e.preventDefault()
		save()
	}
})

// ---- find & replace ----
// One bar for both views: text nodes in Rich text, the raw string in HTML.
// A replace is an edit like any other — dirty, and its own undo step.
const findBar = (finder = mountFindReplace({
	editor: $("docEditor"),
	source: textarea("docSource"),
	bar: $("findBar"),
	isSource: () => sourceMode,
	canReplace: () => canEditDoc() && !commentMode,
	onEdit: () => (sourceMode ? setDirty(true) : onEdit({ immediate: true })),
	reveal: (range) => {
		const rect = range.getBoundingClientRect()
		window.scrollTo({
			top: scrollTargetFor({
				rectTop: rect.top,
				rectH: rect.height,
				scrollY: window.scrollY,
				viewportH: window.innerHeight,
				headH: stickyH(),
				maxScroll: document.documentElement.scrollHeight - window.innerHeight,
			}),
		})
	},
}))
const toggleFind = (on = !findBar.isOpen()) => {
	if (on) findBar.open()
	else findBar.close()
	$("findBtn").setAttribute("aria-expanded", String(findBar.isOpen()))
}
$("findBtn").addEventListener("click", () => toggleFind())
$("findBar").addEventListener("click", () => $("findBtn").setAttribute("aria-expanded", String(findBar.isOpen())))
document.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") {
		e.preventDefault()
		toggleFind(true)
	}
	// Escape closes the bar from anywhere on the page, not only from its own
	// boxes — you are usually back in the prose by the time you want it gone.
	else if (e.key === "Escape" && findBar.isOpen() && !e.defaultPrevented) toggleFind(false)
})
// the words moved under an open bar: typing, a chapter switch, a mode switch
$("docEditor").addEventListener("input", () => findBar.refresh())
$("docSource").addEventListener("input", () => findBar.refresh())

// Autosave: every AUTOSAVE_MS a dirty document goes to the server, but only
// after AUTOSAVE_IDLE_MS without a keystroke — a save mid-sentence would
// credit and broadcast half a word. While you keep typing, the local
// crash-cache is written instead so a closed tab still loses nothing.
const AUTOSAVE_MS = 30000
const AUTOSAVE_IDLE_MS = 3000
setInterval(() => {
	if (!dirty || !doc?.mine || conflicted) return
	if (Date.now() - lastEditAt >= AUTOSAVE_IDLE_MS) save({ quiet: true })
	else saveDraft(docId, allChapters(), input("docTitle").value)
}, AUTOSAVE_MS)

// The banners under the toolbar: unsaved work from a previous session, and an
// autosave refused because another tab saved first. Both are decisions, so
// each offers exactly two; showing or hiding one remeasures the sticky shell.
const banners = mountDocBanners($("docBanners"), { onChange: measureSticky })
banners.add({
	id: "restoreBar",
	html: "You have unsaved changes from a previous session.",
	actions: [
		{
			id: "restoreYes",
			label: "Restore them",
			primary: true,
			onClick: () => {
				const d = loadDraft(docId)
				if (d) {
					// a draft chapter with no id (never saved, or a pre-chapter draft)
					// takes the stored chapter's id at the same position, if any
					chapters = d.chapters.map((c, i) => ({
						id: c.id ?? doc?.chapters?.[i]?.id ?? null,
						title: c.title || doc?.chapters?.[i]?.title || `Chapter ${i + 1}`,
						html: c.html,
					}))
					openIdx = Math.min(openIdx, chapters.length - 1)
					if (sourceMode) setMode(false)
					$("docEditor").innerHTML = chapters[openIdx]?.html ?? ""
					if (d.title) input("docTitle").value = d.title
					undoHistory.reset()
					setDirty(true)
					renderComments()
					updateWords()
					renderChapters()
				}
				banners.hide("restoreBar")
			},
		},
		{
			id: "restoreNo",
			label: "Discard",
			onClick: () => {
				clearDraft(docId)
				banners.hide("restoreBar")
			},
		},
	],
})
banners.add({
	id: "conflictBar",
	kind: "warn",
	html: "<b>This story was changed in another tab.</b> Autosave is paused here so nothing is lost.",
	actions: [
		{
			id: "conflictReload",
			label: "Reload to see it",
			primary: true,
			onClick: () => {
				dirty = false // the writer chose the other tab's copy; don't ask again on the way out
				location.reload()
			},
		},
		{ id: "conflictSave", label: "Save & overwrite", onClick: () => save() },
	],
})

// ---- sprints ----
// A sprint is a stopwatch over the word count: start words are
// remembered, and stopping (the button, or leaving the page any way at
// all) logs `now - start` against this document. The server does the
// bookkeeping; the chip just shows the elapsed time and the delta.
const countNow = () => {
	const text = sourceMode ? srcHtml().replace(/<[^>]+>/g, " ") : $("docEditor").innerText || ""
	return text.trim() ? text.trim().split(/\s+/).length : 0
}
let sprint: { startWords: number; startedAt: number; tick: ReturnType<typeof setInterval> } | null = null
const fmtClock = (ms: number) => {
	const s = Math.max(0, Math.floor(ms / 1000))
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
function paintSprint() {
	const b = $("sprintBtn")
	const live = $("sprintLive")
	live.classList.toggle("hidden", !sprint)
	b.setAttribute("aria-pressed", String(!!sprint))
	if (!sprint) {
		b.textContent = "⏱ Start a sprint"
		return
	}
	const delta = countNow() - sprint.startWords
	b.textContent = "⏹ Stop the sprint"
	live.textContent = `⏹ ${fmtClock(Date.now() - sprint.startedAt)} · ${delta >= 0 ? "+" : ""}${delta}`
}
function startSprint() {
	sprint = { startWords: countNow(), startedAt: Date.now(), tick: setInterval(paintSprint, 500) }
	paintSprint()
}
// Stop and log. `leaving` uses a keepalive fetch so the request survives
// the page going away (api() is a plain fetch that a navigation cancels).
function stopSprint({ leaving = false }: { leaving?: boolean } = {}) {
	if (!sprint) return
	const words = Math.max(0, countNow() - sprint.startWords)
	const seconds = Math.round((Date.now() - sprint.startedAt) / 1000)
	clearInterval(sprint.tick)
	sprint = null
	paintSprint()
	const body = JSON.stringify({ words, seconds })
	const req = fetch("/api/docs/" + encodeURIComponent(docId) + "/sprint", {
		method: "POST",
		keepalive: true,
		headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
		body,
	})
	if (leaving) return
	req
		.then((r) => r.json())
		.then((d: { doc?: { sprintWords?: number; sprints?: Sprint[] } } | null) => {
			if (d?.doc && doc) doc = { ...doc, sprintWords: d.doc.sprintWords, sprints: d.doc.sprints }
			$("saveState").textContent = `Sprint logged: ${words} word${words === 1 ? "" : "s"} in ${fmtClock(seconds * 1000)}`
		})
		.catch(() => {})
}
$("sprintBtn").addEventListener("click", () => (sprint ? stopSprint() : startSprint()))
$("sprintLive").addEventListener("click", () => stopSprint())
// pagehide fires on every way out (close, reload, back, in-app links)
window.addEventListener("pagehide", () => stopSprint({ leaving: true }))

// ---- leaving while dirty ----
// beforeunload covers reloads/closes; the styled modal covers in-app links.
window.addEventListener("beforeunload", (e) => {
	if (!dirty) return
	saveDraft(docId, allChapters(), input("docTitle").value)
	e.preventDefault()
	e.returnValue = ""
})

let leaveTo: string | null = null
document.addEventListener(
	"click",
	(e) => {
		const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]")
		if (!a || !dirty) return
		const url = new URL(a.href, location.href)
		if (url.origin !== location.origin || url.pathname === location.pathname) return
		e.preventDefault()
		leaveTo = a.href
		$("leaveModal").classList.remove("hidden")
	},
	true,
)
$("leaveCancel").addEventListener("click", () => {
	$("leaveModal").classList.add("hidden")
	leaveTo = null
})
$("leaveAnyway").addEventListener("click", () => {
	saveDraft(docId, allChapters(), input("docTitle").value)
	dirty = false
	location.href = leaveTo || "/writes"
})
$("leaveSave").addEventListener("click", async () => {
	if (await save()) location.href = leaveTo || "/writes"
})

// ---- who can see this ----
// The chip states the current level; the menu offers all three with
// their consequences. Narrowing is instant (the safe direction);
// widening to public is the only step that asks first.
function renderVis() {
	if (!doc) return
	if (!doc.mine) return ($("visWrap").innerHTML = `<span class="doc-pill on">📖 Reading</span>`)
	$("visWrap").innerHTML = visChipHtml(doc.visibility)
	$("visOpts").innerHTML = visOptionsHtml(doc.visibility)
	paintReaderCount()
}
const paintReaderCount = () => ($("readerCount").textContent = `${doc?.readerRows?.length || 0} invited`)
$("visOpts").addEventListener("click", (e) => {
	const opt = (e.target as HTMLElement).closest<HTMLElement>(".vis-opt")
	if (opt) setVisibility(opt.dataset.vis || "")
})

// ---- the head's three menus: Share, Document, Appearance ----
// One open at a time. A pick in Share or Document closes it; Appearance
// stays open while you try faces and spacing. Outside click and Escape
// close whatever is open. The Share chip is re-rendered with the
// visibility, so its click is delegated from the wrap.
const HEAD_MENUS: [wrap: string, btn: string, menu: string][] = [
	["visWrap", "visChip", "visMenu"],
	["docMenuWrap", "docMenuBtn", "docMenu"],
	["docViewPrefs", "viewBtn", "viewMenu"],
]
function setHeadMenu(which: string | null) {
	for (const [, btn, menu] of HEAD_MENUS) {
		const open = menu === which
		$(menu).classList.toggle("open", open)
		document.getElementById(btn)?.setAttribute("aria-expanded", String(open))
	}
}
const closeVis = () => setHeadMenu(null)
for (const [wrap, btn, menu] of HEAD_MENUS) {
	$(wrap).addEventListener("click", (e) => {
		if (!(e.target as HTMLElement).closest("#" + btn)) return
		e.stopPropagation()
		setHeadMenu($(menu).classList.contains("open") ? null : menu)
	})
}
document.addEventListener("click", (e) => {
	if (!(e.target as HTMLElement).closest("#viewMenu")) closeVis()
})
document.addEventListener("keydown", (e) => e.key === "Escape" && closeVis())

async function setVisibility(next: string) {
	if (!doc || !next || next === doc.visibility) return
	// Only widening to public needs a word first — and it states the
	// consequence rather than asking "are you sure".
	if (next === "public") {
		const readers = doc.readerRows?.length || 0
		const line =
			`Anyone with an account will be able to read “${doc.title || "Untitled"}”.` +
			(readers
				? `\n\nYour ${readers} beta reader${readers === 1 ? "" : "s"} keep${readers === 1 ? "s" : ""} their comments: nobody else can comment.`
				: "") +
			`\n\nYou can make it private again at any time.`
		if (!window.confirm(line)) return
	}
	try {
		doc = (await api<{ doc: DocPayload }>(`/api/docs/${encodeURIComponent(docId)}/visibility`, { visibility: next })).doc
		renderVis()
		renderShare()
		// going private boots whoever was reading — say so rather than
		// letting a beta reader vanish mid-sentence unexplained
		if (next === "private" && (doc.readerRows?.length || 0))
			setStatus(`Now private: your beta readers were closed out.`)
		else setStatus(`Now ${visOf(next).label.toLowerCase()}.`)
	} catch (e) {
		$("docErr").textContent = (e as Error).message
	}
}

// ---- beta readers ----
// The directory is fetched when the modal is first opened and kept for
// the session: it is a list of names, and refetching it on every
// keystroke would make the search feel slower than typing.
let directory: DirectoryRow[] | null = null
let myFriends: { username: string }[] = []
async function loadDirectory() {
	if (directory) return
	try {
		directory = (await api<{ users?: DirectoryRow[] }>("/api/users", null, "GET")).users || []
		myFriends = (await api<{ friends?: { username: string }[] }>("/api/friends", null, "GET")).friends || []
	} catch (e) {
		directory = directory || []
	}
	renderPicker()
}
function renderPicker() {
	if (!doc?.mine) return
	const rows = inviteOptions({
		users: directory || [],
		friends: myFriends,
		readers: doc.readerRows || [],
		me: me?.username || "",
		q: input("readerName").value,
	})
	$("readerList").innerHTML = directory
		? inviteListHtml(rows)
		: `<p class="subtle pick-empty">Loading writers…</p>`
}
async function invite(username: string) {
	$("shareErr").textContent = ""
	try {
		doc = (await api<{ doc: DocPayload }>(`/api/docs/${encodeURIComponent(docId)}/readers`, { username })).doc
		input("readerName").value = ""
		renderShare()
		setStatus(`${username} can read along now.`)
	} catch (e) {
		$("shareErr").textContent = (e as Error).message
	}
}
function renderShare() {
	paintReaderCount()
	if (!doc) return
	$("sharePrivateNote").classList.toggle("hidden", doc.visibility !== "private")
	$("readerChips").innerHTML = readerChipsHtml(doc.readerRows, !!doc.mine)
	renderPicker()
}
$("readerName").addEventListener("input", renderPicker)
// Enter takes the first invitable name — the common case is that you
// typed enough of it to leave exactly one.
$("readerName").addEventListener("keydown", (e) => {
	if (e.key !== "Enter") return
	e.preventDefault()
	$("readerList").querySelector<HTMLButtonElement>("button.pick-row:not([disabled])")?.click()
})
$("readerList").addEventListener("click", async (e) => {
	// a non-friend's row carries Add friend instead of being pickable:
	// send the request from here and the row reads "requested"
	const t = e.target as HTMLElement
	const add = t.closest<HTMLButtonElement>(".add-friend")
	if (add) {
		e.preventDefault()
		const username = add.dataset.addFriend || ""
		add.disabled = true
		try {
			await api("/api/friends/request", { username })
			const u = (directory || []).find((x) => x.username === username)
			if (u) u.requested = true
			renderPicker()
		} catch (err) {
			add.disabled = false
			add.textContent = (err as Error)?.message || "Couldn't send"
		}
		return
	}
	const row = t.closest<HTMLButtonElement>("button.pick-row")
	if (row && !row.disabled) invite(row.dataset.user || "")
})
$("shareGoReaders").addEventListener("click", () => setVisibility("readers"))
$("shareBtn").addEventListener("click", () => {
	renderShare()
	$("shareErr").textContent = ""
	$("shareModal").classList.remove("hidden")
	loadDirectory()
})
$("shareClose").addEventListener("click", () => $("shareModal").classList.add("hidden"))
$("shareModal").addEventListener("click", (e) => {
	if (e.target === $("shareModal")) $("shareModal").classList.add("hidden")
})
$("readerChips").addEventListener("click", async (e) => {
	const x = (e.target as HTMLElement).closest(".reader-x")
	if (!x) return
	const name = x.closest<HTMLElement>(".reader-chip")!.dataset.user || ""
	try {
		doc = (await api<{ doc: DocPayload }>(`/api/docs/${encodeURIComponent(docId)}/readers/${encodeURIComponent(name)}`, null, "DELETE")).doc
		renderShare()
	} catch (e) {
		$("shareErr").textContent = (e as Error).message
	}
})

// ---- chapters ----
// One chapter is open at a time. Switching stashes the open one into
// the array and swaps the DOM; it never touches the server or `dirty`.
// Undo history is per DOM, so it resets on a switch — the same rule as
// "you can't undo your way back to the last document".
const commentCounts = () => {
	const n: Record<string, number> = {}
	for (const c of comments) if (!c.resolved && c.chapterId) n[c.chapterId] = (n[c.chapterId] || 0) + 1
	return n
}
function renderChapters() {
	const canEdit = canEditDoc()
	$("chapPanel").innerHTML = chapterListHtml(chapters, { openIdx, canEdit, commentCounts: commentCounts() })
	$("chapNav").innerHTML = chapNavHtml(chapters, openIdx)
	paintChapChip()
	const url = new URL(location.href)
	if (chapters.length > 1) url.searchParams.set("ch", String(openIdx + 1))
	else url.searchParams.delete("ch")
	window.history.replaceState(null, "", url)
}
// only the counts changed (a comment came or went): repaint the rows
const paintChapterCounts = () => {
	if ($("chapPanel").firstChild) renderChapters()
}
function goChapter(idx: number) {
	idx = Math.max(0, Math.min(chapters.length - 1, idx))
	if (idx === openIdx) return closeChapMenu()
	stashCurrent()
	openIdx = idx
	const ch = chapters[openIdx]
	$("docEditor").innerHTML = ch?.html || ""
	// The HTML view is filled the way setMode fills it — from the DOM, never
	// from the stored string — so it shows `'`, not the `&#39;` the server keeps.
	if (sourceMode) textarea("docSource").value = formatSource(cleanHtml($("docEditor"), { doc: true }))
	undoHistory.reset()
	pendingRange = null
	clearComposer()
	activeCid = null
	renderComments()
	updateWords()
	renderChapters()
	closeChapMenu()
	window.scrollTo({ top: 0 })
	finder?.refresh()
}
function addChapter() {
	if (!canEditDoc()) return
	stashCurrent()
	chapters.push({ id: null, title: `Chapter ${chapters.length + 1}`, html: "" })
	setDirty(true)
	goChapter(chapters.length - 1)
	if (!sourceMode) $("docEditor").focus()
}
function moveChapter(i: number, dir: number) {
	const j = i + dir
	if (!canEditDoc() || j < 0 || j >= chapters.length) return
	stashCurrent()
	;[chapters[i], chapters[j]] = [chapters[j]!, chapters[i]!]
	if (openIdx === i) openIdx = j
	else if (openIdx === j) openIdx = i
	setDirty(true)
	renderChapters()
}
function deleteChapter(i: number) {
	if (!canEditDoc() || chapters.length < 2) return
	stashCurrent()
	chapters.splice(i, 1)
	setDirty(true)
	if (openIdx === i) {
		// open the neighbour: the DOM still shows the deleted chapter
		openIdx = -1
		goChapter(Math.min(i, chapters.length - 1))
	} else {
		if (openIdx > i) openIdx--
		renderChapters()
	}
}
function renameChapter(i: number) {
	if (!canEditDoc()) return
	const row = $("chapPanel").querySelector(`.chap-row[data-i="${i}"] .chap-title`)
	const chap = chapters[i]
	if (!row || !chap) return
	const input = document.createElement("input")
	input.className = "chap-rename-input"
	input.maxLength = 80
	input.value = chap.title || ""
	row.replaceWith(input)
	input.focus()
	input.select()
	let done = false
	const commit = (keep: boolean) => {
		if (done) return
		done = true
		const v = input.value.trim()
		if (keep && v && v !== chap.title) {
			chap.title = v
			setDirty(true)
		}
		renderChapters()
	}
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") commit(true)
		if (e.key === "Escape") commit(false)
		e.stopPropagation()
	})
	input.addEventListener("blur", () => commit(true))
}
$("chapPanel").addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	if (t.closest(".chap-close")) return closeChap()
	const b = t.closest("button")
	if (!b) return
	const i = parseInt(b.dataset.i || "", 10)
	if (b.classList.contains("chap-open")) return goChapter(i)
	if (b.classList.contains("chap-add")) return addChapter()
	if (b.classList.contains("chap-up")) return moveChapter(i, -1)
	if (b.classList.contains("chap-down")) return moveChapter(i, 1)
	if (b.classList.contains("chap-rename")) return renameChapter(i)
	if (b.classList.contains("chap-del")) {
		// two clicks: the first arms it, the second deletes
		if (b.dataset.armed !== "1") {
			$("chapPanel").querySelectorAll<HTMLElement>(".chap-del[data-armed]").forEach((x) => {
				delete x.dataset.armed
				x.textContent = "✕"
			})
			b.dataset.armed = "1"
			b.textContent = "Delete?"
			return
		}
		deleteChapter(i)
	}
})
$("chapPanel").addEventListener("dblclick", (e) => {
	const t = (e.target as HTMLElement).closest(".chap-title")
	if (t) renameChapter(parseInt(t.closest<HTMLElement>(".chap-row")!.dataset.i || "", 10))
})
$("chapNav").addEventListener("click", (e) => {
	const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-i]")
	if (b) goChapter(parseInt(b.dataset.i || "", 10))
})
// The panel's open state: a grid column on a desktop (remembered as
// an editor pref), a dropdown under the head row on a phone (closed
// on a pick, Escape or an outside click).
const phoneChap = () => window.matchMedia("(max-width: 860px)").matches
const chapIsOpen = () => (phoneChap() ? $("chapPanel").classList.contains("menu-open") : prefs.chapOpen !== false)
function paintChapChip() {
	// the Document chip names where you are; the menu row says whether the
	// panel is showing
	const n = chapters.length
	$("docMenuBtn").firstChild!.textContent = n > 1 ? chapChipLabel(chapters, openIdx, chapIsOpen()) : "📑 Document"
	$("chapState").textContent = chapIsOpen() ? "Shown ✓" : "Hidden"
	$("chapChip").setAttribute("aria-checked", String(chapIsOpen()))
}
function applyChap() {
	const open = chapIsOpen()
	document.querySelector(".doc-main")?.classList.toggle("chap-closed", !open)
	$("chapChip").setAttribute("aria-expanded", String(open))
	paintChapChip()
}
function closeChapMenu() {
	if (!phoneChap()) return
	$("chapPanel").classList.remove("menu-open")
	applyChap()
}
// The panel's own ✕: the dropdown folds on a phone, the column closes
// (and the pref remembers) on a desktop — the chip is the way back.
function closeChap() {
	if (phoneChap()) $("chapPanel").classList.remove("menu-open")
	else prefs = savePrefs({ ...prefs, chapOpen: false })
	applyChap()
}
$("chapChip").addEventListener("click", () => {
	if (phoneChap()) $("chapPanel").classList.toggle("menu-open")
	else prefs = savePrefs({ ...prefs, chapOpen: prefs.chapOpen === false })
	applyChap()
})
document.addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	if (phoneChap() && !t.closest("#chapPanel") && !t.closest("#chapChip")) closeChapMenu()
})
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closeChapMenu()
})
window.matchMedia("(max-width: 860px)").addEventListener("change", applyChap)
applyChap()

// ---- export ----
// The open chapter or the whole work as a styled standalone page,
// built from the editor's own copy so the author gets unsaved text too.
const download = (html: string, name: string) => {
	const blob = new Blob([exportDocument(html)], { type: "text/html" })
	const a = document.createElement("a")
	a.href = URL.createObjectURL(blob)
	a.download = name
	a.click()
	URL.revokeObjectURL(a.href)
}
$("exportChapter").addEventListener("click", () => {
	const list = allChapters()
	const d = { title: input("docTitle").value || doc?.title, chapters: list }
	download(exportChapterHtml(d, list[openIdx]!, openIdx + 1), `${slugOf(d.title)}-ch${openIdx + 1}.html`)
})
$("exportWork").addEventListener("click", () => {
	const d = { title: input("docTitle").value || doc?.title, chapters: allChapters() }
	download(exportWork(d), `${slugOf(d.title)}.html`)
})

// ---- live presence + comments ----
function connect() {
	const s: Socket<ServerToClient, ClientToServer> = io()
	socket = s
	s.on("connect", () => {
		s.emit("identify", { auth: getToken() })
		s.emit("doc-open", { auth: getToken(), id: docId })
	})
	s.on("doc-presence", ({ id, viewers }) => {
		if (id !== docId) return
		// don't show myself among the watchers
		$("presenceRow").innerHTML = presenceHtml(viewers.filter((v) => v.username !== me?.username))
	})
	s.on("doc-comments", ({ id, comments: rows }) => {
		if (id !== docId) return
		comments = rows
		// the server has spoken: nothing is "just sent" any more, so any
		// anchor it doesn't know about is fair game for the prune
		for (const cid of pendingCids) if (rows.some((c) => c.cid === cid)) pendingCids.delete(cid)
		renderComments()
	})
	s.on("doc-updated", ({ id, html, title, chapters: rows, updatedAt }) => {
		if (id !== docId || !doc) return
		// My own other tab saved. A clean tab follows it, so it is never stale;
		// a tab with unsaved typing keeps its words and lets the version check
		// on its next autosave say so.
		if (doc.mine) {
			// the stale stamp stays on a dirty tab, so its next autosave is refused
			if (dirty || saving) return
			if (typeof updatedAt === "number") doc.updatedAt = updatedAt
		}
		doc.html = html
		doc.title = title
		input("docTitle").value = title
		// keep the chapter I'm reading, by id; it may have been deleted
		const wasId = openChapter()?.id
		chapters = (Array.isArray(rows) && rows.length ? rows : [{ id: null, title: "Chapter 1", html: html || "" }]).map((c) => ({ ...c }))
		doc.chapters = chapters
		openIdx = Math.max(0, chapters.findIndex((c) => c.id === wasId))
		$("docEditor").innerHTML = chapters[openIdx]?.html || ""
		renderDoc()
		updateWords()
		renderChapters()
	})
	// The html itself changed: someone anchored a comment, or a suggestion
	// was accepted. Re-rendering moves the caret, so an author with
	// unsaved edits is told rather than interrupted — their next save
	// carries their own copy of the anchors anyway.
	// One CHAPTER's html at a time. A chapter that isn't on screen is
	// updated in the array alone (stashCurrent only ever writes the OPEN
	// one back, so the two can't clobber each other).
	s.on("doc-html", ({ id, chapterId, html, chapterWordCount }) => {
		if (id !== docId) return
		const ch = chapters.find((c) => c.id === chapterId)
		if (!ch) return
		ch.html = html
		if (typeof chapterWordCount === "number") ch.wordCount = chapterWordCount
		if (ch !== openChapter()) return renderChapters()
		if (dirty && doc?.mine) {
			// A removal (delete, reject, resolve) needs no telling — the prune
			// takes the underline when the comment list follows; only an
			// ARRIVAL is something the author can't see until they save.
			$("docErr").textContent = htmlPushKind(currentHtml(), html || "") === "added"
				? "New comments arrived: save to see them underlined in place."
				: ""
			return
		}
		$("docEditor").innerHTML = html || ""
		undoHistory.reset()
		renderDoc()
		updateWords()
		renderChapters()
	})
	s.on("doc-access-lost", ({ id }) => {
		if (id === docId) location.href = "/writes"
	})
	window.addEventListener("beforeunload", () => socket?.emit("doc-close"))
}

// ---- slash palette ----
let palette: SlashPalette | null = null
async function mountPalette() {
	try {
		const bundle = await api<RefBundle>("/api/reference", null, "GET")
		// never in HTML mode: there "/" is markup, not a command
		palette = mountSlashPalette($("docEditor"), { bundle, onInsert: () => onEdit(), isEnabled: () => !sourceMode })
	} catch (e) {
		/* the bank is a convenience — the editor works without it */
	}
}

if (me && docId) {
	await load()
	// load() assigned `doc`; the narrowing above this line doesn't know that
	if ((doc as DocPayload | null)?.mine) mountPalette()
}
