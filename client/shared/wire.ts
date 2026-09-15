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

// ---- guided prompts ----
export type ControlIdKey = "seasonId" | "canonId" | "worldId" | "placeId" | "situationId" | "relationshipId" | "toneId" | "setupId" | "dynamicId" | "actId" | "kinkId"
export type ControlOffKey = "situationOff" | "toneOff" | "setupOff" | "dynamicOff" | "actOff" | "kinkOff"
export type ExplicitLevel = "none" | "explicit"
/** The host's knobs, as cleanPromptControls() (src/game.js) shapes them: an id or "random" per axis, the off switches, the kink count. */
export type PromptControls = Record<ControlIdKey, string> & Record<ControlOffKey, boolean> & { explicitLevel: ExplicitLevel | string; kinkCount: number }
export type AgeGroup = "minor" | "adult"
/** One menu row of /api/prompt-options: id + label + the RULES the generator would apply (never clause text). */
export interface MenuRow {
	id: string
	label?: string
	tags?: string[]
	requires?: string[]
	excludes?: string[]
	ageGroups?: AgeGroup[]
	canon?: string[]
	adultOnly?: boolean
	ageGroup?: AgeGroup
}
export interface PromptMenus {
	modes: PromptMode[]
	intermediate: null | ({ explicitLevels?: MenuRow[]; tropeGroups?: { id: string; label: string }[] } & Record<string, MenuRow[] | undefined | null | { id: string; label: string }[]>)
}
/** A guided option's components, as `game-state.optionMeta[]` carries them beside each ballot option. */
export interface OptionMeta {
	seed?: string
	selections?: Record<string, unknown>
	labels?: Record<string, string | string[] | undefined>
	custom?: true
	by?: string | null
}

// ---- the game-state broadcast ----
/** `broadcastGame()`'s payload (src/game.js) — one object every phase; the choosing fields are empty outside choosing, `turnOrder` outside writing/over. */
export interface GameState {
	code: GameCode | string
	name: string
	cover: string
	phase: Phase
	options: string[]
	optionMeta: (OptionMeta | null)[]
	promptMode: PromptMode
	promptControls: PromptControls
	tally: number[]
	voted: number
	ballots: Record<string, number[]>
	ready: string[]
	allReady: boolean
	total: number
	prompt: string
	story: StoryLine[]
	currentId: string | null
	currentName: string | null
	currentColor: HexColor | string | null
	deadline: number
	paused: boolean
	remaining: number | null
	turnSeconds: number
	friendly: boolean
	turnCount: number
	maxTurns: number | null
	players: (string | undefined)[]
	writers: RosterWriter[]
	turnOrder: string[]
	nextId: string | null
	hostId: string | null
	hostName: string | null
	hostUserId: string | null
	spectators: number
	tableGimmicks: string[]
}

/** A rank-up or usage badge landing (`notifyEarned`, `creditLine`). `desc` is null on a secret badge sent to the rest of the room. */
export interface BadgeEarned {
	badge: string
	desc?: string | null
	name?: string | null
	unlocks?: { themes: { id: string; name: string }[]; gimmicks: { id: string; name: string }[] } | null
	/** on a rank-up: the earner's full wearable theme list (their own socket only) */
	themes?: string[]
	gimmicks?: string[]
}

// ---- gimmicks: one owner shape, a state per toy ----
export interface GimmickOwner {
	userId: string
	name: string
	color: HexColor | string
}
/** A toy on the wire: out (owner + state) or put away. */
export type Live<S> = (GimmickOwner & S & { on: true }) | { userId: string; on: false }
export type Bulk<S> = (GimmickOwner & S)[]
export interface DieState { x: number; y: number }
export type BeeOnWire = [number, number, 0 | 1, number] | [number, number, 0 | 1]
export interface ShipState { x: number; score?: number; shots?: [number, number][]; bees?: BeeOnWire[] }
export interface CupState { x: number; y: number; rot?: number; level?: number }
export interface BallState { x: number; y: number }
export interface GunState { x?: number; y?: number; angle?: number }
export interface Stroke { color: string; size: number; pts: [number, number][]; erase?: true }
/** One `gimmick-stroke` relay: a cursor, a stroke in progress or committed, a wipe, or the brush going away. */
export interface StrokeEvent {
	userId: string
	name?: string
	color?: string
	on?: boolean
	cursor?: [number, number]
	stroke?: Stroke
	live?: boolean
	wipe?: boolean
}
export type CurseEvent = { targetUserId: string; targetName?: string; byName?: string; byColor?: string; duration?: number; lift?: false } | { targetUserId: string; lift: true }
export type RollKind = "nat20" | "nat1" | "plain" | string
export interface RollRelay extends GimmickOwner { value: number; kind: RollKind; stole: boolean }
export interface GalagaRelay extends GimmickOwner { score: number; kind: string; stole: boolean }
export interface SquirtRelay extends GimmickOwner { x: number; y: number; angle: number; seed: number }

