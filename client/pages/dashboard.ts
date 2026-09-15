import { api, setToken, getToken } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { safeColor } from "/js/util.js"
import {
	liveGameInfoHtml,
	badgeProgress,
	myGameCardHtml,
	myGameStatus,
	recentRowHtml,
	achievementsHtml,
	streakRingHtml,
	writerRowHtml,
	friendRowHtml,
	friendStatsTip,
	latestAnnouncementHtml,
	announcementRowHtml,
} from "/js/dashboard-view.js"
import { avatarHtml } from "/js/profile-view.js"
import { showInviteToast } from "/js/turn-alert.js"
import { soloListHtml, betaReadingHtml, wireSoloDeletes } from "/js/write-view.js"
import { confirmDialog } from "/js/components/confirm-delete.js"
import { mountTendrilBorder } from "/js/components/tendril-border.js"
import type { Socket } from "socket.io-client"
import type { ServerToClient, ClientToServer } from "/js/shared/wire.js"
import type { ChipUser } from "/js/chrome.js"
import type { MeStats, MyGame, LiveGame, RecentGame, WriterRow, FriendRow, PostGlimpse } from "/js/dashboard-view.js"
import type { DocSummary } from "/js/write-view.js"

/** The signed-in account as /api/me ships it, plus the stats /api/dashboard refreshes every poll. */
interface Me extends ChipUser, MeStats {
	admin?: boolean
	streak: number
	bestStreak: number
	lastLine?: { text?: string; name?: string; code?: string } | null
}
/** A game card on my dashboard: the archive card plus what myGamesFor() adds. */
interface DashGame extends MyGame {
	hosted?: boolean
	live?: boolean
}
interface DashRecent extends RecentGame {
	hosted?: boolean
}
interface DashboardPayload {
	stats: Partial<Me>
	myGames: DashGame[]
	recentGames: DashRecent[]
	liveGames: LiveGame[]
}
/** A post as /api/announcements lists it — the glimpse the rows and the card read. */
type DashPost = PostGlimpse

mountChrome({ page: "dashboard" })
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
let me = await requireAuth<Me>("/")

// Presence: a bare socket that identifies this account as online.
const socket: Socket<ServerToClient, ClientToServer> = io()
socket.on("connect", () => socket.emit("identify", { auth: getToken() }))
// A story I contributed to is being continued — toast + fresh inbox.
socket.on("game-invite", (inv) => {
	if (inv?.code) showInviteToast(inv)
	loadInbox()
})
// ---- Tabs: Dashboard (mine) | Community (everyone) ----
// The announcement's border is drawn when the panel first shows, since
// a hidden card measures 0 and the entrance would draw on nothing.
let annPost: DashPost | null = null
let annDrawn = false
// New announcements light a dot on the Community tab: posts newer than
// the newest one this browser has seen (cowriteAnnSeen); opening the
// tab sees them all.
let annPosts: DashPost[] = []
const annSeenAt = () => {
	try {
		return Number(localStorage.getItem("cowriteAnnSeen")) || 0
	} catch (e) {
		return 0
	}
}
function paintAnnouncementDot() {
	const unseen = annPosts.filter((p) => new Date(p.at ?? NaN).getTime() > annSeenAt()).length
	const open = !$("tabCommunity").classList.contains("hidden")
	const dot = $("tabCommunityDot")
	dot.classList.toggle("hidden", !unseen || open)
	dot.textContent = unseen > 9 ? "9+" : unseen ? String(unseen) : ""
}
function markAnnouncementsSeen() {
	const newest = annPosts[0]
	if (!newest) return
	try {
		localStorage.setItem("cowriteAnnSeen", String(new Date(newest.at ?? NaN).getTime()))
	} catch (e) {}
	paintAnnouncementDot()
}
function drawAnnouncement() {
	if (annDrawn || !annPost) return
	annDrawn = true
	const card = $("annCard")
	mountTendrilBorder(card, { horn: card.querySelector(".ann-horn") })
}
function showTab(name: string) {
	const tab = name === "community" ? "community" : "dashboard"
	document.querySelectorAll<HTMLElement>("#dashTabs .dash-tab-btn").forEach((b) => {
		const on = b.dataset.tab === tab
		b.classList.toggle("on", on)
		b.setAttribute("aria-selected", String(on))
	})
	$("tabDashboard").classList.toggle("hidden", tab !== "dashboard")
	$("tabCommunity").classList.toggle("hidden", tab !== "community")
	if (tab === "community") {
		drawAnnouncement()
		markAnnouncementsSeen()
	}
	try {
		localStorage.setItem("cowriteDashTab", tab)
	} catch (e) {}
}
$("dashTabs").addEventListener("click", (e) => {
	const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")
	if (b) showTab(b.dataset.tab || "")
})
let savedTab = "dashboard"
try {
	savedTab = localStorage.getItem("cowriteDashTab") || "dashboard"
} catch (e) {}
showTab(savedTab)
loadAnnouncement()

