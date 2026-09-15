// Who am I at this table? Pure rules, no DOM, no socket — game.html feeds
// them the socket and the broadcasts.
//
// A reconnect is a NEW socket id: the server moves the seat onto it, and
// every "my turn" / "am I host" / ballot / ready check on the page compares
// against the id the page believes is its own. If that id is never re-read
// the page thinks it was kicked (no editor, no host bar) until a refresh.
import type { Ack, SeatAck, PendingAck, RosterWriter } from "../shared/wire.js"

export type ReconnectOutcome =
	| { kind: "gone" } // seat expired / game gone: forget the seat, go home
	| { kind: "pending" } // gated: waiting for the host
	| { kind: "seated"; myId: string; hostId: string | null }

// The answer to a rejoin sent from an already-entered page. Returns what the
// page should do; it never touches location/DOM itself so it can be tested.
export function reconnectOutcome(res: Ack<SeatAck> | Ack<PendingAck> | null | undefined, socketId: string, prevHostId: string | null): ReconnectOutcome {
	if (!res?.ok) return { kind: "gone" }
	if ("pending" in res && res.pending) return { kind: "pending" }
	return { kind: "seated", myId: socketId, hostId: ("hostId" in res ? res.hostId : undefined) ?? prevHostId }
}

// Any roster/game-state broadcast: if no writer wears my id but one wears my
// account (and is in the game), that seat is mine — a reseat that reached the
// page by broadcast alone (a host approving a returning seat). Returns the id
// to adopt, or null to leave myId alone.
export function adoptSeatId(writers: unknown, myId: string | null, userId: string | null | undefined): string | null {
	if (!Array.isArray(writers) || userId == null) return null
	const list = writers as Pick<RosterWriter, "id" | "userId" | "connected">[]
	if (list.some((w) => w.id === myId)) return null
	const mine = list.find((w) => w.userId === userId && w.connected !== false)
	return mine ? mine.id : null
}