// ---- the Socket.IO event maps ----
// Both ends of every event at once (docs/TYPES.md §1 "The event maps"): the
// page's socket is `io<ServerToClient, ClientToServer>()`, so every
// `socket.on` handler and `socket.emit` payload on game.html is checked.
// src/game.js is still JavaScript; add a line here when it gains an event.
export interface ServerToClient {
	"game-state": (st: GameState) => void
	roster: (r: Roster) => void
	"game-over": (p: GameOverPayload) => void
	"game-slept": (p: { code: string; name: string; by: string | null }) => void
	"game-deleted": () => void
	"game-invite": (p: { code: string; name: string; host: string | null }) => void
	/** the inbox page's live nudge: reload */
	inbox: () => void
	chat: (m: ChatMessage) => void
	"chat-history": (ms: ChatMessage[]) => void
	"chat-react": (p: { mid: string; reactions: Reactions }) => void
	"live-typing": (p: { html: RichHtml | string }) => void
	"steal-carry": (p: { html: RichHtml | string }) => void
	"badge-earned": (p: BadgeEarned) => void
	"join-approved": (res: SeatAck) => void
	"join-denied": () => void
	"join-request": (p: { id: string; name: string; returning?: boolean }) => void
	"join-request-cancel": (p: { id: string }) => void
	"gimmick-die": (d: Live<DieState>) => void
	"gimmick-dice": (list: Bulk<DieState>) => void
	"gimmick-roll": (r: RollRelay) => void
	"gimmick-ship": (d: Live<ShipState>) => void
	"gimmick-ships": (list: Bulk<ShipState>) => void
	"gimmick-galaga": (r: GalagaRelay) => void
	"gimmick-cup": (d: Live<CupState>) => void
	"gimmick-cups": (list: Bulk<CupState>) => void
	"gimmick-pour": (p: GimmickOwner) => void
	"gimmick-ball": (d: Live<BallState>) => void
	"gimmick-balls": (list: Bulk<BallState>) => void
	"gimmick-spin": (p: GimmickOwner & { duration?: number }) => void
	"gimmick-gun": (d: Live<GunState>) => void
	"gimmick-guns": (list: Bulk<GunState>) => void
	"gimmick-squirt": (p: SquirtRelay) => void
	"gimmick-stroke": (d: StrokeEvent) => void
	"gimmick-paints": (list: (StrokeEvent & { strokes?: Stroke[]; live?: Stroke | boolean | null })[]) => void
	"gimmick-paint": (p: GimmickOwner) => void
	"gimmick-curse": (d: CurseEvent) => void
}

type AckFn<T = Record<never, never>> = (res: Ack<T>) => void
export type SeatResult = Ack<SeatAck> | Ack<PendingAck>
export interface ClientToServer {
	identify: (p: { auth: string | null }) => void
	"create-session": (p: { auth: string | null }, ack: (res: SeatResult) => void) => void
	"join-session": (p: { code: string; auth: string | null }, ack: (res: SeatResult) => void) => void
	"rejoin-session": (p: { code: string; token: string; auth: string | null }, ack: (res: SeatResult) => void) => void
	"spectate-session": (p: { code: string }, ack: AckFn<{ phase?: Phase }>) => void
	"start-game": (p: Partial<{ turnSeconds: number | string; rounds: number | string; friendly: boolean; promptMode: PromptMode; promptControls: PromptControls }>, ack: AckFn) => void
	"cancel-game": (p: Record<never, never>, ack: AckFn<{ deleted?: boolean }>) => void
	vote: (p: { prompt: string; on?: boolean }, ack?: AckFn<{ on: boolean; votes: string[] }>) => void
	ready: (p: { ready: boolean }) => void
	"add-prompt": (p: { prompt: string }, ack: AckFn) => void
	"remove-prompt": (p: { index: number }) => void
	"reroll-option": (p: { index: number }) => void
	"shuffle-options": () => void
	"set-prompt-mode": (p: { mode: PromptMode; controls: PromptControls }) => void
	"finalize-vote": (p: null, ack: AckFn) => void
	"submit-line": (p: { text: string }, ack: AckFn) => void
	typing: (p: { text: string }) => void
	"edit-line": (p: { index: number; text: string }, ack: AckFn) => void
	"delete-line": (p: { index: number }, ack: AckFn) => void
	"pause-game": () => void
	"resume-game": () => void
	"paused-poke": () => void
	"end-game": () => void
	"update-rules": (p: { turnSeconds: number | string; addRounds: number | string; endless?: boolean; friendly: boolean }, ack: AckFn) => void
	"continue-writing": (p: { turnSeconds: number | string; rounds: number | string; friendly: boolean }, ack: AckFn) => void
	"rename-session": (p: { name: string }, ack: AckFn<{ name: string }>) => void
	"set-cover": (p: { url: string }, ack: AckFn) => void
	"make-host": (p: { id: string }, ack: AckFn) => void
	"approve-join": (p: { id: string; allow: boolean }, ack: () => void) => void
	chat: (p: { text: string; name?: string }) => void
	"chat-react": (p: { mid: string; emoji: string; name?: string }, ack: AckFn<{ reactions: Reactions }>) => void
	"gimmick-die": (p: { on: true; x: number; y: number } | { on: false }) => void
	"gimmick-roll": (p: { id: string; steal: boolean }, ack: AckFn<{ value: number; kind: RollKind; stole: boolean }>) => void
	"gimmick-ship": (p: (ShipState & { on: true }) | { on: false }) => void
	"gimmick-galaga": (p: { score: number; steal: boolean }, ack: AckFn<{ score: number; kind: string; stole: boolean }>) => void
	"gimmick-cup": (p: (CupState & { on: true }) | { on: false }) => void
	"gimmick-pour": (p: Record<never, never>, ack: AckFn) => void
	"gimmick-ball": (p: (BallState & { on: true }) | { on: false }) => void
	"gimmick-spin": (p: Record<never, never>, ack: AckFn<{ duration?: number }>) => void
	"gimmick-gun": (p: (GunState & { on: true }) | { on: false }) => void
	"gimmick-squirt": (p: Record<never, never>, ack: AckFn) => void
	"gimmick-stroke": (p: Omit<StrokeEvent, "userId" | "name" | "color">) => void
	"gimmick-paint": (p: Record<never, never>, ack: AckFn) => void
	"gimmick-curse": (p: { targetUserId: string }, ack: AckFn) => void
	"gimmick-uncurse": (p: Record<never, never>, ack: AckFn) => void
}
