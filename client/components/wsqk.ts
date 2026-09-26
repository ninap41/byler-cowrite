// WSQK, the table's shared radio: a tiny Hawkins-station HUD under the chat
// that plays the host's YouTube playlist for everyone at once.
//
// Who owns what (docs/notes/GAME.md "WSQK radio"):
// - The SERVER owns the station: which playlist, which track, playing or
//   paused, and the anchor (position at `updatedAt`). It arrives as
//   `radio-state`, on every change and replayed on entry.
// - EVERY listener's own YouTube player walks the playlist by itself; on each
//   `radio-state` it only checks itself against the anchor (wrong track →
//   jump; drifted past SEEK_TOLERANCE_MS → seek) — so a table stays together
//   without anyone chattering.
// - Only the HOST's player is the CONDUCTOR: it reports a new track (or a
//   same-track re-anchor when it buffered) with `radio-track`, and its ⏯/⏭
//   send `radio-play` / `radio-pause` / a local nextVideo.
// - Volume, mute, folded, and the power switch are YOURS: localStorage
//   (`cowriteRadio`), never on a socket. Power OFF destroys your player
//   (no decode cost), not just mutes it.
//
// Two things the DOM forces: the player iframe lives in `#radioHost` on
// <body> and never inside the card (placeChat moves the card between phases,
// and a moved iframe reloads mid-song); and a phone never gets a player at
// all (no autoplay, real memory cost) — it gets the station's info and a link
// to the playlist on YouTube instead.
import { esc } from "../util.js"
import type { StorageLike } from "../spectator-names.js"
import type { RadioState } from "../shared/wire.js"
import type { SocketLike } from "./gimmick-types.js"
import { OFF_AIR, expectedPositionMs, needsSeek, playlistUrl, REANCHOR_DRIFT_MS, REANCHOR_COOLDOWN_MS } from "../shared/radio.js"

// ---- listener prefs ----
export const PREFS_KEY = "cowriteRadio"
export interface RadioPrefs {
	/** 0..100 */
	volume: number
	muted: boolean
	/** the HUD folded to its header */
	collapsed: boolean
	/** the player destroyed for this listener: no decode, no sound */
	off: boolean
}
export const DEFAULT_PREFS: RadioPrefs = { volume: 35, muted: false, collapsed: false, off: false }
const clampVol = (v: unknown): number => {
	const n = Math.round(Number(v))
	return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_PREFS.volume
}
const cleanPrefs = (v: Partial<RadioPrefs> | null | undefined): RadioPrefs => ({
	volume: clampVol(v?.volume ?? DEFAULT_PREFS.volume),
	muted: v?.muted === true,
	collapsed: v?.collapsed === true,
	off: v?.off === true,
})
export function loadRadioPrefs(storage: StorageLike | null = globalThis.localStorage ?? null): RadioPrefs {
	try {
		return cleanPrefs(JSON.parse(storage?.getItem(PREFS_KEY) || "null") as Partial<RadioPrefs> | null)
	} catch {
		return { ...DEFAULT_PREFS }
	}
}
export function saveRadioPrefs(prefs: Partial<RadioPrefs>, storage: StorageLike | null = globalThis.localStorage ?? null): RadioPrefs {
	const out = cleanPrefs(prefs)
	try {
		storage?.setItem(PREFS_KEY, JSON.stringify(out))
	} catch {
		/* private mode: the preference just won't persist */
	}
	return out
}

