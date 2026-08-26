// Builders for /announcements. Pure strings. A post's html is injected AS
// IS — it passed sanitizeRich() on the server when it was posted, the same
// trust boundary as a story line — while every plain field is esc()'d. The
// composer and the Delete button exist ONLY when `admin` is true: a normal
// account's page has no markup for them at all (the server refuses the
// calls regardless; this is the page agreeing with it).
import { esc } from "./util.js"
import { toolbarHtml } from "./components/rich-toolbar.js"

const when = (ts) => (ts ? new Date(ts).toLocaleDateString([], { dateStyle: "long" }) : "")

export function postHtml(post, { admin = false } = {}) {
	return (
		`<article class="ann-post" data-post-id="${esc(post.id)}">` +
		`<header class="ann-head"><span class="gc-meta">${esc(when(post.at))}${post.byName ? ` · ${esc(post.byName)}` : ""}</span>` +
		(admin ? `<button type="button" class="ghost danger ann-del" data-ann-delete="${esc(post.id)}">Delete</button>` : "") +
		`</header>` +
		`<div class="ann-body story-line">${post.html || ""}</div>` +
		`</article>`
	)
}

export function postListHtml(posts, { admin = false } = {}) {
	if (!posts || !posts.length) return `<p class="subtle" style="text-align:left">Nothing announced yet.</p>`
	return posts.map((p) => postHtml(p, { admin })).join("")
}

// The shared WYSIWYG: the toolbar the game and the solo editor use, over a
// contenteditable. The first heading becomes the post's title.
export function composerHtml() {
	return (
		`<div id="annComposer" class="ann-composer">` +
		`<div class="toolbar" id="annToolbar">${toolbarHtml("ann")}</div>` +
		`<div class="editor ann-editor" id="annEditor" contenteditable="true" data-placeholder="Start with a heading, it becomes the title."></div>` +
		`<div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">` +
		`<button type="button" class="primary" id="annPost">Post announcement</button></div>` +
		`</div>`
	)
}
