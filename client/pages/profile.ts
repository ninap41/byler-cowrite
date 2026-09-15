import { api } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { safeColor, siteName } from "/js/util.js"
import { streakRingHtml } from "/js/dashboard-view.js"
import { ladderAccordionHtml, usageCaseHtml, aboutHtml, avatarHtml } from "/js/profile-view.js"
import { soloListHtml, betaReadingHtml, wireSoloDeletes, sprintListHtml, wireSprintDeletes } from "/js/write-view.js"
import type { ChipUser } from "/js/chrome.js"
import type { WordTier, UsageBadge, LadderUser, AboutProfile } from "/js/profile-view.js"
import type { DocSummary, Sprint } from "/js/write-view.js"

/** GET /api/achievements — the catalogue the ladder and the badge cases read. */
interface Achievements {
	wordTiers: WordTier[]
	usage: UsageBadge[]
	usageOpen?: UsageBadge[]
}
/** A public profile, as profileOf() ships it (never email or id). */
interface Profile extends LadderUser, AboutProfile {
	username: string
	color?: string
	avatar?: string | null
	avatarFit?: string | null
	online?: boolean
	badges: string[]
	usageBadges: string[]
	openBadges?: string[]
	badgeDescs?: Record<string, string | null | undefined>
	nextBadge?: { name: string; min: number } | null
	stories: number
	sprintWords?: number
	sprintCount?: number
	streak: number
	bestStreak: number
}
/** A story on a profile: hosted or contributed, live while `inProgress`. */
interface ProfileStory {
	code: string
	name?: string
	phase?: string
	lines: number
	inProgress?: boolean
	mine?: boolean
}
type FriendState = { state: "self" | "none" | "outgoing" | "incoming" | "friends"; requestId?: string }
interface ProfilePayload {
	user: Profile
	hosted?: ProfileStory[]
	contributed?: ProfileStory[]
	writes?: DocSummary[]
	sprints?: Sprint[]
	lastLine?: { text?: string; name?: string; code?: string } | null
	friendState?: FriendState
}

