import { PALETTE, esc, safeColor, whoMarks, miniAvatar, promptHtml, siteName } from "/js/util.js"
import { api as authApi, getToken, setToken } from "/js/api.js"
import { loadRejoin, saveRejoin, clearRejoin } from "/js/socket-client.js"
import { createSounds, createLineChime, shouldChimeChat, shouldChime } from "/js/sounds.js"
import { mountChrome, setUserChip, regateThemes } from "/js/chrome.js"
import { mountGimmickDice } from "/js/components/gimmick-dice.js"
import { mountGalaga } from "/js/components/galaga-game.js"
import { mountMilkshake } from "/js/components/milkshake-spill.js"
import { mountDiscoBall } from "/js/components/disco-ball.js"
import { mountArtRoom } from "/js/components/art-room.js"
import { mountGimmickDock } from "/js/components/gimmick-dock.js"
import { mountSuperSoaker } from "/js/components/super-soaker.js"
import { mountVecnaCurse } from "/js/components/vecna-curse.js"
import { requireAuth } from "/js/auth-guard.js"
import { statusDot, refreshStatusDots, updateLiveStatus, presenceHtml } from "/js/status.js"
import { cleanHtml } from "/js/components/editor.js"
import { toolbarHtml, mountRichToolbar } from "/js/components/rich-toolbar.js"
import { storyHtml, livePreviewHtml } from "/js/components/story-feed.js"
import { mountPromptModes, optionChipsHtml } from "/js/components/prompt-modes.js"
import { chatMessageHtml } from "/js/components/chat-view.js"
import { reactionsHtml } from "/js/components/reactions.js"
import { createReactionPicker } from "/js/components/reaction-picker.js"
import { confirmDialog } from "/js/components/confirm-delete.js"
import { getSpectatorName } from "/js/spectator-names.js"
import { countdownView } from "/js/components/countdown.js"
import { mountRulesForm } from "/js/components/rules-form.js"
import { mountExportMenu } from "/js/components/export-menu.js"
import { mountTagEditor } from "/js/components/tag-chips.js"
import { showInviteToast } from "/js/turn-alert.js"
import { needsJoinConfirm, joinConfirmHtml } from "/js/join-confirm.js"
import type { JoinConfirmGame } from "/js/join-confirm.js"
import { reconnectOutcome, adoptSeatId } from "/js/components/seat-identity.js"
import type { Socket } from "socket.io-client"
import type { ServerToClient, ClientToServer, GameState, Roster, RosterWriter, StoryLine, ChatMessage, SeatAck, SeatResult, ScoreRow } from "/js/shared/wire.js"
import type { Reactions } from "/js/shared/reactions.js"
import type { ChipUser } from "/js/chrome.js"
import type { SoundPrefs } from "/js/sounds.js"
import type { PromptMenus } from "/js/shared/wire.js"

/** The signed-in account as /api/me ships it — the fields this page reads. */
interface Me extends ChipUser {
	id: string
	sounds?: Partial<SoundPrefs> | boolean | null
	gimmicks?: string[]
}
/** A writers-directory profile, as /api/users/:username ships it (the stat tooltip). */
interface Profile {
	username: string
	color?: string
	wordCount?: number
	wordBadges?: string[]
	usageBadges?: string[]
}
type Card = "waiting" | "choosing" | "game" | "over" | "none"
mountChrome({ page: "game" })
// Spectators need no account: ?spectate=CODE watches a story read-only.
const spectateCode = (new URLSearchParams(location.search).get("spectate") || "").trim().toUpperCase()
const me = spectateCode ? null : await requireAuth<Me>("/") // redirects signed-out visitors home
setUserChip(me)
const socket: Socket<ServerToClient, ClientToServer> = io()
// A story I contributed to is being continued — invite me back
// (unless I'm already sitting in that very game).
socket.on("game-invite", (inv) => {
	const here = (new URLSearchParams(location.search).get("code") || "").trim().toUpperCase()
	if (inv?.code && inv.code !== here) showInviteToast(inv)
})
let myId: string | null = null,
	hostId: string | null = null,
	hostUserId: string | null = null,
	tickInterval: ReturnType<typeof setInterval> | undefined,
	myVotes = new Set<string>(), // approval voting: every scenario I've backed
	lastOptsKey = ""
// Every id this page reads is in its own markup, so the lookup is typed as
// found; `$("x") && …` guards in the code below still hold at runtime.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id)
const show = (id: string) => $(id).classList.remove("hidden")
const hide = (id: string) => $(id).classList.add("hidden")
// Tab title is the story's name, refreshed whenever the session bar
// repaints (so a rename mid-vote shows at once); a nameless story
// falls back to the phase: Lobby while gathering/voting, Cowrite in play.
const PAGE_TITLES: Partial<Record<Card, string>> = { waiting: "Lobby", choosing: "Lobby", game: "Cowrite", over: "Cowrite" }
let shownCard: Card = "waiting"
const setPageTitle = () => {
	document.title = siteName() + ": " + (sessName || PAGE_TITLES[shownCard] || "Game")
}
// Chat is ONE element: a section of the side column while the story
// is being written AND on the reveal (#overSide), and the foot of the
// lobby / vote card otherwise, so the table talks in every phase.
const chatHome = $("chatCard").parentElement as HTMLElement
const placeChat = (id: Card) => {
	const chat = $("chatCard")
	if (id === "game" || id === "over") {
		const home = id === "game" ? chatHome : $("overSide")
		// back in the side column the chat goes ABOVE the demogorgon
		// (#doomFx hugs the column's foot); appendChild would land it under
		if (chat.parentElement !== home) home.insertBefore(chat, id === "game" ? $("doomFx") : null)
		chat.classList.remove("chat-inline")
	} else if ($(id)) {
		$(id).appendChild(chat)
		chat.classList.add("chat-inline")
	}
}
const onlyShow = (id: Card) => {
	;["waiting", "choosing", "game", "over"].forEach((x) => (x === id ? show(x) : hide(x)))
	shownCard = id
	placeChat(id)
	setPageTitle()
}

// ---- Persistent "your turn" alert: an in-page toast that stays until
// dismissed (or the turn ends), plus a sticky browser notification
// (requireInteraction) when the tab is hidden. ----
let turnNotif: Notification | null = null
$("turnToastClose").onclick = () => hide("turnToast")
function turnAlert(on: boolean) {
	if (!on) {
		hide("turnToast")
		if (turnNotif) {
			turnNotif.close()
			turnNotif = null
		}
		return
	}
	show("turnToast")
	if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
		try {
			turnNotif = new Notification(siteName(), {
				body: "It's your turn: write the next line!",
				requireInteraction: true,
			})
			turnNotif.onclick = () => {
				window.focus()
				turnNotif?.close()
			}
		} catch (e) {}
	}
}

// ---- Sounds (js/sounds.js) — honors the account's saved preferences ----
const soundKit = createSounds()
soundKit.setPrefs(me?.sounds) // spectators (no account) default all-on
const { play: playSound, clock: vecnaClock } = soundKit

