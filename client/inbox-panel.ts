// The inbox, in one place. Two surfaces mount it and they are deliberately
// NOT the same:
//   /dashboard — a preview. A notice board: read it, act on it, delete it.
//                No composer, no chains; the ✕ tucks into the corner so a
//                five-row card stays a glance rather than a screen.
//   /inbox     — the whole thing, where a message is a CONVERSATION: replies
//                chain onto what they answer and the composer lives there.
// The page supplies the elements; this module owns the state, the rendering
// and every button.
import { api } from "/js/api.js"
import { confirmInboxDelete } from "/js/components/confirm-delete.js"
import { inboxMsgHtml, threadInbox } from "/js/dashboard-view.js"
import type { InboxPayload, InboxRow, InboxThread } from "./shared/wire.js"
import type { ConfirmInboxOpts } from "./components/confirm-delete.js"

// A row keeps its own reply composer, so several can be open at once and
// nothing is lost when another message is answered.
const replyParts = (row: HTMLElement) => ({
	box: row.querySelector<HTMLElement>(".ib-reply"),
	text: row.querySelector<HTMLTextAreaElement>(".ib-reply-text")!,
	msg: row.querySelector<HTMLElement>(".ib-reply-msg")!,
	send: row.querySelector<HTMLButtonElement>(".ib-reply-send")!,
})

export interface InboxPanelOpts {
	list?: HTMLElement | null
	unreadChip?: HTMLElement | null
	readAllBtn?: HTMLElement | null
	moreLink?: HTMLElement | null
	/** show only the newest N conversations (0 = all) */
	limit?: number
	/** conversations chain and compose (the page); false = the dashboard's notice board */
	replies?: boolean
	onLoad?: (inbox: InboxPayload) => void
	confirm?: (opts: ConfirmInboxOpts) => Promise<boolean>
}
export interface InboxMount {
	reload(): Promise<void>
	readonly messages: InboxRow[]
}
interface Draft {
	text: string
	focused: boolean
	open: boolean
	start: number
	end: number
}

