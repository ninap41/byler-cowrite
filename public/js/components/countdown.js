// Countdown rendering rules. The server owns the clock: st.deadline is
// authoritative and we only render from it; when paused, st.remaining is the
// frozen time. `expired` tells the caller to stop ticking (and, when it's the
// local player's turn, to best-effort auto-submit — the server advances at 0
// regardless).
export function countdownView(st, now = Date.now()) {
	if (st.paused)
		return { text: "⏸ " + Math.ceil((st.remaining || 0) / 1000) + "s", paused: true, low: false, expired: false }
	const left = Math.max(0, Math.ceil((st.deadline - now) / 1000))
	return { text: left + "s", paused: false, low: left <= 10, expired: left <= 0 }
}
