// Auth token storage + the JSON fetch wrapper shared by every page.
const KEY = "cowriteAuth"

let token: string | null = null
try {
	token = localStorage.getItem(KEY) || null
} catch {}

export const getToken = (): string | null => token

export function setToken(t: string | null | undefined): void {
	token = t || null
	try {
		if (token) localStorage.setItem(KEY, token)
		else localStorage.removeItem(KEY)
	} catch {}
}

/** What a refused request throws: the server's message, its status, and the whole body (extra flags like capReached ride along). */
export class ApiError extends Error {
	status: number
	data: Record<string, unknown>
	constructor(message: string, status: number, data: Record<string, unknown>) {
		super(message)
		this.status = status
		this.data = data
	}
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, method = "POST"): Promise<T> {
	const r = await fetch(path, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: "Bearer " + token } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	const d = (await r.json().catch(() => ({}))) as Record<string, unknown>
	if (!r.ok) throw new ApiError(typeof d.error === "string" ? d.error : "Something went wrong.", r.status, d)
	return d as T
}