// ---- the slice of the YouTube IFrame API this module drives (injectable) ----
export const YT_UNSTARTED = -1, YT_ENDED = 0, YT_PLAYING = 1, YT_PAUSED = 2, YT_BUFFERING = 3, YT_CUED = 5
export interface YTPlayer {
	playVideo(): void
	pauseVideo(): void
	nextVideo(): void
	previousVideo(): void
	playVideoAt(index: number): void
	seekTo(seconds: number, allowSeekAhead: boolean): void
	loadPlaylist(o: { list: string; listType: "playlist"; index?: number }): void
	mute(): void
	unMute(): void
	isMuted(): boolean
	setVolume(v: number): void
	getCurrentTime(): number
	getPlayerState(): number
	getPlaylistIndex(): number
	getVideoData(): { video_id?: string; title?: string } | undefined
	destroy(): void
}
export interface YTPlayerEvents {
	onReady?(): void
	onStateChange?(e: { data: number }): void
	onError?(e: { data: number }): void
}
export interface YTPlayerOptions {
	width?: number | string
	height?: number | string
	playerVars?: Record<string, string | number>
	events?: YTPlayerEvents
}
export interface YTNamespace {
	Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer
}
declare global {
	interface Window {
		YT?: YTNamespace
		onYouTubeIframeAPIReady?: () => void
	}
}
export const YT_API_SRC = "https://www.youtube.com/iframe_api"
export const YT_API_TIMEOUT_MS = 5000
let apiPromise: Promise<YTNamespace> | null = null
/** Load YouTube's iframe API once, on first need; rejects when it never answers (an ad-blocker, offline). */
export function loadYouTubeApi(doc: Document = document, win: Window = window): Promise<YTNamespace> {
	if (win.YT?.Player) return Promise.resolve(win.YT)
	if (apiPromise) return apiPromise
	apiPromise = new Promise<YTNamespace>((resolve, reject) => {
		const timer = setTimeout(() => {
			apiPromise = null
			reject(new Error("YouTube API did not load"))
		}, YT_API_TIMEOUT_MS)
		const prev = win.onYouTubeIframeAPIReady
		win.onYouTubeIframeAPIReady = () => {
			clearTimeout(timer)
			prev?.()
			if (win.YT?.Player) resolve(win.YT)
			else reject(new Error("YouTube API loaded without a Player"))
		}
		const s = doc.createElement("script")
		s.src = YT_API_SRC
		s.async = true
		s.onerror = () => {
			clearTimeout(timer)
			apiPromise = null
			reject(new Error("YouTube API failed to load"))
		}
		doc.head.appendChild(s)
	})
	return apiPromise
}

/** A phone: coarse pointer AND the page's one-column width (base.css 760px). */
export const detectPhone = (win: Window = window): boolean =>
	!!win.matchMedia && win.matchMedia("(pointer: coarse)").matches && win.innerWidth < 760

// ---- markup ----
const ico = (name: string) => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`
/** The card's inner markup (the card itself, #radioCard, is in game.html so placeChat can carry it). */
export const hudHtml = () => `<div class="radio-head">
	<button type="button" class="radio-fold" data-act="fold" aria-expanded="true" title="Fold the radio">${ico("chevron-down")}</button>
	<span class="radio-call" aria-label="WSQK radio">WSQK</span>
	<span class="radio-band">88.3 FM · Hawkins</span>
	<span class="radio-signal" aria-hidden="true"><i></i><i></i><i></i></span>
</div>
<div class="radio-body">
	<div class="radio-dial">
		<span class="radio-list" data-el="list"></span>
		<span class="radio-track" data-el="track"></span>
	</div>
	<div class="radio-ctl" data-el="ctl">
		<button type="button" class="ghost radio-btn radio-host" data-act="back" title="Previous track for the whole table">${ico("backward-step")}</button>
		<button type="button" class="ghost radio-btn radio-host" data-act="toggle" title="Play / pause for the whole table">${ico("play")}</button>
		<button type="button" class="ghost radio-btn radio-host" data-act="skip" title="Next track for the whole table">${ico("forward-step")}</button>
		<button type="button" class="ghost radio-btn" data-act="mute" title="Mute (only for you)">${ico("volume-high")}</button>
		<input type="range" class="radio-vol" data-act="vol" min="0" max="100" step="1" aria-label="Volume (only for you)" />
		<button type="button" class="ghost radio-btn" data-act="power" title="Switch the radio off (only for you)">${ico("power-off")}</button>
	</div>
	<div class="radio-note" data-el="note"></div>
