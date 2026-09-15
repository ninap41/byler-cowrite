import { getToken } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { mountInboxPage } from "/js/inbox-page.js"
import type { Socket } from "socket.io-client"
import type { ServerToClient, ClientToServer } from "/js/shared/wire.js"
import type { ChipUser } from "/js/chrome.js"

mountChrome({ page: "inbox" })
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
// setUserChip is what puts the account in the topbar and reveals the
// admin entrance in the nav — without it this page looks signed out.
setUserChip(await requireAuth<ChipUser>("/"))

// The whole inbox as two panes: conversations, and the one you opened.
const panel = mountInboxPage({
	list: $("inboxList"),
	filters: $("inboxFilters"),
	pane: $("inboxPane"),
	bulk: $("inboxBulk"),
	unreadChip: $("inboxUnread"),
	readAllBtn: $("inboxReadAll"),
})
panel.reload()

// Presence + live nudges: a new message should land without a refresh.
const socket: Socket<ServerToClient, ClientToServer> = io()
socket.on("connect", () => socket.emit("identify", { auth: getToken() }))
socket.on("inbox", () => panel.reload())
setInterval(() => panel.reload(), 20000)
