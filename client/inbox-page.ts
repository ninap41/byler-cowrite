// /inbox — the two-pane inbox: a list of conversations on the left, the one
// you opened read in full on the right, its composer pinned at the foot.
// Everything the old rows did still happens here: opening an unread
// conversation marks all of it read, a friend request answers with
// Accept/Decline, a game invite offers Rejoin, deleting takes the whole
// conversation after the same confirm as every other delete, Mark all read
// clears the lot, and a reply lands in the thread. New on top: filters by
// kind, select boxes with bulk read/delete, and under 860px the list fills
// the screen and a conversation opens over it with a way back.
// The dashboard's preview keeps inbox-panel.js; this module is the page's.
import { api } from "/js/api.js"
import { confirmInboxDelete } from "/js/components/confirm-delete.js"
import {
	threadInbox, inboxCounts, inboxFiltersHtml, inboxListRowHtml, inboxPaneHeadHtml, inboxPaneBodyHtml,
	inboxPaneComposerHtml, paneCanReply, msgFilter,
} from "/js/dashboard-view.js"
import type { InboxPayload, InboxRow, InboxThread } from "./shared/wire.js"
import type { ConfirmInboxOpts } from "./components/confirm-delete.js"
import type { InboxMount } from "./inbox-panel.js"

export interface InboxPageOpts {
	list?: HTMLElement | null
	filters?: HTMLElement | null
	pane?: HTMLElement | null
	bulk?: HTMLElement | null
	unreadChip?: HTMLElement | null
	readAllBtn?: HTMLElement | null
	onLoad?: (inbox: InboxPayload) => void
	confirm?: (opts: ConfirmInboxOpts) => Promise<boolean>
}
export interface InboxPageMount extends InboxMount {
	open(id: string): void
	close(): void
}
interface PaneDraft {
	text: string
	start: number
	end: number
}