function renderMe() {
	if (!me) return
	setUserChip(me)
	$("meName").textContent = me.username
	$("meName").style.color = safeColor(me.color)
	$("meBadge").textContent = me.currentBadge || "no badge yet"
	$("avatar").innerHTML = avatarHtml(me)
	$("avatar").style.background = safeColor(me.color)
	$("statWords").textContent = me.wordCount.toLocaleString()
	$("statBadges").textContent = String(me.badges.length)
	const prog = badgeProgress(me)
	$("rankLabel").textContent = me.currentBadge ? `${me.currentBadge} · ${prog.label}` : prog.label
	$("rankFill").style.width = prog.pct + "%"
	$("achStrip").innerHTML = achievementsHtml(me)
	typeLastLine()
	$("streakBox").innerHTML =
		streakRingHtml(me.streak, Math.max(me.bestStreak, 1)) +
		`<div class="streak-meta"><b>${me.streak} day${me.streak === 1 ? "" : "s"}</b> current streak<br>Best: ${me.bestStreak} day${me.bestStreak === 1 ? "" : "s"}</div>`
}

// Your newest committed story line, typed out once per visit (renderMe
// runs on every 10s poll; the guard keeps the animation from restarting).
let lastLineTyped = false
function typeLastLine() {
	if (lastLineTyped || !me?.lastLine?.text) return
	lastLineTyped = true
	$("lastLineBox").classList.remove("hidden")
	$("lastLineMeta").textContent = `, your last line, from “${me.lastLine.name || me.lastLine.code}”`
	const full = `“${me.lastLine.text}”`
	const el = $("lastLineText")
	const caretDone = () => document.querySelector("#lastLineBox .type-caret")?.classList.add("done")
	// hidden tabs throttle rAF, which would freeze the tween at zero
	if (window.gsap && !reduceMotion && document.visibilityState === "visible") {
		const state = { n: 0 }
		gsap.to(state, {
			n: full.length,
			duration: Math.min(4, 0.8 + full.length * 0.035),
			ease: "none",
			delay: 0.5,
			onUpdate: () => (el.textContent = full.slice(0, Math.round(state.n))),
			onComplete: caretDone,
		})
	} else {
		el.textContent = full
		caretDone()
	}
}

// Random quote from quotes.json on every visit, decoding in with a
// GSAP scramble (hand-rolled — the club ScrambleText plugin is paid).
function scrambleIn(el: HTMLElement, text: string) {
	if (!window.gsap || reduceMotion) return (el.textContent = text)
	const CHARS = "!<>-_\\/[]{}: =+*^?#"
	const state = { p: 0 }
	gsap.to(state, {
		p: 1,
		duration: Math.min(2.2, 0.6 + text.length * 0.02),
		ease: "power1.out",
		onUpdate() {
			const reveal = Math.floor(state.p * text.length)
			let out = text.slice(0, reveal)
			for (let i = reveal; i < text.length; i++)
				out += text[i] === " " ? " " : CHARS[(Math.random() * CHARS.length) | 0]
			el.textContent = out
		},
		onComplete: () => (el.textContent = text),
	})
}
// Cycle the whole quote bank in shuffled order, one every 4s, each
// decoding in with the scramble. Reshuffles every full pass (never
// repeating the same quote back-to-back); paused in hidden tabs.
api<{ quotes?: string[] }>("/api/quotes", null, "GET")
	.then(({ quotes }) => {
		if (!quotes?.length) return
		let order: string[] = []
		let i = 0
		const next = () => {
			if (i >= order.length) {
				const last = order[order.length - 1]
				do order = [...quotes].sort(() => Math.random() - 0.5)
				while (quotes.length > 1 && order[0] === last)
				i = 0
			}
			scrambleIn($("quoteText"), order[i++]!)
		}
		next()
		if (quotes.length > 1)
			setInterval(() => {
				if (document.visibilityState === "visible") next()
			}, 4500)
	})
	.catch(() => {})

