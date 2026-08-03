// Seat-rejoin persistence: the server hands out a per-seat token on
// create/join; we keep {code, token} in localStorage and reclaim the seat on
// every (re)connect via `rejoin-session`.
const KEY = "cowriteRejoin"

export function loadRejoin() {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) || "null")
		return v && v.code && v.token ? v : null
	} catch (e) {
		return null
	}
}

export function saveRejoin(code, token) {
	try {
		localStorage.setItem(KEY, JSON.stringify({ code, token }))
	} catch (e) {}
}

export function clearRejoin() {
	try {
		localStorage.removeItem(KEY)
	} catch (e) {}
}
