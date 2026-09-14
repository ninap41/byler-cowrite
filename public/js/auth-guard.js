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
		// only a refused token is a dead token — a network blip or a 5xx
		// must not log someone out (that read as "kicked" too)
		if (e.status === 401 || e.status === 403) setToken(null)
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