// (color + username changes live in Settings only — not on the dashboard)
$("viewProfileBtn").onclick = () => (location.href = "/profile")
$("logoutBtn").onclick = async () => {
	try {
		await api("/api/logout")
	} catch (e) {}
	setToken(null)
	location.href = "/"
}

// ---- Invite a friend (copies the site link) ----
$("inviteBtn").onclick = async () => {
	try {
		await navigator.clipboard.writeText(location.origin)
		// only the label changes — the row keeps its icon and its shape
		$("inviteLabel").textContent = "Link copied ✓"
		setTimeout(() => ($("inviteLabel").textContent = "Invite a friend"), 1500)
	} catch (e) {}
}

// ---- Quick start ----
$("createBtn").onclick = () => (location.href = "/game?new=1")
// Straight into a blank page, mirroring "Start a game". The + beside
// the Solo Writes heading does the same thing.
const newSoloWrite = async () => {
	$("lobbyErr").textContent = ""
	try {
		const { doc } = await api<{ doc: { id: string } }>("/api/docs", { title: "Untitled" })
		location.href = "/write?id=" + encodeURIComponent(doc.id)
	} catch (e) {
		$("lobbyErr").textContent = (e as Error).message
	}
}
$("soloBtn").onclick = newSoloWrite
$("newWritePlus").onclick = newSoloWrite
// Joining is two steps only because it needs a code: the row unfolds
// one, and focus lands in it so you can just type.
$("joinToggle").onclick = () => {
	const fold = $("joinFold")
	const open = fold.classList.toggle("hidden") === false
	$("joinToggle").setAttribute("aria-expanded", String(open))
	$("joinToggle").classList.toggle("on", open)
	if (open) $("code").focus()
	else $("lobbyErr").textContent = ""
}
$("joinBtn").onclick = () => {
	const code = $<HTMLInputElement>("code").value.trim().toUpperCase()
	if (code.length !== 4) return ($("lobbyErr").textContent = "Enter a 4-letter code.")
	location.href = "/game?code=" + encodeURIComponent(code)
}
$("code").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault()
		$("joinBtn").click()
	}
})

