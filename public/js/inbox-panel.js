// The inbox, in one place. The dashboard shows a short preview of it and
// /inbox shows the whole thing — same rows, same actions, same reply
// composer, so answering a friend request behaves identically wherever you
// happen to be standing. The page supplies the elements; this module owns
// the state, the rendering and every button.
import { api } from "/js/api.js"
import { inboxMsgHtml } from "/js/dashboard-view.js"

// A row keeps its own reply composer, so several can be open at once and
// nothing is lost when another message is answered.
const replyParts = (row) => ({
	box: row.querySelector(".ib-reply"),
	text: row.querySelector(".ib-reply-text"),
	msg: row.querySelector(".ib-reply-msg"),
	send: row.querySelector(".ib-reply-send"),
	cancel: row.querySelector(".ib-reply-cancel"),
})

export function mountInbox({ list, unreadChip, readAllBtn, moreLink, limit = 0, onLoad } = {}) {
	if (!list) return { reload: () => {} }
	let inbox = { messages: [], unread: 0 }

	const act = async (fn) => {
		try {
			await fn()
		} catch (e) {}
		reload()
	}

	function openReply(row) {
		const { box, text } = replyParts(row)
		if (!box) return
		box.classList.remove("hidden")
		text.focus()
	}
	function closeReply(row) {
		const { box, text, msg } = replyParts(row)
		if (!box) return
		box.classList.add("hidden")
		text.value = ""
		msg.textContent = ""
	}
	function wireReply(row, m) {
		const { box, text, msg, send, cancel } = replyParts(row)
		if (!box) return
		// the row itself marks-as-read on click; typing must not count
		box.addEventListener("click", (e) => e.stopPropagation())
		cancel.onclick = (e) => (e.stopPropagation(), closeReply(row))
		// Escape closes, Ctrl/Cmd+Enter sends — the usual composer keys
		text.addEventListener("keydown", (e) => {
			if (e.key === "Escape") return closeReply(row)
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.click()
		})
		send.onclick = async (e) => {
			e.stopPropagation()
			const body = text.value.trim()
			if (!body) return (msg.textContent = "Type a reply first.")
			send.disabled = true
			msg.textContent = ""
			try {
				await api("/api/inbox/reply", { id: m.id, text: body })
				closeReply(row)
				reload() // the original is marked read server-side
			} catch (err) {
				msg.textContent = err.message
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
		const all = inbox.messages || []
		// The preview shows the newest few; the link below it says how many
		// more there are rather than pretending the list is complete.
		const shown = limit ? all.slice(0, limit) : all
		if (moreLink) moreLink.textContent = all.length > shown.length ? `See all ${all.length} messages →` : "Open your inbox →"
		list.innerHTML = ""
		if (!all.length) {
			list.innerHTML = '<p class="subtle" style="text-align:left;margin:8px 0 0">Nothing here — inbox zero. ✨</p>'
			return
		}
		shown.forEach((m) => {
			const row = document.createElement("div")
			row.className = "ib-row" + (m.read ? "" : " unread")
			row.innerHTML = inboxMsgHtml(m)
			// clicking an unread message marks it read
			if (!m.read) row.addEventListener("click", () => act(() => api("/api/inbox/read", { ids: [m.id] })))
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
			} else {
				if (m.type === "game-invite" && m.code) {
					const go = document.createElement("button")
					go.className = "primary"
					go.textContent = "Rejoin"
					go.onclick = (e) => {
						e.stopPropagation()
						location.href = "/game?code=" + encodeURIComponent(m.code)
					}
					acts.append(go)
				}
				// Anything from a real person can be answered — this is how the
				// admin replies to a help question, and how the asker carries the
				// conversation on. The composer is already in the row's markup
				// (inboxMsgHtml); Reply just unfolds it.
				if (m.from) {
					const reply = document.createElement("button")
					reply.className = "ghost"
					reply.textContent = "Reply"
					reply.onclick = (e) => {
						e.stopPropagation()
						openReply(row)
					}
					acts.append(reply)
					wireReply(row, m)
				}
				const del = document.createElement("button")
				del.className = "ghost ib-del"
				del.title = "Delete"
				del.textContent = "✕"
				del.onclick = (e) => {
					e.stopPropagation()
					act(() => api("/api/inbox/" + encodeURIComponent(m.id), null, "DELETE"))
				}
				acts.append(del)
			}
			row.appendChild(acts)
			list.appendChild(row)
		})
	}

	async function reload() {
		try {
			inbox = await api("/api/inbox", null, "GET")
		} catch (e) {
			return
		}
		render()
		onLoad?.(inbox)
	}

	if (readAllBtn) readAllBtn.onclick = () => act(() => api("/api/inbox/read", {}))
	return { reload, get messages() { return inbox.messages } }
}