// ---- Gimmicks (components/gimmick-dice.js): the foot bar's 🎲 menu
// and the dice on the table — every die anyone has out tumbles over
// THIS page, editor included: it's a distraction, so the writer sees
// it too. Spectators never seat (setSeated stays false), so the
// button never shows for them, but they still see the dice.
let sessFriendlyFlag = true
const galaga = mountGalaga({ socket, getMyUserId: () => me?.id ?? null, getMyName: () => me?.username || "me", getMyColor: () => safeColor(me?.color) })
const milkshake = mountMilkshake({
	socket,
	getMyUserId: () => me?.id ?? null,
	getMyColor: () => safeColor(me?.color),
	getMyName: () => me?.username || "",
})
let tableColors: string[] = [] // the seated writers' palette colours (the disco lights)
const disco = mountDiscoBall({
	socket,
	getMyUserId: () => me?.id ?? null,
	getMyColor: () => safeColor(me?.color),
	getMyName: () => me?.username || "",
	getTableColors: () => tableColors,
})
const artroom = mountArtRoom({
	socket,
	getMyUserId: () => me?.id ?? null,
	getMyColor: () => safeColor(me?.color),
	getMyName: () => me?.username || "",
})
const soaker = mountSuperSoaker({
	socket,
	getMyUserId: () => me?.id ?? null,
	getMyColor: () => safeColor(me?.color),
	getMyName: () => me?.username || "",
})
let tableWriters: RosterWriter[] = [] // the seated writers, for the curse's target list
const curse = mountVecnaCurse({
	socket,
	getMyUserId: () => me?.id ?? null,
	getTable: () => tableWriters,
	// the clock chimes for the victim: a short strike of the vecna
	// clock loop, skipped if the turn countdown already has it
	playChime: () => {
		if (vecnaClock.active) return
		vecnaClock.start()
		setTimeout(() => vecnaClock.stop(), 4500)
	},
})
const gimmicks = mountGimmickDice({
	socket,
	getMyUserId: () => me?.id ?? null,
	getMyColor: () => safeColor(me?.color),
	isSeated: () => !!myId && !spectateCode,
	isFriendly: () => sessFriendlyFlag,
	onRoll: () => playSound("dierolling"), // any die tumbling, mine or theirs (gimmick pref)
	launchers: { galaga: () => galaga.start(), milkshake: () => milkshake.start(), disco: () => disco.start(), artroom: () => artroom.start(), supersoaker: () => soaker.start(), curse: () => curse.start() }, // not dice: their own games take it from here
})
// gimmicks stack: every open HUD can minimize to an icon tab on the left edge
mountGimmickDock({
	document,
	items: [
		{ id: "d20", icon: "🎲", title: "Hellfire d20", hud: "#gdHud" },
		{ id: "galaga", icon: "👾", title: "Palace Arcade Galaga", hud: "#ggHud" },
		{ id: "milkshake", icon: "🥤", title: "Starcourt Milkshake", hud: "#msHud" },
		{ id: "disco", icon: "🪩", title: "Rink-O-Mania Disco Ball", hud: "#dbHud" },
		{ id: "artroom", icon: "🎨", title: "Will's Art Room", hud: "#arHud" },
		{ id: "supersoaker", icon: "💦", title: "SuperSoaker", hud: "#skHud" },
		{ id: "curse", icon: "🕰️", title: "Vecna's Curse", hud: "#vcxHud" },
	],
})
// the host's ⚙️ tab stands at the top of that same left-edge stack
$("gkTabs").prepend($("hostOpen"))
// what this account may START; re-gated live by a rank-up toast below
if (me?.gimmicks) gimmicks.setGate({ unlocked: me.gimmicks })
authApi("/api/gimmicks", null, "GET")
	.then((d) => gimmicks.setGate(d))
	.catch(() => {})
const lineChime = createLineChime(playSound)

// One small centered notice when a friendly switch sweeps the
// gimmicks off the table — faded in and out by gsap when it's
// loaded, plain show/remove otherwise.
function gimmickOffToast() {
	const el = document.createElement("div")
	el.className = "gimmick-off-toast glass"
	el.setAttribute("role", "status")
	el.textContent = "💛 This is a friendly game now, gimmicks are off."
	document.body.appendChild(el)
	const g = window.gsap
	if (g) {
		g.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" })
		g.to(el, { opacity: 0, duration: 0.5, delay: 3.4, ease: "power2.in", onComplete: () => el.remove() })
	} else setTimeout(() => el.remove(), 3800)
}

// ---- Signed-in identity chip (badge may change mid-game) ----
function refreshChip() {
	authApi<{ user: ChipUser }>("/api/me", null, "GET")
		.then((d) => setUserChip(d.user))
		.catch(() => {})
}

// ---- Session bar: name (host-editable) + copyable code ----
let myCode = "",
	sessName = "",
	sessFriendly: boolean | null = null
function updateSessionBar() {
	// no host name next to the story title — the slot shows the story
	// mode instead (hosts are tagged "(host)" in the lists)
	document.querySelectorAll<HTMLElement>("[data-sess-host]").forEach((el) => {
		el.innerHTML =
			sessFriendly == null
				? ""
				: sessFriendly
					? '<span class="mode-chip">💛 friendly</span>'
					: '<span class="mode-chip">🌶 non-friendly</span>'
	})
	refreshStatusDots()
	document.querySelectorAll("[data-sess-name]").forEach((el) => {
		el.textContent = sessName || "Untitled story"
		el.classList.toggle("unnamed", !sessName)
	})
	setPageTitle()
	document.querySelectorAll<HTMLElement>("[data-sess-code]").forEach((el) => {
		if (!el.dataset.copied) el.textContent = (myCode || "····") + " ⧉"
	})
	document.querySelectorAll("[data-sess-edit]").forEach((el) => el.classList.toggle("hidden", myId !== hostId))
}
async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch (e) {
		try {
			const ta = document.createElement("textarea")
			ta.value = text
			document.body.appendChild(ta)
			ta.select()
			document.execCommand("copy")
			ta.remove()
			return true
		} catch (e2) {
			return false
		}
	}
}
async function copyCode(feedbackEl: HTMLElement | null, resetText?: () => string) {
	if (!(await copyText(myCode))) return
	if (feedbackEl) {
		feedbackEl.dataset.copied = "1"
		feedbackEl.textContent = "Copied ✓"
		setTimeout(() => {
			delete feedbackEl.dataset.copied
			if (resetText) feedbackEl.textContent = resetText()
			updateSessionBar()
		}, 1200)
	}
}
document.querySelectorAll<HTMLElement>("[data-sess-code]").forEach((b) => (b.onclick = () => copyCode(b)))
document.querySelectorAll<HTMLElement>("[data-sess-edit]").forEach((b) => {
	b.onclick = () => {
		const bar = b.closest(".session-bar") as HTMLElement
		bar.querySelector("[data-sess-name]")!.classList.add("hidden")
		b.classList.add("hidden")
		const inp = bar.querySelector("[data-sess-input]") as HTMLInputElement
		inp.value = sessName
		inp.classList.remove("hidden")
		bar.querySelector("[data-sess-save]")!.classList.remove("hidden")
		inp.focus()
	}
})
document.querySelectorAll<HTMLInputElement>("[data-sess-input]").forEach((inp) => {
	const bar = inp.closest(".session-bar") as HTMLElement
	const close = () => {
		inp.classList.add("hidden")
		bar.querySelector("[data-sess-save]")!.classList.add("hidden")
		bar.querySelector("[data-sess-name]")!.classList.remove("hidden")
		updateSessionBar()
	}
	const save = () => {
		if (inp.classList.contains("hidden")) return
		socket.emit("rename-session", { name: inp.value }, (res) => {
			if (res?.ok) {
				sessName = res.name
				updateSessionBar()
			}
		})
		close()
	}
	inp.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault()
			save()
		} else if (e.key === "Escape") close()
	})
	inp.addEventListener("blur", save)
	// mousedown (not click) so it beats the input's blur-save
	bar.querySelector("[data-sess-save]")!.addEventListener("mousedown", (e) => {
		e.preventDefault()
		save()
	})
})
$("codeDisplay").onclick = () => copyCode($("codeDisplay"), () => myCode)

// ---- Cover image (host-only): a linked header image URL that becomes
// the story's thumbnail on the dashboard and archive ----
// Live cover preview under each input: shows for http(s) urls, updates
// as the host types, hides itself when the image fails to load.
const COVER_PREVIEWS: Record<string, string> = { coverInput: "coverPreview", coverInput2: "coverPreview2" }
function previewCover(previewId: string, url: string) {
	const img = $<HTMLImageElement>(previewId)
	if (!img) return
	const ok = /^https?:\/\//i.test(url)
	img.classList.toggle("hidden", !ok)
	if (ok && img.src !== url) img.src = url
	img.onerror = () => img.classList.add("hidden")
}
function wireCover(inputId: string, btnId: string) {
	const inp = input(inputId),
		btn = $(btnId)
	// an edited-but-unsaved value must survive roster/game-state
	// broadcasts — syncCover skips dirty (and focused) inputs
	inp.addEventListener("input", () => {
		inp.dataset.dirty = "1"
		previewCover(COVER_PREVIEWS[inputId]!, inp.value.trim())
	})
	const send = () =>
		socket.emit("set-cover", { url: inp.value.trim() }, (res) => {
			btn.textContent = res?.ok ? "Set ✓" : res?.error || "Host only"
			setTimeout(() => (btn.textContent = "Set"), 2000)
			if (res?.ok) for (const id of ["coverInput", "coverInput2"]) delete $(id).dataset.dirty
		})
	btn.onclick = send
	inp.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault()
			send()
		}
	})
}
wireCover("coverInput", "coverBtn")
wireCover("coverInput2", "coverBtn2")
function syncCover(cover: string | null | undefined) {
	if (cover == null) return
	for (const id of ["coverInput", "coverInput2"]) {
		const inp = input(id)
		if (document.activeElement !== inp && !inp.dataset.dirty) {
			inp.value = cover
			previewCover(COVER_PREVIEWS[id]!, cover)
		}
	}
}

