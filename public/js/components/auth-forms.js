// Login / signup / forgot-password panes for the homepage. Pure wiring over
// injected deps so it's testable without a network.
export function wireAuthForms(root, { api, onSignedIn, onCapReached }) {
	const $ = (id) => root.getElementById(id)
	const show = (id) => $(id).classList.remove("hidden")
	const hide = (id) => $(id).classList.add("hidden")

	function showChoice() {
		show("authChoice")
		hide("authPanes")
		$("authErr").textContent = ""
	}
	function showPane(name) {
		hide("authChoice")
		show("authPanes")
		root.querySelectorAll("[data-auth-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.authPane !== name))
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
	]) {
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
	for (const [ids, btn] of [
		[["liUser", "liPass"], "liBtn"],
		[["suEmail", "suUser", "suPass"], "suBtn"],
		[["fgEmail"], "fgFind"],
		[["fuEmail"], "fuFind"],
	])
		for (const id of ids)
			$(id).addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault()
					$(btn).click()
				}
			})

	$("liBtn").onclick = async () => {
		try {
			const d = await api("/api/login", { user: $("liUser").value.trim(), password: $("liPass").value })
			onSignedIn(d.user, d.token)
		} catch (e) {
			$("authErr").textContent = e.message
		}
	}
	$("suBtn").onclick = async () => {
		try {
			const d = await api("/api/signup", {
				email: $("suEmail").value.trim(),
				username: $("suUser").value.trim(),
				password: $("suPass").value,
			})
			onSignedIn(d.user, d.token)
		} catch (e) {
			// Account cap hit: hand the attempted email to the waiting-list wall.
			if (e.data?.capReached && onCapReached) return onCapReached($("suEmail").value.trim())
			$("authErr").textContent = e.message
		}
	}
	// Forgot password: email -> show the account's username + a
	// "Send reset link" button (the link goes to their email).
	$("fgFind").onclick = async () => {
		try {
			const d = await api("/api/forgot", { email: $("fgEmail").value.trim() })
			$("fgUser").textContent = d.username
			$("fgSend").textContent = "Send reset link"
			$("fgSend").disabled = false
			show("fgResult")
			$("authErr").textContent = ""
		} catch (e) {
			hide("fgResult")
			$("authErr").textContent = e.message
		}
	}
	// Forgot username: email -> just tells you the username.
	$("fuFind").onclick = async () => {
		try {
			const d = await api("/api/forgot", { email: $("fuEmail").value.trim() })
			$("fuUser").textContent = d.username
			show("fuResult")
			$("authErr").textContent = ""
		} catch (e) {
			hide("fuResult")
			$("authErr").textContent = e.message
		}
	}
	$("fgSend").onclick = async () => {
		try {
			await api("/api/send-reset", { email: $("fgEmail").value.trim() })
			$("fgSend").textContent = "Link sent — check your email"
			$("fgSend").disabled = true
		} catch (e) {
			$("authErr").textContent = e.message
		}
	}

	return { showChoice, showPane }
}
