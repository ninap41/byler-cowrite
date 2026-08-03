// Per-page auth guards for the multi-page split. `nav` is injectable for tests.
import { api, getToken, setToken } from "./api.js"

const go = (url) => {
	location.href = url
}

// Signed-in pages call this on load: resolves to the account (from /api/me)
// or redirects to the homepage and resolves null.
export async function requireAuth(redirectTo = "/", nav = go) {
	if (!getToken()) {
		nav(redirectTo)
		return null
	}
	try {
		return (await api("/api/me", null, "GET")).user
	} catch (e) {
		setToken(null) // stale/revoked token
		nav(redirectTo)
		return null
	}
}

// The homepage calls this: bounce already-signed-in visitors to the dashboard.
export function redirectIfSignedIn(dest, nav = go) {
	if (getToken()) {
		nav(dest)
		return true
	}
	return false
}