// ---- Page entry: ?code= joins, ?new=1 creates, else the rejoin blob ----
const gameMsg = (text: string) => {
	$("gameMsg").textContent = text
	$("gameMsgCard").classList.toggle("hidden", !text)
}
function rejoinAck(res: SeatResult) {
	if (!res?.ok) {
		clearRejoin() // dead game or expired seat
		return location.replace("/dashboard")
	}
	if ("pending" in res)
		return gameMsg("This story was continued, waiting for the host to let you back in…")
	enterSession(res)
}
let entered = false
// A dropped transport (sleep, a tab in the background, a proxy
// closing an idle socket) is otherwise invisible: say so until
// the seat is reclaimed, so a stall never reads as being kicked.
socket.on("disconnect", () => {
	if (entered && !spectateCode) gameMsg("Reconnecting…")
})
// After a reconnect the socket has a NEW id and the server has moved
// the seat onto it — every "is this me" check compares against
// myId, so it must be re-read here or the page thinks it was kicked
// (no "Your turn", no host controls) until a hard refresh.
function reconnectAck(res: SeatResult) {
	const out = reconnectOutcome(res, socket.id!, hostId)
	if (out.kind === "gone") {
		clearRejoin() // seat expired or the game is gone
		return location.replace("/dashboard")
	}
	if (out.kind === "pending") return gameMsg("Reconnected, waiting for the host to let you back in…")
	myId = out.myId
	hostId = out.hostId
	gameMsg("")
}
// Belt and braces for any path that reseats this socket without an
// ack reaching us (a host approving a returning seat): if no writer
// wears my id but one wears my account, that seat is mine.
function adoptSeat(writers: RosterWriter[]) {
	if (!entered || spectateCode || !me) return
	const id = adoptSeatId(writers, myId, me.id)
	if (id) myId = id
}
socket.on("connect", () => {
	if (spectateCode) {
		// read-only: join the broadcast room, no seat, no auth needed
		socket.emit("spectate-session", { code: spectateCode }, (res) => {
			if (!res?.ok) return gameMsg((res && !res.ok && res.error) || "That story isn't running.")
			gameMsg("")
			myId = "spectator" // never matches a writer id -> no edit ✎, never "your turn"
			show("chatCard")
			// spectators chat too, under their client-minted name
			input("chatInput").placeholder = "Chat as " + getSpectatorName() + "…"
			$("whoTurn").textContent = "Spectating…"
			if (res.phase === "waiting") onlyShow("waiting")
		})
		return
	}
	socket.emit("identify", { auth: getToken() }) // dashboard presence
	const rejoinInfo = loadRejoin()
	if (entered) {
		// transient reconnect: reclaim the seat and take the new id
		if (rejoinInfo) socket.emit("rejoin-session", { ...rejoinInfo, auth: getToken() }, reconnectAck)
		else location.replace("/dashboard")
		return
	}
	entered = true
	const qs = new URLSearchParams(location.search)
	const code = (qs.get("code") || "").trim().toUpperCase()
	if (code && needsJoinConfirm(qs.get("from"))) confirmJoin(code)
	else if (code) joinByCode(code)
	else if (qs.has("new")) createGame()
	else if (rejoinInfo) socket.emit("rejoin-session", { ...rejoinInfo, auth: getToken() }, rejoinAck)
	else location.replace("/dashboard")
})
function createGame() {
	socket.emit("create-session", { auth: getToken() }, (res) => {
		if (!res?.ok) return gameMsg(res?.error || "Could not start a game.")
		if ("pending" in res) return
		enterSession(res)
	})
}
// A link from Discord shows what the game is and waits for a click:
// one tap on a chat button shouldn't seat anyone by surprise.
async function confirmJoin(code: string) {
	let g: JoinConfirmGame | null = null
	try {
		g = (await authApi<{ games: JoinConfirmGame[] }>("/api/live", null, "GET")).games.find((x) => x.code === code) || null
	} catch {}
	if (!g) return gameMsg("That story isn't running right now.")
	$("gameMsg").innerHTML = joinConfirmHtml(g)
	$("gameMsgCard").classList.remove("hidden")
	$("joinConfirmBtn").onclick = () => {
		$<HTMLButtonElement>("joinConfirmBtn").disabled = true
		gameMsg("Joining…")
		joinByCode(code)
	}
}
function joinByCode(code: string) {
	socket.emit("join-session", { code, auth: getToken() }, (res) => {
		if (!res?.ok) return gameMsg(res?.error || "Could not join that game.")
		if ("pending" in res)
			return gameMsg("This story is underway, waiting for the host to let you in…")
		enterSession(res)
	})
}
function enterSession(res: SeatAck) {
	myId = socket.id!
	hostId = res.hostId
	gimmicks.setSeated(true)
	if (res.token) saveRejoin(res.code, res.token)
	myCode = res.code
	gameMsg("")
	history.replaceState(null, "", "/game?code=" + res.code)
	$("codeDisplay").textContent = res.code
	// An account seat-reclaim can land mid-game: the server follows the ack
	// with game-state / game-over, which shows the right card itself.
	if (!res.phase || res.phase === "waiting") onlyShow("waiting")
	show("chatCard")
	if ("Notification" in window && Notification.permission === "default")
		Notification.requestPermission().catch(() => {})
	updateHostView()
	updateSessionBar()
}
function updateHostView() {
	const host = myId === hostId
	$("hostControls").classList.toggle("hidden", !host)
	$("lobbyShare").classList.toggle("hidden", !host)
	$("waitingNote").classList.toggle("hidden", host)
	// Cancel: a brand-new game is discarded; a continued/reopened one
	// (it already has lines) is just closed and its story preserved.
	const cancelLabel = gameContinued ? "Cancel (keep story)" : "Cancel game"
	for (const id of ["cancelBtn", "cancelBtn2"]) { const b = $(id); if (b) b.textContent = cancelLabel }
	// everyone sees the continue panel; it is driven by whoever the
	// server would let continue (mirrors mayContinue in src/game.js):
	// the acting host, the ORIGINAL host by account, or anyone seated
	// when no connected seat holds the host role
	const hostHere = (tableWriters || []).some((w) => w.isHost && w.connected)
	const canCont = host || (me && me.id === hostUserId) || !hostHere
	const cc = $("continueControls")
	cc.classList.remove("hidden")
	cc.classList.toggle("continue-locked", !canCont)
	cc.title = canCont ? "" : "Only the host has the ability to continue the story."
	// (tags are exempt: every writer may tag, not just the host)
	cc.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach((el) => (el.disabled = !canCont && !el.closest("#overTags")))
	// the bulk enable above wipes the checkbox-driven disabled states
	if (canCont) contRules.sync()
}

// ---- Rules forms (shared component: lobby, host panel, continue) ----
const lobbyRules = mountRulesForm($("lobbyRules"), {
	ids: { mode: "storyMode", endless: "endlessRounds", rounds: "rounds", noTimer: "noTimer", secs: "turnSecs" },
})
const liveRules = mountRulesForm($("liveRules"), {
	ids: { mode: "liveMode", endless: "liveEndless", rounds: "addRoundsInput", noTimer: "liveNoTimer", secs: "liveSecs" },
	roundsLabel: "Add rounds",
	roundsMax: 20,
	roundsPlaceholder: "0",
})
const contRules = mountRulesForm($("contRules"), {
	ids: { mode: "contMode", endless: "contEndless", rounds: "contRounds", noTimer: "contNoTimer", secs: "contSecs" },
})