export function mountInboxPage({ list, filters, pane, bulk, unreadChip, readAllBtn, onLoad, confirm = confirmInboxDelete }: InboxPageOpts = {}): InboxPageMount {
	let inbox: InboxPayload = { messages: [], unread: 0 }
	if (!list || !pane) return { reload: async () => {}, open() {}, close() {}, messages: [] }
	let threads: InboxThread[] = []
	let filter = "all"
	let openId: string | null = null // the conversation in the pane
	const picked = new Set<string>() // thread ids with their box ticked
	// Drafts survive a re-render (the 20s poll, a socket nudge): keyed by
	// thread so switching conversations and coming back finds your words.
	const drafts = new Map<string, PaneDraft>()

	const act = async (fn: () => Promise<unknown>) => {
		try {
			await fn()
		} catch {}
		await reload()
	}
	const threadOf = (id: string) => threads.find((t) => t.id === id)
	const visible = () => threads.filter((t) => filter === "all" || msgFilter(t.head) === filter)

	// ---- the list ---------------------------------------------------------
	function renderFilters() {
		if (!filters) return
		filters.innerHTML = inboxFiltersHtml(inboxCounts(threads), filter)
		filters.querySelectorAll<HTMLElement>(".ib-filter").forEach((b) => {
			b.onclick = () => {
				filter = b.dataset.filter ?? "all"
				renderFilters()
				renderList()
			}
		})
	}
	function renderList() {
		const rows = visible()
		list!.innerHTML = ""
		if (!rows.length) {
			list!.innerHTML = `<p class="subtle ib-empty">${threads.length ? "Nothing under this filter." : "Nothing here: inbox zero. ✨"}</p>`
			renderBulk()
			return
		}
		rows.forEach((t) => {
			const row = document.createElement("div")
			row.className = "ib-item" + (t.unread ? " unread" : "") + (t.id === openId ? " open" : "")
			row.dataset.thread = t.id
			row.setAttribute("role", "button")
			row.tabIndex = 0
			row.innerHTML = inboxListRowHtml(t, { selected: t.id === openId, checked: picked.has(t.id) })
			row.onclick = () => openThread(t.id)
			row.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					openThread(t.id)
				}
			}
			const pick = row.querySelector<HTMLElement>(".ib-pick")!
			pick.onclick = (e) => e.stopPropagation() // ticking is not opening
			pick.querySelector("input")!.onchange = (e) => {
				if ((e.target as HTMLInputElement).checked) picked.add(t.id)
				else picked.delete(t.id)
				renderBulk()
			}
			list!.appendChild(row)
		})
		renderBulk()
	}
	// The bulk bar shows only while something is ticked: mark read / delete
	// the selection, or clear it.
	function renderBulk() {
		if (!bulk) return
		const ids = [...picked].filter((id) => threadOf(id))
		bulk.classList.toggle("hidden", !ids.length)
		if (!ids.length) return
		const n = ids.length
		bulk.innerHTML =
			`<span class="ib-bulk-n">${n} selected</span>` +
			`<button type="button" class="ghost" data-act="read">Mark read</button>` +
			`<button type="button" class="ghost danger" data-act="delete">Delete</button>` +
			`<button type="button" class="ghost" data-act="clear">Clear</button>`
		bulk.querySelector<HTMLButtonElement>('[data-act="read"]')!.onclick = () => {
			const msgIds = ids.flatMap((id) => threadOf(id)!.messages.filter((m) => !m.read).map((m) => m.id))
			picked.clear()
			act(() => (msgIds.length ? api("/api/inbox/read", { ids: msgIds }) : Promise.resolve()))
		}
		bulk.querySelector<HTMLButtonElement>('[data-act="delete"]')!.onclick = async () => {
			const msgIds = ids.flatMap((id) => threadOf(id)!.messages.map((m) => m.id))
			if (!(await confirm({ conversation: true, count: msgIds.length }))) return
			if (openId && ids.includes(openId)) openId = null
			picked.clear()
			act(() => Promise.all(msgIds.map((id) => api("/api/inbox/" + encodeURIComponent(id), null, "DELETE"))))
		}
		bulk.querySelector<HTMLButtonElement>('[data-act="clear"]')!.onclick = () => {
			picked.clear()
			renderList()
		}
	}

	// ---- the pane ---------------------------------------------------------
	function openThread(id: string) {
		stashDraft()
		openId = id
		const t = threadOf(id)
		// opening an unread conversation reads the whole of it
		if (t?.unread) {
			const ids = t.messages.filter((x) => !x.read).map((x) => x.id)
			t.messages.forEach((x) => (x.read = true))
			t.unread = false
			inbox.unread = Math.max(0, inbox.unread - ids.length)
			api("/api/inbox/read", { ids }).catch(() => {})
		}
		renderChrome()
		renderList()
		renderPane()
		pane!.closest(".ib-shell")?.classList.add("ib-reading")
	}
	function closeThread() {
		stashDraft()
		openId = null
		renderList()
		renderPane()
		pane!.closest(".ib-shell")?.classList.remove("ib-reading")
	}
	function stashDraft() {
		const ta = pane!.querySelector<HTMLTextAreaElement>(".ib-reply-text")
		if (!ta || !openId) return
		if (ta.value) drafts.set(openId, { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd })
		else drafts.delete(openId)
	}
	function renderPane() {
		const t = openId ? threadOf(openId) : null
		if (!t) {
			openId = null
			pane!.innerHTML = `<div class="ib-pane-empty"><span class="ib-pane-glyph">📬</span><p class="subtle">Select a conversation to read it here.</p></div>`
			return
		}
		const focused = document.activeElement === pane!.querySelector(".ib-reply-text")
		pane!.innerHTML =
			`<button type="button" class="ghost ib-back" aria-label="Back to all messages">← All messages</button>` +
			`<div class="ib-pane-head">${inboxPaneHeadHtml(t)}</div>` +
			`<div class="ib-pane-body">${inboxPaneBodyHtml(t)}</div>` +
			inboxPaneComposerHtml(t)
		pane!.querySelector<HTMLButtonElement>(".ib-back")!.onclick = closeThread
		const on = (name: string, fn: () => void) => {
			const b = pane!.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)
			if (b) b.onclick = fn
		}
		on("accept", () => act(() => api("/api/friends/respond", { id: t.head.id, accept: true })))
		on("decline", () => act(() => api("/api/friends/respond", { id: t.head.id, accept: false })))
		on("rejoin", () => (location.href = "/game?code=" + encodeURIComponent(t.head.code ?? "")))
		on("delete", async () => {
			const ids = t.messages.map((x) => x.id)
			if (!(await confirm({ conversation: ids.length > 1, count: ids.length }))) return
			openId = null
			picked.delete(t.id)
			act(() => Promise.all(ids.map((id) => api("/api/inbox/" + encodeURIComponent(id), null, "DELETE"))))
		})
		const body = pane!.querySelector<HTMLElement>(".ib-pane-body")!
		body.scrollTop = body.scrollHeight // the newest message is what you came for
		if (paneCanReply(t)) wireComposer(t, focused)
	}
	function wireComposer(t: InboxThread, refocus: boolean) {
		const ta = pane!.querySelector<HTMLTextAreaElement>(".ib-reply-text")!
		const msg = pane!.querySelector<HTMLElement>(".ib-reply-msg")!
		const send = pane!.querySelector<HTMLButtonElement>(".ib-reply-send")!
		const d = drafts.get(t.id)
		if (d) {
			ta.value = d.text
			try {
				ta.setSelectionRange(d.start, d.end)
			} catch {}
		}
		if (refocus) ta.focus()
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				ta.value = ""
				drafts.delete(t.id)
				msg.textContent = ""
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.click()
		})
		send.onclick = async () => {
			const text = ta.value.trim()
			if (!text) return void (msg.textContent = "Type a reply first.")
			send.disabled = true
			msg.textContent = ""
			try {
				await api("/api/inbox/reply", { id: t.replyTo!.id, text })
				drafts.delete(t.id)
				ta.value = ""
				await reload() // the reply joins the thread; the original is read server-side
			} catch (err) {
				msg.textContent = err instanceof Error ? err.message : String(err)
				send.disabled = false
			}
		}
	}

	function renderChrome() {
		if (unreadChip) {
			unreadChip.classList.toggle("hidden", !inbox.unread)
			unreadChip.textContent = inbox.unread ? `${inbox.unread} new` : ""
		}
		if (readAllBtn) readAllBtn.classList.toggle("hidden", !inbox.unread)
	}
	function render() {
		threads = threadInbox(inbox.messages || []) as InboxThread[]
		for (const id of [...picked]) if (!threadOf(id)) picked.delete(id)
		renderChrome()
		renderFilters()
		renderList()
		renderPane()
	}
	async function reload() {
		stashDraft()
		try {
			inbox = await api<InboxPayload>("/api/inbox", null, "GET")
		} catch {
			return
		}
		render()
		onLoad?.(inbox)
	}
	if (readAllBtn) readAllBtn.onclick = () => act(() => api("/api/inbox/read", {}))
	return {
		reload,
		open: openThread,
		close: closeThread,
		get messages(): InboxRow[] {
			return inbox.messages
		},
	}
}