// ---- Games in progress ----
// The host's ⋯ menu on a card: End game & reveal, Delete story — each
// behind the site's confirm modal, and both disabled while the game
// is ACTIVE (a live session that isn't paused): you don't end or
// delete a story out from under people mid-turn; pause it first.
const isActive = (g: DashGame) => g.live && !g.paused
async function endFromCard(g: DashGame) {
	const ok = await confirmDialog({
		title: `End “${g.name || "Untitled story"}” and reveal?`,
		text:
			"The story ends where it is: everyone in it sees the reveal, and it moves to the archive, you can still continue it from there.",
		confirmLabel: "End & reveal",
		danger: false,
	})
	if (!ok) return
	try {
		await api("/api/games/" + encodeURIComponent(g.code) + "/end")
		loadDashboard()
	} catch (e) {
		mgNote((e as Error).message)
	}
}
// Sleep: snapshot + unload a LIVE game now (it wakes on the next visit).
// Only a live game can be put to sleep — a sleeping one already is.
async function sleepFromCard(g: DashGame) {
	const ok = await confirmDialog({
		title: `Put “${g.name || "Untitled story"}” to sleep?`,
		text:
			"The story is saved where it is and everyone in it is told. It wakes up the next time anyone opens it, nothing is lost.",
		confirmLabel: "Put to sleep",
		danger: false,
	})
	if (!ok) return
	try {
		await api("/api/games/" + encodeURIComponent(g.code) + "/sleep")
		loadDashboard()
	} catch (e) {
		mgNote((e as Error).message)
	}
}
async function deleteFromCard(g: DashGame) {
	const ok = await confirmDialog({
		title: `Delete “${g.name || "Untitled story"}”?`,
		text:
			"This permanently removes the story and its code, for every writer in it. The other writers get a note in their inbox saying you deleted it.",
		confirmLabel: "Delete forever",
	})
	if (!ok) return
	try {
		await api("/api/games/" + encodeURIComponent(g.code), null, "DELETE")
		loadDashboard() // the card is gone for me; the others hear by inbox note
	} catch (e) {
		mgNote((e as Error).message)
	}
}
// a refusal from the server, said under the grid for a moment
function mgNote(text: string) {
	let n = $("mgNote")
	if (!n) {
		n = document.createElement("p")
		n.id = "mgNote"
		n.className = "err"
		$("myGames").after(n)
	}
	n.textContent = text
	setTimeout(() => (n.textContent = ""), 4000)
}
// one open ⋯ menu at a time; any click elsewhere closes it
document.addEventListener("click", () =>
	document.querySelectorAll(".mg-menu.open").forEach((m) => m.classList.remove("open")),
)
function renderMyGames(games: DashGame[]) {
	const grid = $("myGames")
	grid.innerHTML = ""
	games.forEach((g) => {
		const card = document.createElement("div")
		card.className = "mg-card"
		card.innerHTML = myGameCardHtml(g)
		const btn = document.createElement("button")
		btn.className = myGameStatus(g).cls === "is-turn" ? "primary" : "ghost"
		btn.textContent = g.myTurn ? "Resume: your turn" : g.paused && !g.live ? "Wake it up" : "Open"
		btn.onclick = () => (location.href = "/game?code=" + encodeURIComponent(g.code))
		card.appendChild(btn)
		// The original host gets a ⋯ menu in the card's corner (admins act
		// from /admin): End game & reveal, Delete story.
		if (g.hosted) {
			const active = isActive(g)
			const more = document.createElement("div")
			more.className = "mg-menu"
			more.innerHTML =
				`<button type="button" class="ghost mg-more" aria-haspopup="menu" aria-expanded="false" title="More options">⋯</button>` +
				`<div class="mg-menu-list" role="menu">` +
				`<button type="button" role="menuitem" data-act="sleep" ${g.live ? "" : "disabled"}>💤 Put to sleep</button>` +
				`<button type="button" role="menuitem" data-act="end" ${active ? "disabled" : ""}>🏁 End game &amp; reveal</button>` +
				`<button type="button" role="menuitem" class="danger" data-act="delete" ${active ? "disabled" : ""}>🗑 Delete story</button>` +
				(active
					? `<span class="mg-menu-note">End/delete need the game paused, or put it to sleep.</span>`
					: g.live
						? ""
						: `<span class="mg-menu-note">Already asleep.</span>`) +
				`</div>`
			more.querySelector<HTMLElement>(".mg-more")!.onclick = (e) => {
				e.stopPropagation()
				const open = !more.classList.contains("open")
				document.querySelectorAll(".mg-menu.open").forEach((m) => m.classList.remove("open"))
				more.classList.toggle("open", open)
				more.querySelector(".mg-more")!.setAttribute("aria-expanded", String(open))
			}
			more.querySelector<HTMLElement>(".mg-menu-list")!.onclick = (e) => {
				e.stopPropagation()
				const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")
				if (!b || b.disabled) return
				more.classList.remove("open")
				if (b.dataset.act === "sleep") sleepFromCard(g)
				else if (b.dataset.act === "end") endFromCard(g)
				else deleteFromCard(g)
			}
			card.appendChild(more)
		}
		grid.appendChild(card)
	})
	// dashed "start new" slot
	const open = document.createElement("div")
	open.className = "mg-card mg-open"
	open.innerHTML = `<span class="sparkle">✨</span><span>Open slot: start a new story or invite friends.</span>`
	const nb = document.createElement("button")
	nb.className = "ghost"
	nb.textContent = "Start new game"
	nb.onclick = () => (location.href = "/game?new=1")
	open.appendChild(nb)
	grid.appendChild(open)
}