// ---- Waiting room ----
$("startBtn").onclick = () =>
	socket.emit("start-game", { ...lobbyRules.values(), ...lobbyPrompt.values() }, (res) => {
		if (!res?.ok) alert(res?.error || "Could not start.")
	})

async function cancelGame() {
	const keep = gameContinued
	const ok = await confirmDialog({
		title: keep ? "Cancel writing more?" : "Cancel this game?",
		text: keep
			? "This closes the lobby and leaves the existing story exactly as it was — nothing is lost, and you can continue it again later from the archive."
			: "This discards the game before it starts. Nobody has written a line yet, so the story and its code go away for good.",
		confirmLabel: keep ? "Keep the story" : "Discard game",
		danger: !keep,
	})
	if (!ok) return
	socket.emit("cancel-game", {}, (res) => {
		if (!res?.ok) return alert(res?.error || "Could not cancel.")
		clearRejoin()
		if (res.deleted) location.href = "/dashboard"
		// a preserved game broadcasts game-over; the reveal shows the kept story
	})
}
for (const id of ["cancelBtn", "cancelBtn2"]) { const b = $(id); if (b) b.onclick = cancelGame }

// The host's ⋯ menu on another seated player (lobby roster and the
// players row alike): "Make host" hands them the game for good
// (make-host, server-side host-only). Only the host sees it, only on
// writers who are in the game and aren't already hosting.
function seatMenuHtml(w: RosterWriter, writers: RosterWriter[]) {
	const amHost = (writers || []).some((x) => x.isHost && x.id === myId)
	if (!amHost || w.isHost || w.connected === false) return ""
	return (
		`<span class="mg-menu seat-menu">` +
		`<button type="button" class="ghost mg-more" aria-label="More options for ${esc(w.name)}" title="More">⋯</button>` +
		`<span class="mg-menu-list"><button type="button" class="ghost seat-make-host" data-id="${esc(w.id)}">👑 Make host</button></span>` +
		`</span>`
	)
}
document.addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	const more = t.closest(".seat-menu .mg-more")
	const mk = t.closest<HTMLElement>(".seat-make-host")
	const share = t.closest(".share-menu [data-share]")
	if (share) return share.closest(".seat-menu")!.classList.remove("open") // the row's own onclick does the work
	if (t.closest(".share-menu .mg-menu-list")) return // picking a friend in the list keeps it open
	if (!more && !mk) return document.querySelectorAll(".seat-menu.open").forEach((m) => m.classList.remove("open"))
	e.preventDefault()
	e.stopPropagation()
	if (more) {
		const menu = more.closest(".seat-menu")!
		const open = menu.classList.contains("open")
		document.querySelectorAll(".seat-menu.open").forEach((m) => m.classList.remove("open"))
		menu.classList.toggle("open", !open)
		return
	}
	mk!.closest(".seat-menu")!.classList.remove("open")
	socket.emit("make-host", { id: mk!.dataset.id || "" }, (res) => {
		if (!res?.ok) alert(res?.error || "Could not hand over the game.")
	})
})
socket.on("roster", ({ writers, code, name, cover, hostUserId: hu, continued }) => {
	if (continued !== undefined) gameContinued = !!continued
	updateLiveStatus(writers)
	if (hu !== undefined) hostUserId = hu
	if (Array.isArray(writers)) tableWriters = writers
	if (code) myCode = code
	if (name != null) sessName = name
	syncCover(cover)
	const list = $("rosterList")
	list.innerHTML = ""
	for (const w of writers) {
		const li = document.createElement("li")
		const col = safeColor(w.color)
		if (w.connected === false) li.style.opacity = "0.45"
		li.dataset.user = w.name
		li.innerHTML =
			presenceHtml(w.connected !== false) +
			miniAvatar(w) +
			`<span class="rname" style="color:${col}">${esc(w.name)}</span>` +
			whoMarks(w) +
			`${w.badge ? `<span class="badge-chip">${esc(w.badge)}</span>` : ""}` +
			seatMenuHtml(w, writers)
		list.appendChild(li)
	}
	adoptSeat(writers)
	hostId = writers.find((w) => w.isHost)?.id ?? hostId
	updateHostView()
	updateSessionBar()
})

// ---- Phase router ----
let lastStoryLen = 0
let gameContinued = false
let lastPaused = false
socket.on("game-state", (st) => {
	lastPaused = !!st.paused
	if (Array.isArray(st.tableGimmicks)) gimmicks.setGate({ table: st.tableGimmicks })
	updateLiveStatus(st.writers)
	adoptSeat(st.writers)
	if (Array.isArray(st.writers)) {
		tableColors = st.writers.map((w) => safeColor(w.color))
		tableWriters = st.writers
	}
	hostId = st.hostId ?? hostId
	if (st.hostUserId !== undefined) hostUserId = st.hostUserId
	if (st.code) myCode = st.code
	if (st.name != null) sessName = st.name
	if (st.friendly != null) sessFriendly = st.friendly
	const wasFriendly = sessFriendlyFlag
	sessFriendlyFlag = st.friendly !== false
	// The game just went friendly: whatever gimmicks were out fade
	// away (each mount handles its own), and the table is told why.
	if (sessFriendlyFlag && !wasFriendly) {
		const had = [gimmicks.gimmicksOff(), galaga.gimmicksOff(), milkshake.gimmicksOff(), disco.gimmicksOff(), artroom.gimmicksOff(), soaker.gimmicksOff(), curse.gimmicksOff()].some(Boolean)
		if (had) gimmickOffToast()
	}
	syncCover(st.cover)
	updateSessionBar()
	if (st.phase === "choosing") renderChoosing(st)
	else if (st.phase === "writing") renderWriting(st)
	refreshStatusDots() // dots created during render resolve against the fresh map
})

// ---- Choosing (vote) ----
function renderChoosing(st: GameState) {
	onlyShow("choosing")
	const key = st.options.join("||")
	if (key !== lastOptsKey) {
		lastOptsKey = key
		myVotes = new Set()
	}
	// the server's word on my ballot wins (a refresh or a removed
	// option would otherwise leave a stale tick on screen)
	if (st.ballots && myId) myVotes = new Set((st.ballots[myId] || []).map((i) => st.options[i]!))
	const box = $("optionsBox")
	box.innerHTML = ""
	st.options.forEach((p, i) => {
		const b = document.createElement("button")
		b.className = "option" + (myVotes.has(p) ? " mine" : "")
		b.setAttribute("aria-pressed", myVotes.has(p) ? "true" : "false")
		b.innerHTML = `${promptHtml(p)}${optionChipsHtml(st.optionMeta?.[i])}<span class="votecount">${
			st.tally?.[i] || 0
		} ▲</span>`
		b.onclick = () => {
			// a click toggles this scenario on my ballot — vote for as many as you like
			if (myVotes.has(p)) myVotes.delete(p)
			else myVotes.add(p)
			b.classList.toggle("mine", myVotes.has(p))
			socket.emit("vote", { prompt: p })
		}
		const meta = st.optionMeta?.[i]
		// a hand-written scenario: its author (or the host) can take it
		// back; nobody rerolls somebody's words
		if (meta?.custom) {
			if ((me?.id != null && meta.by === me.id) || myId === hostId) {
				const rm = document.createElement("button")
				rm.type = "button"
				rm.className = "opt-reroll opt-remove"
				rm.title = "Remove this scenario"
				rm.textContent = "✕ Remove"
				rm.onclick = (e) => {
					e.stopPropagation()
					myVotes.delete(p)
					socket.emit("remove-prompt", { index: i })
				}
				b.appendChild(rm)
				b.classList.add("has-reroll")
			}
		} else if (myId === hostId) {
			// the host can redeal just this one, keeping the rest of the ballot
			const rr = document.createElement("button")
			rr.type = "button"
			rr.className = "opt-reroll"
			rr.title = "Reroll this option"
			rr.textContent = "↻ Reroll"
			rr.onclick = (e) => {
				e.stopPropagation()
				myVotes.delete(p)
				socket.emit("reroll-option", { index: i })
			}
			b.appendChild(rr)
			b.classList.add("has-reroll")
		}
		box.appendChild(b)
	})
	renderReady(st)
	$("hostVoteBtns").classList.toggle("hidden", myId !== hostId)
	renderPromptControls(st)
}

