// The wire contract between src/game.js and the pages — the shapes every
// socket payload and REST row is built from. Types only (this module emits
// nothing). docs/TYPES.md §1 is the design; add a field here when
// broadcastGame()/roster()/gameOverPayload() grow one.
import type { HexColor, RichHtml, GameCode } from "./brands.js"
import type { Reactions } from "./reactions.js"

export type Phase = "waiting" | "choosing" | "writing" | "over"
export type AvatarFit = "cover" | "contain"
export type PromptMode = "simple" | "intermediate"

/** What every byline, chip and avatar is rendered from. */
export interface Who {
	name: string
	color: HexColor | string
	avatar?: string
	avatarFit?: AvatarFit | string
	host?: boolean
	isHost?: boolean
}

/** A seat as the wire shows it — `roster.writers[]` and `game-state.writers[]`. */
export interface RosterWriter extends Who {
	id: string
	userId: string | null
	badge: string | null
	isHost: boolean
	connected: boolean
	words: number
}

/** One committed line of the story. `html` is sanitizeRich() output, injected as-is. */
export interface StoryLine extends Who {
	html: RichHtml | string
	userId: string | null
	edited?: boolean
	header?: boolean
}

interface ChatBase {
	text: string
	ts: number
}
/** A seated writer spoke. */
export interface WriterChat extends ChatBase, Who {
	id: string
	mid: string
	badge?: string | null
	reactions?: Reactions
	sys?: false
	spec?: false
}
/** A spectator spoke (client-minted name, palette colour by hash). */
export interface SpectatorChat extends ChatBase {
	id: string
	mid: string
	name: string
	color: HexColor | string
	spec: true
	reactions?: Reactions
	sys?: false
}
/** An announce() line — no mid, so nothing can react to it. */
export interface SystemChat extends ChatBase {
	name: string
	color: HexColor | string
	sys: true
	chime?: true
}
export type ChatMessage = WriterChat | SpectatorChat | SystemChat

/** The scoreboard on a non-friendly reveal. */
export interface ScoreRow extends Who {
	userId: string
	words: number
	seated: boolean
}

export interface GameOverPayload {
	prompt: string
	story: StoryLine[]
	scoreboard: ScoreRow[] | null
}

export interface Roster {
	writers: RosterWriter[]
	code: GameCode | string
	name: string
	cover: string
	hostUserId: string | null
	continued: boolean
}

/** Every socket ack: refused, or ok with the handler's own fields. */
export type Ack<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error?: string }

/** The seat ack (create/join/rejoin) — also the body of `join-approved`. */
export interface SeatAck {
	code: GameCode | string
	hostId: string
	name: string
	color: HexColor | string
	phase: Phase
	token: string
}
export type PendingAck = { pending: true }

// ---- the inbox ----
/** Who a message is from/to, as GET /api/inbox ships it (src/routes.js msgShape). */
export interface Ident {
	username: string
	color: HexColor | string
	badge?: string | null
	avatar?: string
	avatarFit?: AvatarFit | string
}
export type MsgKind = "friend-request" | "friend-accept" | "game-invite" | "doc-invite" | "help" | "note" | "system"
/** One inbox message on the wire. */
export interface InboxRow {
	id: string
	type: MsgKind | string
	text: string
	read: boolean
	ts: number
	code?: string | null
	threadId?: string
	mine?: boolean
	from?: Ident | null
	to?: Ident | null
	unlocks?: { themes: { id: string; name: string }[]; gimmicks: { id: string; name: string }[] } | null
}
export interface InboxPayload {
	messages: InboxRow[]
	unread: number
}
/** A conversation as threadInbox() (dashboard-view) groups it: oldest first inside, the head on top. */
export interface InboxThread {
	id: string
	messages: InboxRow[]
	head: InboxRow
	ts: number
	unread: boolean
	/** the newest message from the other person — what a reply answers */
	replyTo: InboxRow | null
}
