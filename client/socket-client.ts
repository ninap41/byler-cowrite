// Seat-rejoin persistence: the server hands out a per-seat token on
// create/join; we keep {code, token} in localStorage and reclaim the seat on
// every (re)connect via `rejoin-session`.
const KEY = "cowriteRejoin"

export interface RejoinBlob {
	code: string
	token: string
}

export function loadRejoin(): RejoinBlob | null {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<RejoinBlob> | null
		return v && v.code && v.token ? { code: v.code, token: v.token } : null
	} catch {
		return null
	}
}

export function saveRejoin(code: string, token: string): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ code, token }))
	} catch {}
}

export function clearRejoin(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {}
}