// Who has said they're done voting. The host may start once every
// other connected seat is ready (the server refuses otherwise).
function renderReady(st: GameState) {
	const ready = new Set(st.ready || [])
	const seated = (st.writers || []).filter((w) => w.connected !== false)
	const others = seated.filter((w) => w.id !== hostId)
	const readyOthers = others.filter((w) => ready.has(w.id)).length
	$("voteProgress").textContent =
		`${st.voted} of ${st.total} voted (pick as many as you like) · ${readyOthers} of ${others.length} ready` +
		(others.length === 0 ? " — you're the only one here" : "")
	$("readyList").innerHTML = seated
		.map(
			(w) =>
				`<li class="${ready.has(w.id) ? "is-ready" : ""}${w.id === hostId ? " is-host" : ""}" style="--c:${esc(w.color || "")}">` +
				`${miniAvatar(w)}<span class="rl-name">${esc(w.name)}</span>` +
				`<span class="rl-state">${w.id === hostId ? "👑 host" : ready.has(w.id) ? "✓ ready" : "voting…"}</span></li>`,
		)
		.join("")
	const meReady = myId != null && ready.has(myId)
	const rb = $("readyBtn")
	rb.textContent = meReady ? "✓ Ready — change my mind" : "✓ I'm ready"
	rb.classList.toggle("is-ready", meReady)
	rb.setAttribute("aria-pressed", meReady ? "true" : "false")
	// the host's own click on Start speaks for the host
	rb.classList.toggle("hidden", myId === hostId)
	const fb = $<HTMLButtonElement>("finalizeBtn")
	fb.disabled = !st.allReady
	fb.title = st.allReady ? "" : "Everyone needs to mark themselves ready first"
}
$("readyBtn").onclick = () => {
	const on = !$("readyBtn").classList.contains("is-ready")
	socket.emit("ready", { ready: on })
}

// ---- Prompt generation modes ----
// One component, two mounts: the lobby picks the mode before Begin
// (it rides along in start-game), the vote card retunes it live.
let promptMenus: PromptMenus | null = null
const lobbyPrompt = mountPromptModes($("lobbyPrompt"), { prefix: "lobbyPm" })
const votePrompt = mountPromptModes($("votePrompt"), {
	prefix: "votePm",
	onChange: ({ mode, controls }) => {
		myVotes = new Set()
		socket.emit("set-prompt-mode", { mode, controls })
	},
	// 🎲 deal four new options from the settings as they stand
	onReroll: () => {
		myVotes = new Set()
		socket.emit("shuffle-options")
	},
})
// The menus (ids + labels) are static data — fetched once per page.
;(async () => {
	try {
		promptMenus = (await (await fetch("/api/prompt-options")).json()) as PromptMenus
	} catch {
		promptMenus = { modes: ["simple"], intermediate: null }
	}
	lobbyPrompt.setMenus(promptMenus)
	votePrompt.setMenus(promptMenus)
})()

function renderPromptControls(st: GameState) {
	// Non-hosts see the ballot, not the dials that deal it.
	votePrompt.show(myId === hostId)
	votePrompt.setState(st.promptMode, st.promptControls)
}

$("reshuffleBtn").onclick = () => {
	myVotes = new Set()
	socket.emit("shuffle-options")
}
$("finalizeBtn").onclick = () =>
	socket.emit("finalize-vote", null, (res) => {
		if (res && !res.ok && res.error) $("voteProgress").textContent = res.error
	})
function addPrompt() {
	const v = input("customPrompt").value.trim()
	if (!v) return
	socket.emit("add-prompt", { prompt: v }, (res) => {
		if (res?.ok) input("customPrompt").value = ""
		else if (res?.error) {
			input("customPrompt").value = ""
			$("voteProgress").textContent = res.error
		}
	})
}
$("addPromptBtn").onclick = addPrompt
$("customPrompt").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault()
		addPrompt()
	}
})

// ---- Writing ----
let curColor: string = PALETTE[1]!,
	curName = "",
	lastTurnKey: string | null = null // detects real turn changes vs mid-turn re-broadcasts (e.g. rule updates)