// "Write more": reopen a finished story as a lobby under its own code,
// then go gather writers there.
async function writeMore(code: string) {
	try {
		await api("/api/games/" + encodeURIComponent(code) + "/reopen", {})
		location.href = "/game?code=" + encodeURIComponent(code)
	} catch (e) {
		alert((e as Error).message)
	}
}
function renderRecent(games: DashRecent[]) {
	const box = $("recentGames")
	box.innerHTML = games.length
		? ""
		: '<p class="subtle" style="text-align:left;margin:8px 0 0">Nothing finished yet: your first reveal will land here.</p>'
	// hosted stories first, then the ones I contributed to
	const groups: [string, DashRecent[]][] = [
		["Hosted games", games.filter((g) => g.hosted)],
		["Contributed games", games.filter((g) => !g.hosted)],
	]
	groups.forEach(([title, group]) => {
		if (!group.length) return
		const h = document.createElement("h5")
		h.className = "arch-sub"
		h.textContent = title
		box.appendChild(h)
		group.forEach((g) => {
			const row = document.createElement("div")
			row.className = "rg-row"
			row.setAttribute("role", "link")
			row.tabIndex = 0
			row.innerHTML = recentRowHtml(g)
			row.onclick = () => (location.href = "/archive?code=" + encodeURIComponent(g.code))
			row.onkeydown = (e) => {
				if (e.key === "Enter") row.click()
			}
			row.querySelector<HTMLElement>("[data-act=write-more]")!.onclick = (e) => {
				e.stopPropagation()
				writeMore(g.code)
			}
			box.appendChild(row)
		})
	})
}

// ---- Writers directory (all accounts + online dots + search) ----
let allWriters: WriterRow[] = []
function renderWriters() {
	const q = $<HTMLInputElement>("writerSearch").value.trim().toLowerCase()
	const box = $("writersList")
	box.innerHTML = ""
	const hits = allWriters.filter((u) => !q || u.username.toLowerCase().includes(q))
	if (!hits.length) {
		box.innerHTML = '<p class="subtle" style="text-align:left;margin:8px 0 0">No writers match.</p>'
		return
	}
	hits.forEach((u) => {
		const row = document.createElement("a")
		row.className = "rg-row"
		row.href = "/profile?user=" + encodeURIComponent(u.username)
		row.innerHTML = writerRowHtml(u)
		box.appendChild(row)
	})
}
$("writerSearch").addEventListener("input", renderWriters)
// Add friend: the button sits inside the profile link, so the click
// must not follow it; the row repaints as "requested" on an ok.
$("writersList").addEventListener("click", async (e) => {
	const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add-friend]")
	if (!btn) return
	e.preventDefault()
	e.stopPropagation()
	const username = btn.dataset.addFriend || ""
	btn.disabled = true
	try {
		await api("/api/friends/request", { username })
		const u = allWriters.find((x) => x.username === username)
		if (u) u.requested = true
		renderWriters()
	} catch (err) {
		btn.disabled = false
		btn.textContent = (err as Error)?.message || "Couldn't send"
	}
})