</div>`

// ---- the component ----
export interface WsqkOpts {
	socket: Pick<SocketLike, "emit">
	/** #radioCard — the visible HUD, carried with the chat */
	card: HTMLElement
	/** #radioHost — a fixed, never-moved element on <body> the player renders into */
	host: HTMLElement
	storage?: StorageLike | null
	document?: Document
	isPhone?: boolean
	/** injectable API loader (tests hand in a fake) */
	loadApi?: () => Promise<YTNamespace>
	now?: () => number
	/** the host's tag under the station: where to find the station field */
	onTune?: () => void
}
export interface Wsqk {
	/** a `radio-state` arrived */
	set(state: RadioState): void
	/** the seat's role changed: only the host conducts */
	setHost(amHost: boolean): void
	readonly state: RadioState
	readonly prefs: RadioPrefs
	readonly amHost: boolean
	readonly player: YTPlayer | null
	readonly phone: boolean
	destroy(): void
}

export function mountWsqk(opts: WsqkOpts): Wsqk {
	const doc = opts.document ?? document
	const win = doc.defaultView ?? window
	const storage = opts.storage === undefined ? (globalThis.localStorage ?? null) : opts.storage
	const now = opts.now ?? (() => Date.now())
	const phone = opts.isPhone ?? detectPhone(win)
	const loadApi = opts.loadApi ?? (() => loadYouTubeApi(doc, win))
	const { card, host, socket } = opts

	let prefs = loadRadioPrefs(storage)
	let state: RadioState = { ...OFF_AIR, now: 0 }
	let skewMs = 0
	let amHost = false
	let player: YTPlayer | null = null
	let playerFor = "" // the playlist the live player was built for
	let ready = false
	let apiFailed = false
	let needsGesture = false // muted-first fallback engaged: a click un-mutes
	let needsTuneIn = false // even muted play refused: a click starts it
	let pendingSeekMs: number | null = null // applied once the jumped-to track is PLAYING
	let lastReported = { index: -1, videoId: "" as string | null }
	let lastReanchorAt = 0
	let gestureTimer: ReturnType<typeof setTimeout> | undefined

	card.innerHTML = hudHtml()
	const el = <T extends HTMLElement = HTMLElement>(name: string) => card.querySelector<T>(`[data-el="${name}"]`)!
	const act = <T extends HTMLElement = HTMLElement>(name: string) => card.querySelector<T>(`[data-act="${name}"]`)!
	const setIcon = (btn: HTMLElement, name: string) => {
		const i = btn.querySelector("i")
		if (i) i.className = `fa-solid fa-${name}`
	}

	const expected = () => expectedPositionMs(state, skewMs, now())
	const onAir = () => !!state.playlistId
	const wantPlayer = () => onAir() && !phone && !prefs.off && !apiFailed

	// ---- paint ----
	function render() {
		card.classList.toggle("hidden", !onAir() && !amHost)
		card.classList.toggle("radio-folded", prefs.collapsed)
		card.classList.toggle("radio-on", onAir() && state.playing && !prefs.off)
		card.classList.toggle("radio-phone", phone)
		card.classList.toggle("is-host", amHost)
		act("fold").setAttribute("aria-expanded", String(!prefs.collapsed))
		setIcon(act("fold"), prefs.collapsed ? "chevron-right" : "chevron-down")

		const list = el("list"), track = el("track"), note = el("note")
		if (!onAir()) {
			list.textContent = "Off air"
			track.textContent = ""
		} else {
			list.textContent = state.playlistName || "Tuning…"
			const local = !state.title && player && ready ? player.getVideoData()?.title || "" : ""
			track.textContent = state.title || local ? `▸ ${state.title || local}` : state.playing ? "▸ …" : "▸ paused"
		}
		setIcon(act("toggle"), state.playing ? "pause" : "play")
		act("toggle").title = state.playing ? "Pause for the whole table" : "Play for the whole table"
		act("skip").classList.toggle("hidden", !player || phone)
		act("back").classList.toggle("hidden", !player || phone)
		setIcon(act("mute"), prefs.muted ? "volume-xmark" : prefs.volume === 0 ? "volume-off" : prefs.volume < 50 ? "volume-low" : "volume-high")
		act("mute").classList.toggle("radio-nudge", needsGesture && !prefs.muted)
		act<HTMLInputElement>("vol").value = String(prefs.volume)
		act<HTMLInputElement>("vol").disabled = prefs.muted
		setIcon(act("power"), "power-off")
		act("power").classList.toggle("radio-off", prefs.off)
		act("power").title = prefs.off ? "Switch the radio on (only for you)" : "Switch the radio off (only for you)"
		el("ctl").classList.toggle("hidden", phone || !onAir())

		// the one line under the controls: what's between you and the music
		let msg = ""
		if (!onAir()) msg = amHost ? `<button type="button" class="linky radio-tune" data-act="tune">Tune the table to a YouTube playlist</button>` : ""
		else if (phone)
			msg = `Radio isn't supported on phones — <a href="${esc(playlistUrl(state.playlistId, state.index))}" target="_blank" rel="noopener noreferrer">open the playlist on YouTube ↗</a>`
		else if (apiFailed) msg = "WSQK is off the air in this browser (YouTube couldn't load)."
		else if (prefs.off) msg = `<button type="button" class="linky" data-act="power">Tune in</button> — you're off; the table keeps its own time.`
		else if (needsTuneIn) msg = `<button type="button" class="linky radio-tunein" data-act="tunein">▶ Tune in</button> — your browser wants a tap before it plays.`
		else if (needsGesture && !prefs.muted) msg = `Playing muted — <button type="button" class="linky" data-act="listen">tap to listen</button>.`
		else if (!state.playing) msg = amHost ? "Paused for the table." : "The host paused the radio."
		note.innerHTML = msg
		note.classList.toggle("hidden", !msg)
	}

	// ---- the player ----
	function applyPrefs() {
		if (!player || !ready) return
		try {
			player.setVolume(prefs.volume)
			if (prefs.muted || needsGesture) player.mute()
			else player.unMute()
		} catch {}
	}
	function destroyPlayer() {
		clearTimeout(gestureTimer)
		if (player) {
			try {
				player.destroy()
			} catch {}
		}
		player = null
		playerFor = ""
		ready = false
		needsGesture = false
		needsTuneIn = false
		pendingSeekMs = null
		host.innerHTML = ""
	}
	/** Build the player for the current station (once), then sync it. */
	function ensurePlayer() {
		if (!wantPlayer()) {
			if (player) destroyPlayer()
			return
		}
		if (player) {
			if (playerFor !== state.playlistId) {
				// the host changed station: same player, new list
				playerFor = state.playlistId
				lastReported = { index: -1, videoId: null }
				if (ready) {
					try {
						player.loadPlaylist({ list: state.playlistId, listType: "playlist", index: state.index })
						pendingSeekMs = expected()
						if (!state.playing) player.pauseVideo()
					} catch {}
				}
			}
			return
		}
		playerFor = state.playlistId
		const mount = doc.createElement("div")
		host.innerHTML = ""
		host.appendChild(mount)
		const forList = state.playlistId
		loadApi()
			.then((YT) => {
				if (!wantPlayer() || playerFor !== forList || player) return
				player = new YT.Player(mount, {
					width: 200,
					height: 200,
					playerVars: {
						listType: "playlist",
						list: state.playlistId,
						index: state.index,
						controls: 0,
						loop: 1,
						playsinline: 1,
						autoplay: 0,
						rel: 0,
						disablekb: 1,
					},
					events: { onReady, onStateChange, onError },
				})
			})
			.catch(() => {
				apiFailed = true
				destroyPlayer()
				render()
			})
	}
	function onReady() {
		ready = true
		applyPrefs()
		sync(true)
		render()
	}
	/** Bring my player to the table's anchor: right track, right position, right play state. */
	function sync(force = false) {
		if (!player || !ready) return
		try {
			const idx = player.getPlaylistIndex()
			const exp = expected()
			if (idx !== state.index || force) {
				if (idx !== state.index) {
					player.playVideoAt(state.index)
					pendingSeekMs = exp
				} else if (force) {
					player.seekTo(exp / 1000, true)
				}
			} else if (state.playing && needsSeek(player.getCurrentTime() * 1000, exp)) {
				player.seekTo(exp / 1000, true)
			}
			if (state.playing) startPlaying()
			else {
				player.pauseVideo()
				if (!needsSeek(player.getCurrentTime() * 1000, exp)) return
				player.seekTo(exp / 1000, true)
			}
		} catch {}
	}
	/** playVideo with the autoplay dance: unmuted if allowed, else muted, else ask for a tap. */
	function startPlaying() {
		if (!player) return
		clearTimeout(gestureTimer)
		player.playVideo()
		gestureTimer = setTimeout(() => {
			if (!player || !state.playing) return
			const st = player.getPlayerState()
			if (st === YT_PLAYING || st === YT_BUFFERING) return
			if (!needsGesture && !prefs.muted) {
				needsGesture = true // the browser refused sound: play muted and ask for a tap
				player.mute()
				player.playVideo()
				render()
				gestureTimer = setTimeout(() => {
					if (!player || !state.playing) return
					const st2 = player.getPlayerState()
					if (st2 !== YT_PLAYING && st2 !== YT_BUFFERING) {
						needsTuneIn = true
						render()
					}
				}, 1500)
			} else {
				needsTuneIn = true
				render()
			}
		}, 1500)
	}
	function onStateChange(e: { data: number }) {
		if (!player) return
		if (e.data === YT_PLAYING) {
			needsTuneIn = false
			if (pendingSeekMs != null) {
				const ms = pendingSeekMs
				pendingSeekMs = null
				if (ms > 1500) player.seekTo(ms / 1000, true)
			}
			if (amHost) conduct()
			render()
		} else if (e.data === YT_ENDED) {
			// loop:1 wraps the playlist on its own; a lone ENDED means the wrap
			// didn't come — nudge along, the conductor reports the new track
			try {
				player.nextVideo()
			} catch {}
		}
	}
	/** The conductor's report: a new track always, the same track only when it drifted. */
	function conduct() {
		if (!player || !amHost || !onAir()) return
		try {
			const index = player.getPlaylistIndex()
			const data = player.getVideoData()
			const videoId = data?.video_id || ""
			const title = data?.title || ""
			const positionMs = Math.max(0, Math.round(player.getCurrentTime() * 1000))
			const changed = index !== lastReported.index || (videoId && videoId !== lastReported.videoId)
			if (!changed) {
				if (!state.playing || Math.abs(positionMs - expected()) <= REANCHOR_DRIFT_MS || now() - lastReanchorAt < REANCHOR_COOLDOWN_MS) return
				lastReanchorAt = now()
			}
			lastReported = { index, videoId }
			socket.emit("radio-track", { index, videoId, title, positionMs })
		} catch {}
	}
	function onError() {
		// unavailable / private / deleted: every player steps past it by itself
		try {
			player?.nextVideo()
		} catch {}
	}

	// ---- controls ----
	card.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")
		if (!btn || !card.contains(btn)) return
		const a = btn.dataset.act
		if (a === "fold") {
			prefs = saveRadioPrefs({ ...prefs, collapsed: !prefs.collapsed }, storage)
		} else if (a === "mute" || a === "listen") {
			// "listen" is the muted-first fallback's tap: it counts as the gesture
			needsGesture = false
			prefs = saveRadioPrefs({ ...prefs, muted: a === "mute" ? !prefs.muted : false }, storage)
			applyPrefs()
		} else if (a === "power") {
			prefs = saveRadioPrefs({ ...prefs, off: !prefs.off }, storage)
			if (prefs.off) destroyPlayer()
			else ensurePlayer()
		} else if (a === "tunein") {
			needsTuneIn = false
			needsGesture = false
			applyPrefs()
			sync(true)
		} else if (a === "toggle") {
			if (!amHost) return
			if (state.playing) {
				const positionMs = player && ready ? Math.round(player.getCurrentTime() * 1000) : expected()
				socket.emit("radio-pause", { positionMs }, () => {})
			} else socket.emit("radio-play", null, () => {})
		} else if (a === "skip" || a === "back") {
			// forward and back are local jumps on the conductor's player; the
			// report that follows from the state change moves the table
			if (!amHost || !player || !ready) return
			try {
				if (a === "skip") player.nextVideo()
				else player.previousVideo()
			} catch {}
		} else if (a === "tune") {
			opts.onTune?.()
		}
		render()
	})
	act<HTMLInputElement>("vol").addEventListener("input", (e) => {
		prefs = saveRadioPrefs({ ...prefs, volume: clampVol((e.target as HTMLInputElement).value) }, storage)
		applyPrefs()
		render()
	})
	const onVisible = () => {
		if (doc.visibilityState === "visible") sync()
	}
	doc.addEventListener("visibilitychange", onVisible)

	render()
	return {
		set(next) {
			skewMs = next.now ? next.now - now() : 0
			const wasOn = onAir(), wasList = state.playlistId
			state = next
			if (!onAir()) {
				destroyPlayer()
				render()
				return
			}
			lastReanchorAt = 0
			if (!wasOn || wasList !== next.playlistId) lastReported = { index: -1, videoId: null }
			ensurePlayer()
			sync()
			render()
		},
		setHost(h) {
			if (h === amHost) return
			amHost = h
			if (h) lastReported = { index: -1, videoId: null } // the new conductor announces where it is
			if (h && player && ready && player.getPlayerState() === YT_PLAYING) conduct()
			render()
		},
		get state() {
			return state
		},
		get prefs() {
			return prefs
		},
		get amHost() {
			return amHost
		},
		get player() {
			return player
		},
		get phone() {
			return phone
		},
		destroy() {
			doc.removeEventListener("visibilitychange", onVisible)
			destroyPlayer()
		},
	}
}
