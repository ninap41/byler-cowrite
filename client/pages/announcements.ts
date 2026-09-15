import { api } from "/js/api.js"
import { requireAuth } from "/js/auth-guard.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { postListHtml, composerHtml, imageRowHtml, readImages } from "/js/announcements-view.js"
import type { AnnouncementPost } from "/js/announcements-view.js"
import type { ChipUser } from "/js/chrome.js"

mountChrome({ page: "announcements" })
const me = await requireAuth<ChipUser>()
setUserChip(me)
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const textarea = (id: string): HTMLTextAreaElement => $(id) as HTMLTextAreaElement

// The composer only ever exists for an admin: the server says who
// that is (it's the same flag it enforces on the write routes).
let admin = false
async function load() {
	const d = await api<{ posts: AnnouncementPost[]; admin?: boolean }>("/api/announcements", null, "GET")
	admin = !!d.admin
	$("annList").innerHTML = postListHtml(d.posts, { admin })
	if (admin && !$("annComposer")) {
		$("annCompose").innerHTML = composerHtml()
		$("annCompose").classList.remove("hidden")
	}
}
await load()

// The markdown goes up as typed; the server renders and sanitizes
// it (lib/markdown.js + sanitizeRich) — that is the trust boundary.
document.addEventListener("click", async (e) => {
	const btn = e.target as HTMLButtonElement
	if (btn.id !== "annPost") return
	btn.disabled = true
	try {
		await api("/api/admin/announcements", { markdown: textarea("annEditor").value, images: readImages($("annComposer")) })
		textarea("annEditor").value = ""
		await load()
	} catch (err) {
		alert((err as Error).message || "That didn't post.")
	}
	btn.disabled = false
})
// Image urls: + adds a row, ✕ removes one.
document.addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	const add = t.closest("[data-ann-add]")
	if (add) {
		const rows = add.closest(".ann-imgs")!.querySelector(".ann-imgs-rows")!
		rows.insertAdjacentHTML("beforeend", imageRowHtml())
		rows.lastElementChild!.querySelector("input")!.focus()
		return
	}
	const rm = t.closest(".ann-img-rm")
	if (rm) rm.closest(".ann-img-row")!.remove()
})
// Post to Discord: the server sends the post's markdown to the admin
// channel (POST /api/admin/announcements/:id/discord, bot token + channel
// id are Replit secrets — see src/discord.js).
document.addEventListener("click", async (e) => {
	const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ann-discord]")
	if (!b) return
	b.disabled = true
	const was = b.textContent
	try {
		await api(`/api/admin/announcements/${encodeURIComponent(b.dataset.annDiscord || "")}/discord`, {})
		b.textContent = "Posted to Discord ✓"
	} catch (err) {
		b.disabled = false
		b.textContent = "✗ " + ((err as Error).message || "Discord didn't take it.")
		setTimeout(() => { b.textContent = was }, 5000)
	}
})
// Edit in place: unfold the post's own markdown, Save PUTs it and the
// list reloads with the re-rendered html; Cancel just folds it.
document.addEventListener("click", async (e) => {
	const t = e.target as HTMLElement
	const ed = t.closest<HTMLElement>("[data-ann-edit]")
	if (ed) {
		const box = document.querySelector(`[data-ann-editbox="${ed.dataset.annEdit}"]`)
		box?.classList.toggle("hidden")
		if (box && !box.classList.contains("hidden")) box.querySelector<HTMLTextAreaElement>("textarea")?.focus()
		return
	}
	const cancel = t.closest<HTMLElement>("[data-ann-cancel]")
	if (cancel) return document.querySelector(`[data-ann-editbox="${cancel.dataset.annCancel}"]`)?.classList.add("hidden")
	const save = t.closest<HTMLButtonElement>("[data-ann-save]")
	if (!save) return
	const id = save.dataset.annSave || ""
	const ta = document.querySelector<HTMLTextAreaElement>(`[data-ann-editor="${id}"]`)
	save.disabled = true
	try {
		await api(`/api/admin/announcements/${encodeURIComponent(id)}`, { markdown: ta?.value ?? "", images: readImages(document.querySelector(`[data-ann-imgs="${id}"]`) || document) }, "PUT")
		await load()
	} catch (err) {
		save.disabled = false
		alert((err as Error).message || "That didn't save.")
	}
})
document.addEventListener("click", async (e) => {
	const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ann-delete]")
	if (!b) return
	if (!window.confirm("Delete this announcement for everyone?")) return
	b.disabled = true
	try {
		await api(`/api/admin/announcements/${encodeURIComponent(b.dataset.annDelete || "")}`, null, "DELETE")
		await load()
	} catch (err) {
		b.disabled = false
		alert((err as Error).message || "That didn't work.")
	}
})