// ---- Friends (right rail) ----
function renderFriends(friends: FriendRow[]) {
	const box = $("friendsBox")
	box.innerHTML = ""
	if (!friends.length) {
		box.innerHTML =
			'<p class="subtle" style="text-align:left;margin:8px 0 0">No friends yet: visit a writer\'s profile and send a request.</p>'
		return
	}
	// online friends first (the server sorts so too; said again here
	// so a cached or reordered payload can't undo it)
	;[...friends]
		.sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.username.localeCompare(b.username))
		.forEach((u) => {
			const row = document.createElement("a")
			row.className = "rg-row"
			row.href = "/profile?user=" + encodeURIComponent(u.username)
			row.title = friendStatsTip(u)
			row.innerHTML = friendRowHtml(u)
			box.appendChild(row)
		})
}
// ✉ on a friend row: the composer, not the profile
$("friendsBox").addEventListener("click", (e) => {
	const b = (e.target as HTMLElement).closest<HTMLElement>("[data-msg]")
	if (!b) return
	e.preventDefault()
	openMsg(b.dataset.msg || "")
})
let msgTo = ""
function openMsg(username: string) {
	msgTo = username
	$("msgTitle").textContent = `Message ${username}`
	$<HTMLTextAreaElement>("msgText").value = ""
	$("msgErr").textContent = ""
	$("msgOk").classList.add("hidden")
	$("msgModal").classList.remove("hidden")
	$("msgText").focus()
}
const closeMsg = () => $("msgModal").classList.add("hidden")
$("msgCancel").onclick = closeMsg
$("msgModal").onclick = (e) => e.target === $("msgModal") && closeMsg()
$("msgSend").onclick = async () => {
	const text = $<HTMLTextAreaElement>("msgText").value.trim()
	if (!text) return ($("msgErr").textContent = "Type a message first.")
	$<HTMLButtonElement>("msgSend").disabled = true
	try {
		await api("/api/message", { username: msgTo, text })
		$("msgErr").textContent = ""
		$("msgOk").classList.remove("hidden")
		$<HTMLTextAreaElement>("msgText").value = ""
		setTimeout(closeMsg, 900)
	} catch (err) {
		$("msgErr").textContent = (err as Error).message
	}
	$<HTMLButtonElement>("msgSend").disabled = false
}
$("msgText").addEventListener("keydown", (e) => {
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("msgSend").click()
	if (e.key === "Escape") closeMsg()
})

// ---- Inbox ----
// The dashboard does NOT show messages any more. A message is a
// conversation and /inbox is where conversations happen; what belongs
// here is only the fact that one is waiting. So the rail's Inbox row
// wears the count and the page never renders a single message.
// The newest announcement, if any; the card stays hidden otherwise.
async function loadAnnouncement() {
	try {
		const d = await api<{ posts?: DashPost[] }>("/api/announcements", null, "GET")
		const posts = d.posts || []
		annPosts = posts
		paintAnnouncementDot()
		if (!$("tabCommunity").classList.contains("hidden")) markAnnouncementsSeen()
		const post = posts[0]
		if (!post) {
			$("annMore").innerHTML =
				'<p class="subtle" style="text-align:left;margin:4px 0 0">Nothing from the admins yet.</p>'
			return
		}
		$("annMore").innerHTML = posts.slice(1, 4).map(announcementRowHtml).join("")
		annPost = post
		$("annCard").innerHTML = latestAnnouncementHtml(post)
		$("annCard").classList.remove("hidden")
		// the newest word from the admins draws its own border in the
		// theme's accent, then a gradient keeps glimmering along it —
		// once the Community tab is on screen
		if (!$("tabCommunity").classList.contains("hidden")) drawAnnouncement()
	} catch (e) {
		/* no card */
	}
}

async function loadInbox() {
	let unread = 0
	try {
		unread = (await api<{ unread?: number }>("/api/inbox", null, "GET")).unread || 0
	} catch (e) {
		return
	}
	const b = $("navInbox")
	b.classList.toggle("hidden", !unread)
	b.textContent = unread > 99 ? "99+" : String(unread || "")
	b.setAttribute("aria-label", `${unread} unread message${unread === 1 ? "" : "s"}`)
	try {
		renderFriends((await api<{ friends: FriendRow[] }>("/api/friends", null, "GET")).friends)
	} catch (e) {}
}

// ---- Help: ask the admin ----
// Only non-admins see the box; the route refuses admins anyway, since
// they're the ones these questions are delivered to.
if (!me?.admin) $("helpCard").classList.remove("hidden")
$("helpSend").onclick = async () => {
	const text = $<HTMLTextAreaElement>("helpText").value.trim()
	if (!text) return
	$<HTMLButtonElement>("helpSend").disabled = true
	$("helpMsg").textContent = ""
	try {
		await api("/api/help", { text })
		$<HTMLTextAreaElement>("helpText").value = ""
		$("helpMsg").textContent = "Sent: watch your inbox for the reply. 📬"
	} catch (e) {
		$("helpMsg").textContent = (e as Error).message
	}
	$<HTMLButtonElement>("helpSend").disabled = false
}

