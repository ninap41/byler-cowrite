// WSQK, the table's shared radio: the pure rules both sides share. The server
// (src/game.js, via public/js/shared/radio.js) parses the host's playlist
// link and keeps the anchor; the HUD (components/wsqk.ts) turns the anchor
// into "where should my player be right now". No DOM, no I/O.
import type { RadioState } from "./wire.js"

/** A YouTube playlist id: PL…/UU…/OL…/RD… and friends, 13–64 url-safe chars. */
export const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{13,64}$/
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
/** A listener re-seeks only past this much drift — ambient music, not a metronome. */
export const SEEK_TOLERANCE_MS = 3000
/** The conductor re-anchors the same track only past this drift, and no more often than the cooldown. */
export const REANCHOR_DRIFT_MS = 2000
export const REANCHOR_COOLDOWN_MS = 30_000
export const MAX_POSITION_MS = 6 * 60 * 60 * 1000
export const MAX_INDEX = 999

export const OFF_AIR: Omit<RadioState, "now"> = {
	playlistId: "",
	playlistName: "",
	index: 0,
	videoId: null,
	title: "",
	playing: false,
	positionMs: 0,
	updatedAt: 0,
}

/**
 * The playlist id in whatever the host pasted: a youtube.com / youtu.be /
 * music.youtube.com link with `list=`, or the bare id. null when it isn't one.
 */
export function parsePlaylistId(raw: string): string | null {
	const v = String(raw || "").trim()
	if (!v) return null
	if (PLAYLIST_ID_RE.test(v) && !/^https?:/i.test(v)) return v
	let u: URL
	try {
		u = new URL(v)
	} catch {
		return null
	}
	if (!/^https?:$/.test(u.protocol)) return null
	const host = u.hostname.replace(/^www\.|^m\.|^music\./, "")
	if (host !== "youtube.com" && host !== "youtu.be" && host !== "youtube-nocookie.com") return null
	const list = u.searchParams.get("list") || ""
	return PLAYLIST_ID_RE.test(list) ? list : null
}

/** The public page for a playlist, at a given track (YouTube's `index` is 1-based). */
export const playlistUrl = (playlistId: string, index = 0): string =>
	`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}${index > 0 ? `&index=${index + 1}` : ""}`

/**
 * Where the table is right now, in ms into the current track. `skewMs` is
 * serverNow − clientNow as measured when the state arrived; `nowMs` is the
 * client's clock (injectable for tests).
 */
export function expectedPositionMs(r: Pick<RadioState, "playing" | "positionMs" | "updatedAt">, skewMs = 0, nowMs = Date.now()): number {
	if (!r.playing) return Math.max(0, r.positionMs)
	return Math.max(0, r.positionMs + (nowMs + skewMs - r.updatedAt))
}

/** Should a listener seek? Only past the tolerance, so small drift is left alone. */
export const needsSeek = (localMs: number, expectedMs: number, tolerance = SEEK_TOLERANCE_MS): boolean =>
	Math.abs(localMs - expectedMs) > tolerance

/** What the server checks before accepting a same-track re-anchor from the conductor. */
export const acceptsReanchor = (
	r: Pick<RadioState, "playing" | "positionMs" | "updatedAt">,
	reportedMs: number,
	lastReanchorAt: number,
	nowMs = Date.now(),
): boolean => Math.abs(reportedMs - expectedPositionMs(r, 0, nowMs)) > REANCHOR_DRIFT_MS && nowMs - lastReanchorAt >= REANCHOR_COOLDOWN_MS
