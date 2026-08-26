// Builders for /announcements. Pure strings, everything esc()'d. The
// composer and the Delete button exist ONLY when `admin` is true — a normal
// account's page has no markup for them at all (the server refuses the
// calls regardless; this is the page agreeing with it).
import { esc } from "./util.js"

const when = (ts) => (ts ? new Date(ts).toLocaleDateString([], { dateStyle: "long" }) : "")

// Blank-line-separated paragraphs; single line breaks stay as <br>.
export const bodyHtml = (body) =>
	String(body || "")
		.split(/\n{2,}/)
		.map((p) => `<p>${esc(p).replace(/\n/g, "<br />")}</p>`)
		.join("")

export function postHtml(post, { admin = false } = {}) {
	return (
		`<article class="ann-post" data-post-id="${esc(post.id)}">` +
		`<header class="ann-head"><h3>${esc(post.title)}</h3>` +
		`<span class="gc-meta">${esc(when(post.at))}${post.byName ? ` · ${esc(post.byName)}` : ""}</span>` +
		(admin ? `<button type="button" class="ghost danger ann-del" data-ann-delete="${esc(post.id)}">Delete</button>` : "") +
		`</header>` +
		`<div class="ann-body">${bodyHtml(post.body)}</div>` +
		`</article>`
	)
}

export function postListHtml(posts, { admin = false } = {}) {
	if (!posts || !posts.length) return `<p class="subtle" style="text-align:left">Nothing announced yet.</p>`
	return posts.map((p) => postHtml(p, { admin })).join("")
}

export function composerHtml() {
	return (
		`<form id="annComposer" class="ann-composer">` +
		`<label class="au-lbl" for="annTitle">Title</label>` +
		`<input id="annTitle" maxlength="120" placeholder="What's new" autocomplete="off" required />` +
		`<label class="au-lbl" for="annBody">Post</label>` +
		`<textarea id="annBody" rows="8" maxlength="5000" placeholder="Blank lines make paragraphs." required></textarea>` +
		`<div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">` +
		`<button type="submit" class="primary">Post announcement</button></div>` +
		`</form>`
	)
}
