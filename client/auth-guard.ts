// Per-page auth guards for the multi-page split. `nav` is injectable for tests.
import { api, getToken, setToken, ApiError } from "./api.js"

type Nav = (url: string) => void
const go: Nav = (url) => {
	location.href = url
}

// Signed-in pages call this on load: resolves to the account (from /api/me)
// or redirects to the homepage and resolves null.
export async function requireAuth<U = Record<string, unknown>>(redirectTo = "/", nav: Nav = go): Promise<U | null> {
	if (!getToken()) {
		nav(redirectTo)
		return null
	}
	try {
		return (await api<{ user: U }>("/api/me", null, "GET")).user
	} catch (e) {
		// only a refused token is a dead token — a network blip or a 5xx
		// must not log someone out (that read as "kicked" too)
		if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setToken(null)
		nav(redirectTo)
		return null
	}
}

// The homepage calls this: bounce already-signed-in visitors to the dashboard.
export function redirectIfSignedIn(dest: string, nav: Nav = go): boolean {
	if (getToken()) {
		nav(dest)
		return true
	}
	return false
}
