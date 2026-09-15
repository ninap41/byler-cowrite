// Ambient declarations for the two script-tag globals the pages rely on.
// GSAP is optional everywhere (every use is null-guarded with a CSS
// fallback), so it is typed loosely: a bag of tween functions, never
// required. `io` is the Socket.IO client the four socket pages load.

/** The slice of GSAP the app calls; loose on purpose — a CDN script, not a dependency. */
interface GsapLike {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[method: string]: (...args: any[]) => any
}
interface Window {
	gsap?: GsapLike
}

/** The Socket.IO client, loaded by `<script src="/socket.io/socket.io.js">` on the socket pages. */
declare const io: typeof import("socket.io-client").io
/** The same GSAP as a bare global — the pages guard with `typeof gsap !== "undefined"` or `window.gsap` before calling it. */
declare const gsap: GsapLike
