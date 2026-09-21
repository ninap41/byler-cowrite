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

/**
 * `timeoutMs` gives up on a request that never answers (a closed lid, dead
 * wifi): it rejects with an ApiError of status 0 instead of hanging forever —
 * a caller that holds a "busy" flag across the await would otherwise never
 * get to clear it.
 */
export async function api<T = Record<string, unknown>>(path: string, body?: unknown, method = "POST", { timeoutMs = 0 }: { timeoutMs?: number } = {}): Promise<T> {
	const ctl = timeoutMs > 0 ? new AbortController() : null
	const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
	let r: Response
	try {
		r = await fetch(path, {
			method,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: "Bearer " + token } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: ctl?.signal,
		})
	} catch (e) {
		if (ctl?.signal.aborted) throw new ApiError("That took too long and was given up on. Check your connection.", 0, { timeout: true })
		throw e
	} finally {
		if (timer) clearTimeout(timer)
	}
	const d = (await r.json().catch(() => ({}))) as Record<string, unknown>
	if (!r.ok) throw new ApiError(typeof d.error === "string" ? d.error : "Something went wrong.", r.status, d)
	return d as T
}
