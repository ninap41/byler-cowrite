// Auth token storage + the JSON fetch wrapper shared by every page.
const KEY = "cowriteAuth"

let token = null
try {
	token = localStorage.getItem(KEY) || null
} catch (e) {}

export const getToken = () => token

export function setToken(t) {
	token = t || null
	try {
		if (token) localStorage.setItem(KEY, token)
		else localStorage.removeItem(KEY)
	} catch (e) {}
}

export async function api(path, body, method = "POST") {
	const r = await fetch(path, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: "Bearer " + token } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	const d = await r.json().catch(() => ({}))
	if (!r.ok) {
		const err = new Error(d.error || "Something went wrong.")
		err.status = r.status
		err.data = d // extra flags (e.g. capReached) ride along for the caller
		throw err
	}
	return d
}
