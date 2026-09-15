// What every gimmick mount shares (docs/TYPES.md §4): the options game.html
// hands each toy, and the object each returns. The seven components extend
// these with their own verb and telemetry.
import type { RosterWriter } from "../shared/wire.js"

/** The slice of a Socket.IO client the gimmicks drive. */
export interface SocketLike {
	emit(event: string, payload?: unknown, ack?: (res: unknown) => void): unknown
	on(event: string, handler: (payload: never) => void): unknown
}
export interface GimmickMountOpts {
	socket: SocketLike
	document?: Document
	getMyUserId?(): string | null
	getMyColor?(): string
	getMyName?(): string
}
export interface Gimmick {
	start(): void
	exit(opts?: { fade?: boolean }): void
	/** the table went friendly: fold and put everything away; true when anything was out */
	gimmicksOff(): boolean
	readonly open: boolean
}
export type Ack<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error?: string } | null | undefined
export type Table = Pick<RosterWriter, "userId" | "name" | "color" | "connected">[]
