// What every gimmick mount shares (docs/TYPES.md §4): the options game.html
// hands each toy, and the object each returns. The seven components extend
// these with their own verb and telemetry.
import type { Socket } from "socket.io-client"
import type { RosterWriter, ServerToClient, ClientToServer } from "../shared/wire.js"

/** The page's socket, typed by the wire's two event maps (docs/TYPES.md §1). */
export type SocketLike = Socket<ServerToClient, ClientToServer>
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
