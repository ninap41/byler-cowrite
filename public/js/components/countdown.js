// Countdown rendering rules. The server owns the clock: st.deadline is
// authoritative and we only render from it; when paused, st.remaining is the
// frozen time. `expired` tells the caller to stop ticking (and, when it's the
// local player's turn, to best-effort auto-submit — the server advances at 0
// regardless).
export function countdownView(st, now = Date.now()) {
	if (st.paused) {
		if (st.turnSeconds === 0) return { text: "⏸", left: 0, paused: true, low: false, expired: false }
		const left = Math.ceil((st.remaining || 0) / 1000)
		return { text: "⏸ " + left + "s", left, paused: true, low: false, expired: false }
	}
	// untimed story: no deadline, no expiry — the writer takes their time
	if (!st.deadline) return { text: "∞", left: Infinity, paused: false, low: false, expired: false }
	const left = Math.max(0, Math.ceil((st.deadline - now) / 1000))
	return { text: left + "s", left, paused: false, low: left <= 10, expired: left <= 0 }
}
