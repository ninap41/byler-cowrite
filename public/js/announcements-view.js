// Builders for /announcements. Pure strings. A post's html is injected AS
// IS — it passed sanitizeRich() on the server when it was posted, the same
// trust boundary as a story line — while every plain field is esc()'d. The
// composer and the Delete button exist ONLY when `admin` is true: a normal
// account's page has no markup for them at all (the server refuses the
// calls regardless; this is the page agreeing with it).
import { esc } from "./util.js"

const when = (ts) => (ts ? new Date(ts).toLocaleDateString([], { dateStyle: "long" }) : "")

export function postHtml(post, { admin = false } = {}) {
	return (
		`<article class="ann-post" data-post-id="${esc(post.id)}">` +
		`<header class="ann-head"><span class="gc-meta">${esc(when(post.at))}${post.byName ? ` · ${esc(post.byName)}` : ""}</span>` +
		(post.editedAt ? `<span class="gc-meta ann-edited" title="${esc(when(post.editedAt))}">edited</span>` : "") +
		(admin ? `<span class="ann-acts"><button type="button" class="ghost ann-discord" data-ann-discord="${esc(post.id)}" title="Post this announcement's markdown to the admin Discord channel">Post to Discord</button>` +
			`<button type="button" class="ghost ann-edit" data-ann-edit="${esc(post.id)}">Edit</button>` +
			`<button type="button" class="ghost danger ann-del" data-ann-delete="${esc(post.id)}">Delete</button></span>` : "") +
		`</header>` +
		`<div class="ann-body story-line">${post.html || ""}</div>` +
		(admin ? editorHtml(post) : "") +
		`</article>`
	)
}

// The in-place editor under a post (admin markup only): the post's own
// markdown, folded until Edit unfolds it. Save PUTs it; Cancel folds it.
export function editorHtml(post) {
	return (
		`<div class="ann-editbox hidden" data-ann-editbox="${esc(post.id)}">` +
		`<textarea class="ann-editor" data-ann-editor="${esc(post.id)}" rows="10">${esc(post.markdown || "")}</textarea>` +
		`<div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">` +
		`<button type="button" class="ghost" data-ann-cancel="${esc(post.id)}">Cancel</button>` +
		`<button type="button" class="primary" data-ann-save="${esc(post.id)}">Save</button></div>` +
		`</div>`
	)
}

export function postListHtml(posts, { admin = false } = {}) {
	if (!posts || !posts.length) return `<p class="subtle" style="text-align:left">Nothing announced yet.</p>`
	return posts.map((p) => postHtml(p, { admin })).join("")
}

// A plain markdown textarea: announcements are markdown only, so the same
// text goes to Discord verbatim (the Post to Discord button on each post). A `# heading` on the first
// line becomes the post's title.
export function composerHtml() {
	return (
		`<div id="annComposer" class="ann-composer">` +
		`<textarea class="ann-editor" id="annEditor" rows="10" placeholder="# Start with a heading, it becomes the title.\n\nMarkdown: **bold**, *italic*, - lists, > quotes."></textarea>` +
		`<p class="subtle ann-hint" style="text-align:left;margin:6px 0 0">Markdown only — it renders here and posts to Discord as written.</p>` +
		`<div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">` +
		`<button type="button" class="primary" id="annPost">Post announcement</button></div>` +
		`</div>`
	)
}