// ---- Poll the dashboard payload every 10s ----
// ---- Solo writes (mine only; beta-reads live on /writes) ----
wireSoloDeletes($("dashWrites"), (id) => api("/api/docs/" + encodeURIComponent(id || ""), null, "DELETE"))
async function loadWrites() {
	try {
		const d = await api<{ docs?: (DocSummary & { mine?: boolean })[] }>("/api/docs", null, "GET")
		const all = d.docs || []
		const mine = all.filter((x) => x.mine)
		$("dashWrites").innerHTML = soloListHtml(mine, {
			empty: "Nothing written solo yet, start one from the rail.",
			limit: 5,
		})
		// beta reads (others' fics) go in their own card, grouped by owner
		const betaHtml = betaReadingHtml(all)
		$("dashBetaReads").innerHTML = betaHtml
		$("dashBetaSec").classList.toggle("hidden", !betaHtml)
		if (mine.length > 5)
			$("dashWrites").insertAdjacentHTML(
				"beforeend",
				`<p class="subtle" style="text-align:left;margin:10px 0 0"><a class="linky" href="/writes">See all ${mine.length} →</a></p>`,
			)
	} catch (e) {}
}
loadWrites()
async function loadDashboard() {
	if (!me) return
	loadInbox()
	let d: DashboardPayload
	try {
		d = await api<DashboardPayload>("/api/dashboard", null, "GET")
		allWriters = (await api<{ users: WriterRow[] }>("/api/users", null, "GET")).users
		$("tabCommunityLive").classList.toggle("hidden", !d.liveGames.length)
	} catch (e) {
		return
	}
	me = { ...me, ...d.stats }
	renderMe()
	renderWriters()
	renderMyGames(d.myGames)
	renderRecent(d.recentGames)
	const box = $("dashLive")
	if (!d.liveGames.length) {
		box.innerHTML = '<p class="subtle" style="text-align:left;margin:0">No games running right now.</p>'
	} else {
		box.innerHTML = ""
		d.liveGames.forEach((g, i) => {
			const row = document.createElement("div")
			row.className = "live-game"
			row.style.setProperty("--lg-i", String(i)) // staggers the bulb and sheen row by row
			// a game still gathering writers glows + sparkles to pull
			// OTHER members in (not if I'm already seated in it)
			if (g.phase === "waiting" && !g.players.some((pl) => pl.name === me?.username)) row.classList.add("gathering")
			row.innerHTML = liveGameInfoHtml(g)
			const btn = document.createElement("button")
			btn.className = "ghost"
			btn.textContent = "Join"
			btn.onclick = () => (location.href = "/game?code=" + encodeURIComponent(g.code))
			row.appendChild(btn)
			box.appendChild(row)
		})
		sparkleGathering(box)
	}
}
// GSAP sparkles over "gathering writers" rows (the glow pulse is CSS).
// The gsap CDN script is a classic script, so it's loaded before this
// module runs; rows are rebuilt every poll, so old tweens die with them.
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
function sparkleGathering(box: HTMLElement) {
	if (!window.gsap || reduceMotion) return
	box.querySelectorAll(".live-game.gathering").forEach((row) => {
		for (let i = 0; i < 5; i++) {
			const s = document.createElement("span")
			s.className = "sparkle"
			s.textContent = "✦"
			row.appendChild(s)
			gsap.set(s, {
				left: 4 + Math.random() * 88 + "%",
				top: 8 + Math.random() * 70 + "%",
				rotation: Math.random() * 60 - 30,
			})
			gsap.fromTo(
				s,
				{ opacity: 0, scale: 0.3 },
				{
					opacity: 0.9,
					scale: 0.9 + Math.random() * 0.5,
					duration: 0.6 + Math.random() * 0.7,
					repeat: -1,
					yoyo: true,
					delay: Math.random() * 1.4,
					ease: "sine.inOut",
				},
			)
		}
	})
}
renderMe()
loadDashboard()
setInterval(loadDashboard, 10_000)