function renderWriting(st: GameState) {
	onlyShow("game")
	$("gamePrompt").innerHTML = promptHtml(st.prompt)
	lineChime.note(st.story, myId)
	lineChime.setPrev(st.currentId)
	renderStory($("storyBox"), st.story, true)
	curColor = safeColor(st.currentColor)
	curName = st.currentName || ""
	const turnKey = st.turnCount + ":" + st.currentId
	const newTurn = turnKey !== lastTurnKey
	lastTurnKey = turnKey
	if (newTurn) {
		$("livePreview").classList.add("hidden")
		$("livePreview").innerHTML = "" // clear on new turn
	}
	const myTurn = st.currentId === myId,
		host = myId === hostId
	$("whoTurn").innerHTML = st.paused
		? "⏸ Host paused game…"
		: myTurn
			? "Your turn: write!"
			: `Waiting for ${statusDot(st.currentName)}${esc(st.currentName || "…")}`
	$("whoTurn").style.color = st.paused ? "var(--muted)" : myTurn ? "var(--good)" : "var(--ink)"
	$("myTurn").classList.toggle("hidden", !myTurn)
	// the alert persists across re-broadcasts; only a real turn change
	// shows it, and it clears the moment the turn is no longer mine.
	// Solo games skip it — every turn is yours, there's nothing to announce.
	if (!myTurn) turnAlert(false)
	else if (newTurn && !st.paused && (st.writers || []).length > 1) turnAlert(true)
	// One condition, three places: the drawer, the tab that opens it,
	// and the two live actions in the session bar.
	$("hostOpen").classList.toggle("hidden", !host)
	if (!host) closeHostModal() // lost the role mid-edit: the settings go away
	$("hostGame").classList.toggle("hidden", !host)
	liveRules.set(st)
	$("pauseBtn").textContent = st.paused ? "▶ Resume" : "⏸ Pause"
	$("progress").textContent =
		(st.maxTurns ? `Turn ${st.turnCount + 1} of ${st.maxTurns}` : `Turn ${st.turnCount + 1} · endless`) +
		(st.paused ? " · ⏸ paused by host" : "")
	const row = $("playersRow")
	// the row reads in TURN ORDER (writers and spectators alike): the
	// current writer marked, the next connected writer wearing "up next"
	const byId = new Map((st.writers || []).map((w) => [w.id, w]))
	const ordered = (st.turnOrder || []).map((id) => byId.get(id)).filter((w): w is RosterWriter => !!w)
	for (const w of st.writers || []) if (!ordered.includes(w)) ordered.push(w)
	const numbered = (st.turnOrder || []).length > 1
	row.innerHTML = ordered
		.map((w, i) => {
			const col = safeColor(w.color)
			const on = w.connected !== false
			const next = w.id === st.nextId && w.id !== st.currentId
			return (
				// four fixed columns, so every pill lines up: seat + presence ·
				// avatar + name (+ host) · words · the tail (next, ⋯)
				`<span class="player-chip${w.id === st.currentId ? " now" : ""}${next ? " next" : ""}" data-user="${esc(w.name)}">` +
				`<span class="chip-lead">` +
				(numbered ? `<b class="turn-no">${i + 1}</b>` : "") +
				presenceHtml(on) +
				`</span>` +
				`<span class="chip-who">` +
				miniAvatar(w) +
				`<span style="color:${col}">${esc(w.name)}</span>` +
				whoMarks(w) +
				`</span>` +
				`<span class="chip-words" title="Words in this story">${(w.words || 0).toLocaleString()}w</span>` +
				`<span class="chip-tail">` +
				(next ? `<em class="up-next">next</em>` : "") +
				seatMenuHtml(w, st.writers) +
				`</span>` +
				`</span>`
			)
		})
		.join("")
	const specs = st.spectators || 0
	$("specCount").textContent = specs ? `👁 ${specs} watching` : ""
	$("writerEditor").setAttribute("aria-disabled", st.paused ? "true" : "false")
	if (myTurn && !st.paused && newTurn) {
		const e = $("writerEditor")
		e.innerHTML = ""
		e.focus()
	}
	startTimer(st, myTurn)
}
let lastStory: StoryLine[] = []
function renderStory(box: HTMLElement, story: StoryLine[], animateNew: boolean) {
	lastStory = story
	box.innerHTML = storyHtml(story, { freshFrom: animateNew ? lastStoryLen : Infinity, mineId: me?.id })
	refreshStatusDots()
	lastStoryLen = story.length
	if (story.length) box.scrollTop = box.scrollHeight
}
// Inline editing of your own committed lines (✎ in the story feed).
// The server re-sanitizes and re-broadcasts, which redraws the feed.
function wireLineEdits(boxId: string) {
	const box = $(boxId)
	box.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLElement>(".line-edit")
		if (!btn) return
		const lineEl = btn.closest<HTMLElement>(".story-line")
		if (!lineEl || lineEl.querySelector(".line-editor")) return
		const idx = Number(lineEl.dataset.idx)
		if (btn.classList.contains("line-del")) {
			// two-tap confirm: first click arms the button, second deletes
			if (!btn.dataset.armed) {
				btn.dataset.armed = "1"
				btn.textContent = "Delete?"
				setTimeout(() => {
					btn.dataset.armed = ""
					btn.textContent = "✕"
				}, 2500)
				return
			}
			socket.emit("delete-line", { index: idx }, (res) => {
				if (!res?.ok) gameMsg(res?.error || "Could not delete the line.")
			})
			return
		}
		const orig = lastStory[idx]?.html || ""
		lineEl.innerHTML = ""
		const ed = document.createElement("div")
		ed.className = "editor line-editor"
		ed.contentEditable = "true"
		ed.innerHTML = orig // already server-sanitized
		const row = document.createElement("div")
		row.className = "row"
		const save = document.createElement("button")
		save.className = "primary"
		save.textContent = "Save line"
		const cancel = document.createElement("button")
		cancel.className = "ghost"
		cancel.textContent = "Cancel"
		row.append(save, cancel)
		lineEl.append(ed, row)
		ed.focus()
		cancel.onclick = () => renderStory(box, lastStory, false)
		save.onclick = () =>
			socket.emit("edit-line", { index: idx, text: cleanHtml(ed, { doc: true, urls: false }) }, (res) => {
				if (!res?.ok) {
					$("gameMsg") && gameMsg(res?.error || "Could not save the edit.")
					renderStory(box, lastStory, false)
				}
			})
	})
}
wireLineEdits("storyBox")
wireLineEdits("overStory")
function startTimer(st: GameState, myTurn: boolean) {
	clearInterval(tickInterval)
	const t = $("timer")
	const render = () => {
		const v = countdownView(st)
		t.textContent = v.text
		t.classList.toggle("paused", v.paused)
		t.classList.toggle("low", v.low)
		// the demogorgon stalks in behind the story only when time runs low
		$("doomFx").classList.toggle("on", v.low && !v.paused && !v.expired)
		// Vecna clock: everyone hears it while the demogorgon dances (the
		// last 10s of ANY turn), silent the instant the turn ends or pauses.
		if (shouldChime(v)) vecnaClock.start()
		else vecnaClock.stop()
		if (v.expired) {
			clearInterval(tickInterval)
			vecnaClock.stop()
			if (myTurn) submitLine()
		}
		return v
	}
	if (render().paused) return // frozen: no countdown, no auto-submit
	tickInterval = setInterval(render, 250)
}
function submitLine() {
	const html = cleanHtml($("writerEditor"), { doc: true, urls: false })
	$<HTMLButtonElement>("submitBtn").disabled = true
	socket.emit("submit-line", { text: html }, (res) => {
		$<HTMLButtonElement>("submitBtn").disabled = false
		if (res?.ok) playSound("outgoingline")
	})
}
$("submitBtn").onclick = submitLine
// The toolbar is the shared component: the game gets exactly the
// controls the solo editor has, minus the ones sanitizeRich would
// strip anyway (links, images). Live typing is broadcast on every
// change, so a format lands on the watchers' screens as it happens.
$("gameToolbar").innerHTML = toolbarHtml()
mountRichToolbar($("writerEditor"), $("gameToolbar"), {
	onEdit: () => $("writerEditor").dispatchEvent(new Event("input")),
})
// poking the (disabled) editor, any WYSIWYG toolbar button, the
// paragraph-style select, or Add line while paused earns
// 💩 Resume it, Stupid — the whole session gets the confetti.
const pausedPoke = () => {
	if (lastPaused) socket.emit("paused-poke")
}
;["writerEditor", "submitBtn", "blockFormat"].forEach((id) => $(id).addEventListener("click", pausedPoke))
$("gameToolbar").addEventListener("mousedown", pausedPoke)
$("writerEditor").addEventListener("keydown", (e) => {
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault()
		submitLine()
	}
})
// Broadcast what I'm typing so others watch live (debounced).
let typingTimer: ReturnType<typeof setTimeout> | undefined
$("writerEditor").addEventListener("input", () => {
	clearTimeout(typingTimer)
	typingTimer = setTimeout(() => socket.emit("typing", { text: cleanHtml($("writerEditor"), { doc: true, urls: false }) }), 140)
})
// I stole the turn: the victim's unsent line (server-sanitized, with
// the theft noted in italics) lands in my editor, caret at the end.
socket.on("steal-carry", ({ html }) => {
	const ed = $("writerEditor")
	if (!ed) return
	ed.innerHTML = html || ""
	try {
		const r = document.createRange()
		r.selectNodeContents(ed)
		r.collapse(false)
		const sel = window.getSelection()!
		sel.removeAllRanges()
		sel.addRange(r)
	} catch (e) {}
	ed.focus()
})
// Render another writer's live, in-progress line.
socket.on("live-typing", ({ html }) => {
	const box = $("livePreview")
	if (!html || !html.replace(/<[^>]+>/g, "").trim()) {
		box.classList.add("hidden")
		box.innerHTML = ""
		return
	}
	box.innerHTML = livePreviewHtml(html, curName, curColor)
	refreshStatusDots()
	box.classList.remove("hidden")
})
// The host's settings modal: the ⚙️ edge tab opens it, the ✕ in its
// corner, Escape or a click on the backdrop closes it. On a phone the
// card is the whole screen (base.css, .host-modal).
const hostModal = $("hostModal")
function openHostModal() {
	hostModal.classList.remove("hidden")
	$("hostClose").focus()
}
function closeHostModal() {
	if (hostModal.classList.contains("hidden")) return
	hostModal.classList.add("hidden")
	$("hostOpen").focus()
}
$("hostOpen").onclick = openHostModal
$("hostClose").onclick = closeHostModal
hostModal.addEventListener("click", (e) => e.target === hostModal && closeHostModal())
document.addEventListener("keydown", (e) => e.key === "Escape" && closeHostModal())
// ---- Invite a friend (Share ▾ menu) ----
async function loadInviteFriends() {
	const sel = $<HTMLSelectElement>("inviteFriend")
	try {
		const d = await authApi<{ friends?: { username: string; online?: boolean }[] }>("/api/friends", null, "GET")
		const friends = d.friends || []
		sel.innerHTML = friends.length
			? `<option value="">Pick a friend…</option>` +
				friends.map((f) => `<option value="${esc(f.username)}">${esc(f.username)}${f.online ? " · online" : ""}</option>`).join("")
			: `<option value="">No friends yet: add some from a profile</option>`
	} catch (e) {
		sel.innerHTML = `<option value="">Couldn't load friends</option>`
	}
}
if (me) loadInviteFriends()
$("inviteBtn").onclick = async () => {
	const who = $<HTMLSelectElement>("inviteFriend").value
	const note = $("inviteNote")
	if (!who || !myCode) return $("inviteShareMenu").classList.add("open")
	try {
		await authApi("/api/games/" + encodeURIComponent(myCode) + "/invite", { username: who })
		note.textContent = `✉ Invited ${who}: they'll get a note with the code${friendsOnline(who) ? " and a toast right now" : ""}.`
	} catch (e) {
		note.textContent = (e as Error).message
	}
	note.classList.remove("hidden")
	setTimeout(() => note.classList.add("hidden"), 5000)
}
// Share to Discord: the lobby has its own button under the code (that
// is when you gather writers); the host drawer's does the same later.
const shareToDiscord = (note: HTMLElement) => async () => {
	if (!myCode) return
	try {
		await authApi("/api/games/" + encodeURIComponent(myCode) + "/discord", {})
		note.textContent = "🎲 Shared to Discord with a Join button."
	} catch (e) {
		note.textContent = "✗ " + (e as Error).message
	}
	note.classList.remove("hidden")
	setTimeout(() => { note.classList.add("hidden"); note.textContent = "" }, 5000)
}
// Copy game link: the join URL for this code, next to the Discord share
// in the same Share ▾ menu (lobby and host side column alike).
const copyGameLink = (note: HTMLElement) => async () => {
	if (!myCode) return
	const url = location.origin + "/game?code=" + encodeURIComponent(myCode)
	note.textContent = (await copyText(url)) ? "🔗 Link copied." : "✗ Couldn't copy — the link is " + url
	note.classList.remove("hidden")
	setTimeout(() => { note.classList.add("hidden"); note.textContent = "" }, 5000)
}
$("discordShareBtn").onclick = shareToDiscord($("inviteNote"))
$("discordLobbyBtn").onclick = shareToDiscord($("lobbyShareNote"))
$("inviteShareMenu").querySelector<HTMLElement>('[data-share="link"]')!.onclick = copyGameLink($("inviteNote"))
$("lobbyShareMenu").querySelector<HTMLElement>('[data-share="link"]')!.onclick = copyGameLink($("lobbyShareNote"))
const friendsOnline = (_name: string) => /· online$/.test($<HTMLSelectElement>("inviteFriend").selectedOptions[0]?.textContent || "")

