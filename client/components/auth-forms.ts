// Login / signup / forgot-password panes for the homepage. Pure wiring over
// injected deps so it's testable without a network.
import type { ApiError } from "../api.js"

type Api = (path: string, body?: unknown, method?: string) => Promise<Record<string, unknown>>
export interface AuthFormsDeps<U = unknown> {
	api: Api
	onSignedIn: (user: U, token: string) => void
	onCapReached?: (email: string) => void
}
export interface AuthForms {
	showChoice(): void
	showPane(name: string): void
}
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function wireAuthForms<U = unknown>(root: Document, { api, onSignedIn, onCapReached }: AuthFormsDeps<U>): AuthForms {
	const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.getElementById(id) as T
	const val = (id: string): string => $<HTMLInputElement>(id).value
	const show = (id: string) => $(id).classList.remove("hidden")
	const hide = (id: string) => $(id).classList.add("hidden")

	function showChoice() {
		show("authChoice")
		hide("authPanes")
		$("authErr").textContent = ""
	}
	function showPane(name: string) {
		hide("authChoice")
		show("authPanes")
		root.querySelectorAll<HTMLElement>("[data-auth-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.authPane !== name))
		hide("fgResult")
		hide("fuResult")
		$("authErr").textContent = ""
	}

	$("chLogin").onclick = () => showPane("login")
	$("chSignup").onclick = () => showPane("signup")
	for (const [id, pane] of [
		["chForgot", "forgot"],
		["liForgot", "forgot"],
		["chForgotUser", "forgotuser"],
		["liForgotUser", "forgotuser"],
	] as const) {
		$(id).onclick = (e) => {
			e.preventDefault()
			showPane(pane)
		}
	}
	$("authBack").onclick = (e) => {
		e.preventDefault()
		showChoice()
	}

	// Enter submits whichever pane you're typing in
	const enterSubmits: [string[], string][] = [
		[["liUser", "liPass"], "liBtn"],
		[["suEmail", "suUser", "suPass"], "suBtn"],
		[["fgEmail"], "fgFind"],
		[["fuEmail"], "fuFind"],
	]
	for (const [ids, btn] of enterSubmits)
		for (const id of ids)
			$(id).addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault()
					$(btn).click()
				}
			})

	$("liBtn").onclick = async () => {
		try {
			const d = await api("/api/login", { user: val("liUser").trim(), password: val("liPass") })
			onSignedIn(d.user as U, d.token as string)
		} catch (e) {
			$("authErr").textContent = msgOf(e)
		}
	}
	$("suBtn").onclick = async () => {
		try {
			const d = await api("/api/signup", {
				email: val("suEmail").trim(),
				username: val("suUser").trim(),
				password: val("suPass"),
				isAMemberOfBylerOffscreen: !!$<HTMLInputElement>("suMember")?.checked,
			})
			onSignedIn(d.user as U, d.token as string)
		} catch (e) {
			// Account cap hit: hand the attempted email to the waiting-list wall.
			if ((e as ApiError).data?.capReached && onCapReached) return onCapReached(val("suEmail").trim())
			$("authErr").textContent = msgOf(e)
		}
	}
	// Forgot password: email -> show the account's username + a
	// "Send reset link" button (the link goes to their email).
	$("fgFind").onclick = async () => {
		try {
			const d = await api("/api/forgot", { email: val("fgEmail").trim() })
			$("fgUser").textContent = String(d.username ?? "")
			$("fgSend").textContent = "Send reset link"
			$<HTMLButtonElement>("fgSend").disabled = false
			show("fgResult")
			$("authErr").textContent = ""
		} catch (e) {
			hide("fgResult")
			$("authErr").textContent = msgOf(e)
		}
	}
	// Forgot username: email -> just tells you the username.
	$("fuFind").onclick = async () => {
		try {
			const d = await api("/api/forgot", { email: val("fuEmail").trim() })
			$("fuUser").textContent = String(d.username ?? "")
			show("fuResult")
			$("authErr").textContent = ""
		} catch (e) {
			hide("fuResult")
			$("authErr").textContent = msgOf(e)
		}
	}
	$("fgSend").onclick = async () => {
		try {
			await api("/api/send-reset", { email: val("fgEmail").trim() })
			$("fgSend").textContent = "Link sent: check your email"
			$<HTMLButtonElement>("fgSend").disabled = true
		} catch (e) {
			$("authErr").textContent = msgOf(e)
		}
	}

	return { showChoice, showPane }
}