// The delete confirmation lives in components/confirm-delete.js so it can be
// unit-tested (this module imports "/js/api.js" by absolute path, which node
// can't resolve) — and reused by any other list that deletes.
export function mountInbox({ list, unreadChip, readAllBtn, moreLink, limit = 0, replies = true, onLoad, confirm = confirmInboxDelete }: InboxPanelOpts = {}): InboxMount {
	let inbox: InboxPayload = { messages: [], unread: 0 }
	if (!list) return { reload: async () => {}, messages: [] }
	// Which conversations are open. A thread with replies starts folded — the
	// inbox should read as a list of conversations, not their transcripts —
	// but the choice survives a reload, so answering one doesn't shut it.
	const open = new Set<string>()

	const act = async (fn: () => Promise<unknown>) => {
		try {
			await fn()
		} catch {}
		reload()
	}

	function clearReply(row: HTMLElement) {
		const { box, text, msg } = replyParts(row)
		if (!box) return
		text.value = ""
		msg.textContent = ""
	}
	// `target` is the message being answered — the newest one in the thread
	// that came from the other person, so a long exchange replies to them and
	// not to my own last word.
	function wireReply(row: HTMLElement, target: InboxRow) {
		const { box, text, msg, send } = replyParts(row)
		if (!box) return
		// the row itself marks-as-read on click; typing must not count
		box.addEventListener("click", (e) => e.stopPropagation())
		// Escape clears what you were writing and folds the composer away,
		// Ctrl/Cmd+Enter sends.
		text.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				clearReply(row)
				box.classList.add("hidden")
				return
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.click()
		})
		send.onclick = async (e) => {
			e.stopPropagation()
			const body = text.value.trim()
			if (!body) return void (msg.textContent = "Type a reply first.")
			send.disabled = true
			msg.textContent = ""
			try {
				await api("/api/inbox/reply", { id: target.id, text: body })
				clearReply(row)
				box.classList.add("hidden")
				reload() // the reply joins the chain; the original is read server-side
			} catch (err) {
				msg.textContent = err instanceof Error ? err.message : String(err)
				send.disabled = false
			}
		}
	}

	function render() {
		if (unreadChip) {
			unreadChip.classList.toggle("hidden", !inbox.unread)
			unreadChip.textContent = inbox.unread ? `${inbox.unread} new` : ""
		}
		if (readAllBtn) readAllBtn.classList.toggle("hidden", !inbox.unread)
		const all = threadInbox(inbox.messages || [])
		// The preview shows the newest few; the link below it says how many
		// more there are rather than pretending the list is complete.
		const shown = limit ? all.slice(0, limit) : all
		if (moreLink) moreLink.textContent = all.length > shown.length ? `See all ${all.length} messages →` : "Open your inbox →"
		// A poll must never eat what someone is typing: remember every OPEN
		// composer (the box unfolded — even empty, even unfocused — plus its
		// draft text, caret and focus) by thread and put it all back after.
		// Remembering only the text put the words back into a box the
		// re-render had folded shut again, so the composer "collapsed" on
		// every poll.
		const drafts = new Map<string, Draft>()
		for (const row of list!.querySelectorAll<HTMLElement>(".ib-row[data-thread]")) {
			const { box, text: ta } = replyParts(row)
			if (!ta) continue
			const focused = document.activeElement === ta
			const isOpen = !!box && !box.classList.contains("hidden")
			if (isOpen || ta.value || focused)
				drafts.set(row.dataset.thread!, { text: ta.value, focused, open: isOpen, start: ta.selectionStart, end: ta.selectionEnd })
		}
		list!.innerHTML = ""
		if (!all.length) {
			list!.innerHTML = '<p class="subtle" style="text-align:left;margin:8px 0 0">Nothing here: inbox zero. ✨</p>'
			return
		}
		shown.forEach((t) => {
			const m = t.head
			const row = document.createElement("div")
			row.className = "ib-row" + (t.unread ? " unread" : "") + (replies ? "" : " ib-compact")
			row.dataset.thread = m.threadId || m.id
			// The preview never chains and never composes — it is a notice board.
			const folds = replies && t.messages.length > 1
			const shownOpen = !folds || open.has(t.id)
			if (folds && !shownOpen) row.classList.add("ib-collapsed")
			row.innerHTML = inboxMsgHtml(m, {
				fold: folds,
				// a friend request is answered with Accept/Decline, not words
				reply: replies && !!t.replyTo && m.type !== "friend-request",
				chain: replies ? t.messages.slice(1) : [],
				replyTo: t.replyTo, // the composer answers whoever spoke last
			})
			const canReply = replies && !!t.replyTo && m.type !== "friend-request"
			if (canReply) wireReply(row, t.replyTo!)
			const fold = row.querySelector<HTMLElement>(".ib-fold")
			if (fold) {
				const paint = () => {
					const isOpen = !row.classList.contains("ib-collapsed")
					const n = t.messages.length - 1
					fold.setAttribute("aria-expanded", String(isOpen))
					fold.querySelector(".ib-fold-label")!.textContent = `${isOpen ? "Hide" : "Show"} ${n} ${n === 1 ? "reply" : "replies"}`
				}
				paint()
				fold.onclick = (e) => {
					e.stopPropagation() // folding is not reading
					const nowOpen = row.classList.toggle("ib-collapsed") === false
					if (nowOpen) open.add(t.id)
					else open.delete(t.id)
					paint()
				}
			}
			// clicking an unread conversation marks the whole of it read
			if (t.unread) {
				const ids = t.messages.filter((x) => !x.read).map((x) => x.id)
				row.addEventListener("click", () => act(() => api("/api/inbox/read", { ids })))
			}
			const acts = document.createElement("span")
			acts.className = "ib-acts"
			if (m.type === "friend-request") {
				const yes = document.createElement("button")
				yes.className = "primary"
				yes.textContent = "Accept"
				yes.onclick = (e) => {
					e.stopPropagation()
					act(() => api("/api/friends/respond", { id: m.id, accept: true }))
				}
				const no = document.createElement("button")
				no.className = "ghost"
				no.textContent = "Decline"
				no.onclick = (e) => {
					e.stopPropagation()
					act(() => api("/api/friends/respond", { id: m.id, accept: false }))
				}
				acts.append(yes, no)
				acts.classList.add("ib-answer")
				row.querySelector(".ib-info")?.appendChild(acts) // under the message, not beside it
			} else {
				if (m.type === "game-invite" && m.code) {
					const go = document.createElement("button")
					go.className = "primary"
					go.textContent = "Rejoin"
					go.onclick = (e) => {
						e.stopPropagation()
						location.href = "/game?code=" + encodeURIComponent(m.code!)
					}
					acts.append(go)
				}
				// Reply unfolds the composer at the foot of the conversation; it
				// stays folded until asked for, so a list of messages reads as a
				// list and not as a wall of empty boxes.
				if (canReply) {
					const rep = document.createElement("button")
					rep.className = "ghost ib-reply-btn"
					rep.textContent = "Reply"
					rep.onclick = (e) => {
						e.stopPropagation()
						const { box, text } = replyParts(row)
						if (!box) return
						box.classList.toggle("hidden")
						if (!box.classList.contains("hidden")) {
							row.classList.remove("ib-collapsed")
							text.focus()
						}
					}
					acts.append(rep)
				}
				const del = document.createElement("button")
				del.className = "ghost ib-del"
				del.title = replies && t.messages.length > 1 ? "Delete conversation" : "Delete"
				del.textContent = "✕"
				del.onclick = async (e) => {
					e.stopPropagation()
					// a conversation goes as a whole — leaving half of it behind
					// would read as a message that answers nothing — and it goes
					// only once you've said so (same confirm as every other delete)
					const ids = t.messages.map((x) => x.id)
					if (!(await confirm({ conversation: ids.length > 1, count: ids.length }))) return
					act(() => Promise.all(ids.map((id) => api("/api/inbox/" + encodeURIComponent(id), null, "DELETE"))))
				}
				acts.append(del)
			}
			row.appendChild(acts)
			list!.appendChild(row)
			const d = drafts.get(row.dataset.thread!)
			const ta = d ? row.querySelector<HTMLTextAreaElement>(".ib-reply-text") : null
			if (d && ta) {
				ta.value = d.text
				if (d.open || d.text || d.focused) {
					replyParts(row).box?.classList.remove("hidden")
					row.classList.remove("ib-collapsed")
				}
				if (d.focused) {
					ta.focus()
					try {
						ta.setSelectionRange(d.start, d.end)
					} catch {}
				}
			}
		})
	}

	async function reload() {
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
		get messages() {
			return inbox.messages
		},
	}
}