$("pauseBtn").onclick = () =>
	socket.emit(($("pauseBtn").textContent || "").includes("Resume") ? "resume-game" : "pause-game")
$("endBtn").onclick = () => socket.emit("end-game")
$("applyRulesBtn").onclick = () => {
	const btn = $("applyRulesBtn")
	const v = liveRules.values()
	socket.emit(
		"update-rules",
		{
			turnSeconds: v.turnSeconds,
			addRounds: liveRules.infinite() ? 0 : v.rounds || 0,
			endless: liveRules.infinite() || undefined,
			friendly: v.friendly,
		},
		(res) => {
			liveRules.el.rounds.value = ""
			btn.textContent = res?.ok ? "Applied ✓" : "Host only"
			setTimeout(() => (btn.textContent = "Apply"), 1500)
		},
	)
}

// ---- Game over ----
// The reveal's scoreboard: the server's `scoreboard` (every account
// with words in the story, continued games and expired seats included)
// when it sends one; else only a non-friendly game's roster carries
// `words`, so a friendly game renders nothing here.
function scoreboardHtml(writers: (ScoreRow | RosterWriter)[]) {
	const rows = (writers || []).filter((w) => w.words != null)
	if (!rows.length) return ""
	rows.sort((a, b) => b.words - a.words)
	const top = rows[0]!.words
	return (
		`<b class="sb-title">🏆 Scoreboard</b>` +
		rows
			.map(
				(w, i) =>
					`<span class="sb-row${i === 0 && top > 0 ? " lead" : ""}">` +
					`<b class="sb-rank">${i + 1}</b>${miniAvatar(w)}<span style="color:${safeColor(w.color)}">${esc(w.name)}</span>` +
					`<span class="sb-words">${w.words.toLocaleString()} words</span></span>`,
			)
			.join("")
	)
}
socket.on("game-over", ({ prompt, story, scoreboard }) => {
	clearInterval(tickInterval)
	vecnaClock.stop()
	turnAlert(false)
	lineChime.note(story, myId)
	onlyShow("over")
	$("overScore").innerHTML = scoreboardHtml(Array.isArray(scoreboard) ? scoreboard : tableWriters)
	$("overScore").classList.toggle("hidden", !$("overScore").innerHTML)
	$("overPrompt").innerHTML = promptHtml(prompt)
	renderStory($("overStory"), story, false)
	rebuildExports(prompt, story)
	updateHostView()
	updateSessionBar()
	refreshChip() // word count / badge may have changed
	// tag the finished story (writers only — spectators' fetch 403s and
	// the container just stays empty). The block rides INSIDE the
	// rules-form panel — moved here because mountRulesForm() wiped
	// that container's html at page init.
	if ($("overTags").parentElement !== $("contRules")) $("contRules").appendChild($("overTags"))
	$("overTags").innerHTML = ""
	authApi<{ tags?: string[] }>("/api/games/" + encodeURIComponent(myCode), null, "GET")
		.then((g) =>
			mountTagEditor($("overTags"), {
				tags: g.tags || [],
				onSave: (tags) =>
					authApi("/api/games/" + encodeURIComponent(myCode) + "/tags", { tags }).catch(() => {}),
			}),
		)
		.catch(() => {})
})
$("continueBtn").onclick = () =>
	socket.emit("continue-writing", contRules.values(), (res) => {
		if (!res?.ok) alert("Could not continue: the host is here and only they can, or nobody is seated.")
	})
// Share / Download ▾ (components/export-menu.js): copy as rich text, .html, .pdf,
// each line signed with its writer or prose only.
let overStory: { prompt: string; story: StoryLine[] } = { prompt: "", story: [] }
function rebuildExports(prompt: string, story: StoryLine[]) {
	overStory = { prompt, story }
}
mountExportMenu($("overExport"), { prefix: "over", source: () => ({ ...overStory, code: myCode }) })
$("dashBtn").onclick = () => {
	clearRejoin() // otherwise /game auto-rejoins straight back here
	location.href = "/dashboard"
}

// ---- The host deleted this story ----
// The story went to sleep (30 idle minutes, or the host from the
// dashboard): snapshot on disk, session gone. The next visit wakes it.
socket.on("game-slept", ({ code, name, by }) => {
	clearInterval(tickInterval)
	vecnaClock.stop()
	turnAlert(false)
	onlyShow("none")
	hide("chatCard")
	gameMsg(`💤 “${name || code}” went to sleep${by ? `, ${by} tucked it in` : ", nobody's written for a while"}. Wake it up from the dashboard, or reload to pick it back up.`)
})
socket.on("game-deleted", () => {
	clearRejoin()
	clearInterval(tickInterval)
	vecnaClock.stop()
	turnAlert(false)
	onlyShow("none") // hide every phase card
	hide("chatCard")
	gameMsg("The host deleted this story.")
})

