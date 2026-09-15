import { api, getToken } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { adminGamesHtml, adminUsersHtml, filterAdminUsers, adminUserCount, promptEditorHtml, promptRowHtml, readPromptEditor, PROMPT_POOLS, auWorldHtml, refEditorHtml, refCategoryHtml, refKey, readRefGroup, badgeEditorHtml, badgeRowHtml, readBadgeEditor, BADGE_POOLS } from "/js/admin-view.js"
import type { AdminGameRow, AdminUserRow, PromptDoc, RefGroupRow } from "/js/admin-view.js"
import type { ChipUser } from "/js/chrome.js"

/** What every failed api() call carries (ApiError): the route's own errors ride in `data`. */
interface ApiFailure {
	message?: string
	data?: { errors?: string[] }
}
type BadgeDoc = Record<string, unknown>

mountChrome({ page: "admin" })
const me = await requireAuth<ChipUser>("/")
setUserChip(me)
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
// The accounts list is filtered client-side from the last fetch: the
// search box re-renders from allUsers, so typing never hits the API.
let allUsers: AdminUserRow[] = []
function renderUsers() {
	const shown = filterAdminUsers(allUsers, $<HTMLInputElement>("adminUserSearch").value)
	$("adminUsers").innerHTML = adminUsersHtml(shown, Date.now())
	$("adminUserCount").textContent = adminUserCount(shown.length, allUsers.length)
}
$("adminUserSearch").addEventListener("input", renderUsers)

let promptDoc: PromptDoc | null = null // the prompt library as loaded; Save reads the editor back into it

// The page is a convenience, not the guard: every route below refuses
// non-admins on its own. This just stops a normal user staring at a
// wall of failed requests.
if (!me?.admin) {
	$("adminSub").textContent = "This page is for admins."
	$("adminGames").innerHTML = ""
	$("adminUsers").innerHTML = ""
	$("adminPrompts").innerHTML = ""
	$("adminRef").innerHTML = ""
} else {
	await refresh()
	await loadPrompts()
	await loadRef()
	await loadBadges()
}

// ---- Badge catalogue editor ----
let badgeDoc: BadgeDoc | null = null
async function loadBadges() {
	badgeDoc = await api<BadgeDoc>("/api/admin/achievements", null, "GET")
	$("adminBadges").innerHTML = badgeEditorHtml(badgeDoc)
}
$("adminBadges").addEventListener("click", async (e) => {
	const t = e.target as HTMLElement
	const del = t.closest(".be-del")
	if (del) return del.closest("tr")!.remove()
	const add = t.closest<HTMLElement>(".be-add")
	if (add) {
		const pool = BADGE_POOLS.find((p) => p.key === add.dataset.pool)!
		const body = add.closest(".be-pool")!.querySelector("tbody")!
		body.insertAdjacentHTML("beforeend", badgeRowHtml({}, pool))
		return body.querySelector<HTMLInputElement>("tr:last-child .be-name")!.focus()
	}
	const save = t.closest<HTMLButtonElement>(".be-save")
	if (!save) return
	const status = $("adminBadges").querySelector(".be-status")!
	const { data, errors } = readBadgeEditor($("adminBadges"), badgeDoc)
	if (errors.length) return (status.textContent = "⚠ " + errors.join(" · "))
	save.disabled = true
	status.textContent = "Saving…"
	try {
		const r = await api<{ data: BadgeDoc }>("/api/admin/achievements", { data }, "PUT")
		badgeDoc = r.data
		$("adminBadges").innerHTML = badgeEditorHtml(badgeDoc)
		$("adminBadges").querySelector(".be-status")!.textContent = "✓ Saved: live now."
	} catch (err) {
		const f = err as ApiFailure
		status.textContent = "⚠ " + (f.data?.errors?.join(" · ") || f.message || "That didn't save.")
		save.disabled = false
	}
})

// ---- Content backup ----
$("adminDownload").addEventListener("click", async () => {
	const msg = $("adminDownloadMsg")
	msg.textContent = "Packing…"
	try {
		const r = await fetch("/api/admin/content.zip", { headers: { Authorization: "Bearer " + getToken() } })
		if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || r.statusText)
		const name = (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "content.zip"
		const url = URL.createObjectURL(await r.blob())
		const a = Object.assign(document.createElement("a"), { href: url, download: name })
		document.body.appendChild(a); a.click(); a.remove()
		setTimeout(() => URL.revokeObjectURL(url), 5000)
		msg.textContent = "Saved " + name
	} catch (e) { msg.textContent = "Couldn't download: " + (e as Error).message }
})

// ---- SMTP check ----
$("adminSmtp").addEventListener("click", async () => {
	const msg = $("adminSmtpMsg")
	msg.textContent = "Connecting…"
	try {
		const r = await api<{ ok?: boolean; error?: string; code?: string; configured?: Record<string, unknown> }>("/api/admin/smtp", null, "GET")
		const c = r.configured || {}
		const vars = `host ${c.host ? "✓" : "✗"} · port ${c.port} · user ${c.user ? "✓" : "✗"} · pass ${c.pass ? "✓" : "✗"} · from ${c.from ? "✓" : "✗"}`
		msg.textContent = r.ok ? `✓ Connected and logged in. ${vars}` : `✗ ${r.error}${r.code ? " (" + r.code + ")" : ""} — ${vars}`
	} catch (e) { msg.textContent = "Couldn't check: " + (e as Error).message }
})