mountChrome({ page: "profile" })
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const me = await requireAuth<ChipUser>("/")
if (me) {
	setUserChip(me)
	// my own solo writes can be deleted from here (two clicks)
	wireSoloDeletes($("writesList"), (id) => api("/api/docs/" + encodeURIComponent(id || ""), null, "DELETE"))
	// my own sprints can be deleted from here (two clicks)
	wireSprintDeletes($("sprintList"), (at) => api("/api/account/sprints/" + encodeURIComponent(at || ""), null, "DELETE"))
	const meta = await api<Achievements>("/api/achievements", null, "GET")
	const wanted = new URLSearchParams(location.search).get("user")
	// whose profile? mine by default, anyone else's via ?user=name.
	// Always hit the profile endpoint — it also carries hosted stories.
	let loaded: Profile | null = null
	let hosted: ProfileStory[] = []
	let contributed: ProfileStory[] = []
	let writes: DocSummary[] = []
	let sprints: Sprint[] = []
	let lastLine: ProfilePayload["lastLine"] = null
	let friendState: FriendState = { state: "self" }
	const who = wanted || me.username
	const itsMe = who.toLowerCase() === me.username.toLowerCase()
	try {
		const r = await api<ProfilePayload>("/api/users/" + encodeURIComponent(who), null, "GET")
		loaded = r.user
		hosted = r.hosted || []
		writes = r.writes || []
		sprints = r.sprints || []
		contributed = r.contributed || []
		lastLine = r.lastLine || null
		friendState = r.friendState || friendState
		if (itsMe) loaded = { ...loaded, online: true }
	} catch (e) {
		$("profErr").textContent = (e as Error).message
	}
	if (loaded) {
		const p = loaded // a const, so the closures below keep the narrowing
		document.title = `${siteName()}: ${p.username}`
		$("meName").textContent = p.username
		$("meName").style.color = safeColor(p.color)
		$("meBadge").textContent = p.currentBadge || "no badge yet"
		$("avatar").innerHTML = avatarHtml(p)
		$("avatar").style.background = safeColor(p.color)
		$("onlineChip").classList.toggle("hidden", itsMe || !p.online)
		$("profileSub").textContent = p.nextBadge
			? `${(p.nextBadge.min - p.wordCount).toLocaleString()} words to ${p.nextBadge.name}`
			: "Top of the ladder, a true legend."
		// their newest committed story line, typed out character by character
		if (lastLine?.text) {
			$("lastLineBox").classList.remove("hidden")
			$("lastLineMeta").textContent = `, their last line, from “${lastLine.name || lastLine.code}”`
			const full = `“${lastLine.text}”`
			const el = $("lastLineText")
			const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
			// hidden tabs throttle rAF, which would freeze the tween at zero
			if (window.gsap && !reduce && document.visibilityState === "visible") {
				const state = { n: 0 }
				gsap.to(state, {
					n: full.length,
					duration: Math.min(4, 0.8 + full.length * 0.035),
					ease: "none",
					delay: 0.5,
					onUpdate: () => (el.textContent = full.slice(0, Math.round(state.n))),
					onComplete: () => document.querySelector(".type-caret")?.classList.add("done"),
				})
			} else {
				el.textContent = full
				document.querySelector(".type-caret")?.classList.add("done")
			}
		}
		// Add-friend button: none → send request · outgoing → sent ·
		// incoming → accept right here · friends → click to unfriend.
		const friendBtn = $<HTMLButtonElement>("friendBtn")
		function renderFriendBtn() {
			friendBtn.classList.toggle("hidden", friendState.state === "self")
			friendBtn.disabled = friendState.state === "outgoing"
			const labels: Record<string, string> = {
				none: "➕ Add friend",
				outgoing: "Request sent ✓",
				incoming: "Accept friend request",
				friends: "✓ Friends",
			}
			friendBtn.textContent = labels[friendState.state] || ""
			friendBtn.title = friendState.state === "friends" ? "Click to unfriend" : ""
		}
		friendBtn.onclick = async () => {
			try {
				if (friendState.state === "none") {
					await api("/api/friends/request", { username: p.username })
					friendState = { state: "outgoing" }
				} else if (friendState.state === "incoming") {
					await api("/api/friends/respond", { id: friendState.requestId, accept: true })
					friendState = { state: "friends" }
				} else if (friendState.state === "friends") {
					if (!confirm(`Unfriend ${p.username}?`)) return
					await api("/api/friends/" + encodeURIComponent(p.username), null, "DELETE")
					friendState = { state: "none" }
				}
			} catch (e) {
				$("profErr").textContent = (e as Error).message
			}
			renderFriendBtn()
		}
		renderFriendBtn()
		// Message: opens a small composer that posts a note into their inbox
		const msgBtn = $("msgBtn")
		msgBtn.classList.toggle("hidden", itsMe)
		msgBtn.onclick = () => {
			$("msgTitle").textContent = `Message ${p.username}`
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
				await api("/api/message", { username: p.username, text })
				$("msgErr").textContent = ""
				$("msgOk").classList.remove("hidden")
				$<HTMLTextAreaElement>("msgText").value = ""
				setTimeout(closeMsg, 900)
			} catch (e) {
				$("msgErr").textContent = (e as Error).message
			}
			$<HTMLButtonElement>("msgSend").disabled = false
		}
		$("msgText").addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("msgSend").click()
			if (e.key === "Escape") closeMsg()
		})
		$("statWords").textContent = p.wordCount.toLocaleString()
		$("statBadges").textContent = String(p.badges.length)
		$("statStories").textContent = String(p.stories)
		$("aboutBox").innerHTML = aboutHtml(p)
		$("aboutEditHint").classList.toggle("hidden", !itsMe)
		$("ladder").innerHTML = ladderAccordionHtml(meta.wordTiers, p)
		// story lists: rows glow while the story is live in progress
		// only the 3 most recent show here; "See all" goes to the full page
		const renderStories = (boxId: string, fullList: ProfileStory[], emptyMsg: string) => {
			const box = $(boxId)
			box.innerHTML = ""
			if (!fullList.length) {
				box.innerHTML = `<p class="subtle" style="text-align:left;margin:0">${emptyMsg}</p>`
				return
			}
			const list = fullList.slice(0, 3)
			list.forEach((g) => {
				const row = document.createElement("div")
				row.className = "live-game" + (g.inProgress ? " gathering" : "")
				const info = document.createElement("span")
				info.className = "lg-info"
				const b = document.createElement("b")
				b.textContent = g.name || g.code
				const sub = document.createElement("span")
				sub.className = "lg-sub"
				sub.textContent =
					`${g.code} · ${g.inProgress ? "✨ in progress" : g.phase === "over" ? "finished" : "paused"}` +
					` · ${g.lines} line${g.lines === 1 ? "" : "s"}`
				info.append(b, sub)
				const btn = document.createElement("button")
				btn.className = "ghost"
				btn.textContent = g.inProgress ? "Join" : "Open"
				btn.onclick = () =>
					// my own stories open in the archive (export, write more); anyone
					// else's open in the read-only story view — never their archive
					(location.href =
						(g.inProgress ? "/game?code=" : g.mine ? "/archive?code=" : "/stories?code=") +
						encodeURIComponent(g.code))
				row.append(info, btn)
				box.appendChild(row)
			})
			if (fullList.length > 3) {
				const more = document.createElement("p")
				more.className = "subtle"
				more.style.cssText = "text-align:left;margin:10px 0 0"
				const a = document.createElement("a")
				a.className = "linky"
				a.href = "/stories?user=" + encodeURIComponent(p.username)
				a.textContent = `See all ${p.username}'s stories →`
				more.appendChild(a)
				box.appendChild(more)
			}
		}
		renderStories("hostedList", hosted, "No hosted stories yet.")
		renderStories("contribList", contributed, "No contributed stories yet.")
		$("statSprints").textContent = (p.sprintWords || 0).toLocaleString()
		$("sprintList").innerHTML = sprintListHtml(sprints, { total: p.sprintWords || 0, count: p.sprintCount || 0, mine: itsMe })
		$("writesList").innerHTML = soloListHtml(writes, { empty: "No solo writes yet.", limit: 5 })
		// on my own profile, the fics I beta read for others get their
		// own grouped card — never mixed into the writes above
		if (itsMe) {
			try {
				const dd = await api<{ docs?: DocSummary[] }>("/api/docs", null, "GET")
				const betaHtml = betaReadingHtml(dd.docs || [])
				$("betaReadList").innerHTML = betaHtml
				$("betaReadCard").classList.toggle("hidden", !betaHtml)
			} catch (e) {}
		}
		if (writes.length > 5) {
			const more = document.createElement("p")
			more.className = "subtle"
			more.style.cssText = "text-align:left;margin:10px 0 0"
			more.innerHTML = `<a class="linky" href="/stories?user=${encodeURIComponent(p.username)}">See all ${writes.length} →</a>`
			$("writesList").appendChild(more)
		}
		$("openCase").innerHTML = usageCaseHtml(meta.usageOpen || [], p.openBadges || [], p.badgeDescs || {}, { secret: false })
		$("usageCase").innerHTML = usageCaseHtml(meta.usage, p.usageBadges, p.badgeDescs || {})
		$("streakBox").innerHTML =
			streakRingHtml(p.streak, Math.max(p.bestStreak, 1)) +
			`<div class="streak-meta"><b>${p.streak} day${p.streak === 1 ? "" : "s"}</b> current streak<br>Best: ${p.bestStreak} day${p.bestStreak === 1 ? "" : "s"}</div>`
	}
}