// ---- Badge unlock: centered pop + confetti bursting from behind it,
// falling down the page (GSAP; without it the card alone shows) ----
const reduceFx = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
socket.on("badge-earned", ({ badge, desc, name, unlocks, themes, gimmicks: myGimmicks }) => {
	const el = document.createElement("div")
	el.className = "badge-pop"
	const title = document.createElement("b")
	const mine = name && me?.username === name
	title.textContent = mine || !name ? `🎉 Badge unlocked: ${badge}` : `🎉 ${name} unlocked: ${badge}`
	const sub = document.createElement("span")
	sub.textContent = desc || ""
	el.append(title, sub)
	// A rank-up hands out more than a badge: name the themes and
	// gimmicks it opened, and open them right now for the writer.
	const rewards = [
		...(unlocks?.themes || []).map((t) => `🎨 ${t.name}`),
		...(unlocks?.gimmicks || []).map((g) => `✨ ${g.name}`),
	]
	if (rewards.length) {
		const line = document.createElement("span")
		line.className = "badge-unlocks"
		line.textContent = (mine ? "You unlocked: " : "Unlocked: ") + rewards.join(" · ")
		el.append(line)
	}
	if (mine && themes) regateThemes(themes)
	if (mine && myGimmicks) gimmicks.setGate({ unlocked: myGimmicks })
	document.body.appendChild(el)
	playSound("incomingmessage")
	const g = window.gsap
	if (g && !reduceFx) {
		g.fromTo(el, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(2)" })
		g.to(el, { opacity: 0, scale: 0.85, duration: 0.5, delay: 4.6, ease: "power2.in", onComplete: () => el.remove() })
		// confetti: burst outward from behind the card, then rain down
		const hues = ["#ff3ea5", "#22d3ee", "#ffd23f", "#37e0a0", "#b45cff", "#ff7a3d"]
		for (let i = 0; i < 44; i++) {
			const c = document.createElement("i")
			c.className = "confetti"
			c.style.background = hues[i % hues.length]!
			if (i % 3 === 0) c.style.borderRadius = "50%"
			document.body.appendChild(c)
			const ang = Math.random() * Math.PI * 2
			const burst = 90 + Math.random() * 220
			g.set(c, { left: "50%", top: "42%", xPercent: -50, yPercent: -50, rotation: Math.random() * 360 })
			const tl = g.timeline({ onComplete: () => c.remove() })
			tl.to(c, {
				x: Math.cos(ang) * burst,
				y: Math.sin(ang) * burst * 0.7,
				opacity: 1,
				duration: 0.5 + Math.random() * 0.25,
				ease: "power3.out",
			}).to(c, {
				y: "+=" + (innerHeight * 0.8 + Math.random() * innerHeight * 0.3),
				x: "+=" + (Math.random() * 160 - 80),
				rotation: "+=" + (Math.random() * 540 - 270),
				opacity: 0,
				duration: 2.4 + Math.random() * 1.6,
				ease: "power1.in",
			})
		}
	} else {
		el.style.opacity = "1"
		setTimeout(() => el.remove(), 5200)
	}
})

// ---- Gated join: approval outcomes + the host's request popups ----
socket.on("join-approved", (res) => {
	gameMsg("")
	enterSession(res)
})
socket.on("join-denied", () => {
	gameMsg("The host declined to let you in.")
})
socket.on("join-request", ({ id, name, returning }) => {
	// the server replays open requests on host churn — never stack dupes
	if (document.querySelector(`[data-req-id="${id}"]`)) return
	const row = document.createElement("div")
	row.className = "join-req"
	row.dataset.reqId = id
	row.innerHTML = `<span><b>${esc(name)}</b> wants to ${returning ? "rejoin" : "join"} the story</span>`
	const yes = document.createElement("button")
	yes.className = "primary"
	yes.textContent = "Let in"
	const no = document.createElement("button")
	no.className = "ghost"
	no.textContent = "Deny"
	yes.onclick = () => socket.emit("approve-join", { id, allow: true }, () => row.remove())
	no.onclick = () => socket.emit("approve-join", { id, allow: false }, () => row.remove())
	row.append(yes, no)
	$("joinReqs").appendChild(row)
	playSound("incomingmessage")
})
socket.on("join-request-cancel", ({ id }) => {
	document.querySelector(`[data-req-id="${id}"]`)?.remove()
})

// ---- Writer stat tooltip: hover a name (roster / players row) to
// inspect their all-time word count + achievements in a column ----
const statCache = new Map<string, Profile>()
const tipEl = document.createElement("div")
tipEl.className = "stat-tip hidden"
document.body.appendChild(tipEl)
let tipFor: string | null = null
async function showStatTip(name: string, x: number, y: number) {
	if (!getToken()) return // spectators can't read the users API
	tipFor = name
	let p = statCache.get(name)
	if (!p) {
		try {
			p = (await authApi<{ user?: Profile }>("/api/users/" + encodeURIComponent(name), null, "GET")).user
		} catch (e) {
			return
		}
		if (!p) return
		statCache.set(name, p)
	}
	if (tipFor !== name) return // hover moved on while we fetched
	const badges = (p.wordBadges || []).concat(p.usageBadges || [])
	tipEl.innerHTML =
		`<b style="color:${safeColor(p.color)}">${esc(p.username)}</b>` +
		`<span class="tt-words">✍ ${(p.wordCount || 0).toLocaleString()} words all-time</span>` +
		`<span class="tt-h">Achievements</span>` +
		(badges.map((b) => `<span class="tt-badge">${esc(b)}</span>`).join("") ||
			'<span class="tt-badge">none yet</span>')
	tipEl.classList.remove("hidden")
	tipEl.style.left = Math.min(x + 14, innerWidth - 240) + "px"
	tipEl.style.top = Math.min(y + 14, innerHeight - tipEl.offsetHeight - 12) + "px"
}
document.addEventListener("mouseover", (e) => {
	const t = (e.target as HTMLElement).closest?.<HTMLElement>("[data-user]")
	if (t) showStatTip(t.dataset.user || "", e.clientX, e.clientY)
})
document.addEventListener("mouseout", (e) => {
	if ((e.target as HTMLElement).closest?.("[data-user]")) {
		tipFor = null
		tipEl.classList.add("hidden")
	}
})
// clicking a writer opens their profile in a new tab
document.addEventListener("click", (e) => {
	const t = (e.target as HTMLElement).closest?.<HTMLElement>("[data-user]")
	if (t) window.open("/profile?user=" + encodeURIComponent(t.dataset.user || ""), "_blank", "noopener")
})

// ---- Chat: one channel for the whole table ----
// Writers speak from their seat, spectators under their own name
// (marked 👁); everyone sees every line.
const rowReactions = new Map<string, Reactions | undefined>() // mid -> reactions (for the picker's `.on` marks)
function addChat(m: ChatMessage, silent?: boolean) {
	// spectators have no seat id — their own echo matches by socket id
	// a system line that asks to ring (the dice gimmick's natural 20)
	// plays under the gimmick sound pref, not the chat one
	if (!silent && shouldChimeChat(m, spectateCode ? socket.id ?? null : myId)) playSound("incomingmessage", m.sys ? "gimmick" : undefined)
	const log = $("chatLog")
	const p = document.createElement("p")
	const spec = "spec" in m && m.spec
	p.className = (m.sys ? "msg sys" : "msg") + (spec ? " spec-msg" : "")
	p.innerHTML = (spec ? "👁 " : "") + chatMessageHtml(m)
	// reactions: only on a person's message (system lines have no mid)
	if ("mid" in m && m.mid) {
		rowReactions.set(m.mid, m.reactions)
		p.dataset.mid = m.mid
		p.insertAdjacentHTML("beforeend", `<span class="reacts">${reactionsHtml(m.reactions, myReactKey())}</span><button type="button" class="react-add" title="Add a reaction" aria-label="Add a reaction"><i class="fa-regular fa-face-smile"></i></button>`)
	}
	log.appendChild(p)
	refreshStatusDots()
	log.scrollTop = log.scrollHeight
}
// Reactions — who I am on a chip: writers by account, spectators by socket
const myReactKey = (): string | null | undefined => (spectateCode ? socket.id : me?.id)
function paintReactions(mid: string, reactions: Reactions | undefined) {
	rowReactions.set(mid, reactions)
	const row = $("chatLog").querySelector(`[data-mid="${mid}"] .reacts`)
	if (row) row.innerHTML = reactionsHtml(reactions, myReactKey())
}
socket.on("chat-react", ({ mid, reactions }) => paintReactions(mid, reactions))
function react(mid: string, emoji: string) {
	socket.emit("chat-react", { mid, emoji, name: spectateCode ? getSpectatorName() : undefined }, (r) => {
		if (r?.ok) paintReactions(mid, r.reactions)
	})
}
// the floating picker is shared with the solo editor's comment threads
const picker = createReactionPicker({ reactionsOf: (mid) => rowReactions.get(mid), myKey: myReactKey, onPick: react })
$("chatLog").addEventListener("click", (e) => {
	const t = e.target as HTMLElement
	const chip = t.closest?.<HTMLElement>("[data-react]")
	const row = t.closest?.<HTMLElement>("[data-mid]")
	if (chip && row) return react(row.dataset.mid || "", chip.dataset.react || "")
	const add = t.closest?.<HTMLElement>(".react-add")
	if (add && row) return picker.toggle(add, row.dataset.mid || "")
})
socket.on("chat-history", (msgs) => {
	$("chatLog").innerHTML = ""
	rowReactions.clear()
	;(msgs || []).forEach((m) => addChat(m, true)) // history replay is silent
})
socket.on("chat", (m) => addChat(m))
function sendChat() {
	const v = input("chatInput").value.trim()
	if (!v) return
	socket.emit("chat", { text: v, name: spectateCode ? getSpectatorName() : undefined })
	playSound("outgoingmessage")
	input("chatInput").value = ""
}
$("chatSend").onclick = sendChat
$("chatInput").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault()
		sendChat()
	}
})