// ---- Writers' reference editor ----
async function loadRef() {
	$("adminRef").innerHTML = refEditorHtml(await api<{ groups?: RefGroupRow[] }>("/api/admin/reference", null, "GET"))
}
$("adminRef").addEventListener("click", async (e) => {
	const t = e.target as HTMLElement
	const del = t.closest(".re-del")
	if (del) return del.closest(".re-cat")!.remove()
	const group = t.closest<HTMLElement>(".re-group")
	if (!group) return
	if (t.closest(".re-add")) {
		const input = group.querySelector<HTMLInputElement>(".re-newkey")!
		const key = refKey(input.value)
		if (!key) return input.focus()
		if (group.querySelector(`.re-cat[data-key="${key}"]`)) return (group.querySelector(".re-status")!.textContent = "⚠ That category already exists.")
		group.querySelector(".re-cats")!.insertAdjacentHTML("beforeend", refCategoryHtml({ key, label: input.value.trim(), words: [] }))
		input.value = ""
		group.querySelector<HTMLTextAreaElement>(".re-cat:last-child .re-words")!.focus()
		return
	}
	const save = t.closest<HTMLButtonElement>(".re-save")
	if (!save) return
	const status = group.querySelector(".re-status")!
	const { categories, errors } = readRefGroup(group)
	if (errors.length) return (status.textContent = "⚠ " + errors.join(" · "))
	save.disabled = true
	status.textContent = "Saving…"
	try {
		await api(`/api/admin/reference/${encodeURIComponent(group.dataset.slug || "")}`, { categories }, "PUT")
		status.textContent = "✓ Saved: the palette uses it next time it opens."
	} catch (err) {
		const f = err as ApiFailure
		status.textContent = "⚠ " + (f.data?.errors?.join(" · ") || f.message || "That didn't save.")
	}
	save.disabled = false
})

// ---- Prompt library editor ----
// Built once from the server's document, read back whole on Save.
async function loadPrompts() {
	promptDoc = (await api<{ data: PromptDoc }>("/api/admin/prompts", null, "GET")).data
	$("adminPrompts").innerHTML = promptEditorHtml(promptDoc)
}
$("adminPrompts").addEventListener("click", async (e) => {
	const t = e.target as HTMLElement
	const del = t.closest(".pe-del")
	if (del) return del.closest("tr")!.remove()
	const wdel = t.closest(".au-del")
	if (wdel) return wdel.closest(".au-world")!.remove()
	const wadd = t.closest(".au-add")
	if (wadd) {
		const input = wadd.previousElementSibling as HTMLInputElement
		const label = input.value.trim()
		if (!label) return input.focus()
		wadd.closest(".pe-pool")!.querySelector(".au-list")!.insertAdjacentHTML("beforeend", auWorldHtml({ id: "", label, group: "setting-au" }, promptDoc!))
		input.value = ""
		return
	}
	const add = t.closest(".pe-add")
	if (add) {
		const pool = PROMPT_POOLS.find((p) => p.path.join(".") === add.closest<HTMLElement>(".pe-pool")!.dataset.pool)!
		add.previousElementSibling!.querySelector("tbody")!.insertAdjacentHTML("beforeend", promptRowHtml({ id: "" }, pool, promptDoc?.intermediate?.tropeGroups || {}))
		return
	}
	if (t.id !== "promptSave") return
	const status = $("promptStatus")
	const button = t as HTMLButtonElement
	button.disabled = true
	try {
		const { doc, errors } = readPromptEditor($("promptEditor"), promptDoc)
		if (errors.length) {
			status.textContent = "⚠ " + errors.join(" · ")
			return
		}
		status.textContent = "Saving…"
		await api("/api/admin/prompts", { data: doc }, "PUT")
		status.textContent = "✓ Saved: the next ballot uses it."
		promptDoc = doc
	} catch (err) {
		const f = err as ApiFailure
		status.textContent = "⚠ " + (f.data?.errors?.join(" · ") || f.message || "That didn't save.")
	} finally {
		button.disabled = false
	}
})

async function refresh() {
	const [g, u] = await Promise.all([api<{ games: AdminGameRow[] }>("/api/admin/games", null, "GET"), api<{ users?: AdminUserRow[] }>("/api/admin/users", null, "GET")])
	$("adminGames").innerHTML = adminGamesHtml(g.games)
	allUsers = u.users || []
	renderUsers()
}

// One delegated listener for both lists: the rows are rebuilt on every
// refresh, so per-row handlers would go stale.
document.addEventListener("click", async (e) => {
	const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-act]")
	if (!btn) return
	const { adminAct: act = "", adminTarget: target = "" } = btn.dataset
	const asks: Record<string, string> = {
		end: `End the game ${target}? Its writers get the reveal.`,
		"delete-game": `Delete the story ${target} for everyone, forever?`,
		"delete-user": `Remove the account ${target}? This cannot be undone.`,
		"demote-user": `Remove admin from ${target}? You can always make them an admin again by editing ADMIN_EMAILS or the account directly.`,
	}
	if (!window.confirm(asks[act] || "")) return
	btn.disabled = true
	try {
		if (act === "end") await api(`/api/admin/games/${target}/end`, {})
		if (act === "delete-game") await api(`/api/games/${target}`, null, "DELETE")
		if (act === "delete-user") await api(`/api/admin/users/${encodeURIComponent(target)}`, null, "DELETE")
		if (act === "demote-user") await api(`/api/admin/users/${encodeURIComponent(target)}/demote`, {})
		await refresh()
	} catch (err) {
		btn.disabled = false
		alert((err as Error).message || "That didn't work.")
	}
})
