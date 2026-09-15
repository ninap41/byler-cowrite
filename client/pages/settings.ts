import { api } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { PALETTE, safeColor, isHex } from "/js/util.js"
import type { ChipUser } from "/js/chrome.js"
import type { SoundPrefs } from "/js/sounds.js"

/** The signed-in account as /api/me and the account routes ship it — what this page edits. */
interface Me extends ChipUser {
	email?: string
	about?: string
	links?: { label?: string; url?: string }[]
	sounds?: Partial<SoundPrefs> | boolean | null
	isAMemberOfBylerOffscreen?: boolean
}

mountChrome({ page: "settings" })
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id)
let me = await requireAuth<Me>("/")

// Collapsible account sections — one open at a time keeps the page calm.
const toggles = [...document.querySelectorAll<HTMLElement>(".sec-toggle")]
toggles.forEach((btn) => {
	btn.onclick = () => {
		const body = $(btn.dataset.toggle || "")
		const opening = body.classList.contains("hidden")
		toggles.forEach((b) => {
			$(b.dataset.toggle || "").classList.add("hidden")
			b.setAttribute("aria-expanded", "false")
		})
		if (opening) {
			body.classList.remove("hidden")
			btn.setAttribute("aria-expanded", "true")
			body.querySelector<HTMLInputElement>("input")?.focus()
		}
	}
})

const say = (ok: boolean, msg: string) => {
	$("setErr").textContent = ok ? "" : msg
	$("setOk").textContent = ok ? msg : ""
}
// The stored About is server-sanitized html; turn it back into the
// editable source (plain <img src="…"> tags, entities unescaped).
const aboutSource = (html: unknown) =>
	String(html || "")
		.replace(/<img class="about-img" src="(.*?)" alt="" loading="lazy">/g, '<img src="$1">')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
// Profile links live in this array; chips render from it and the ✕
// splices it (the tag-chips pattern). Save profile persists the array.
let links: { label: string; url: string }[] = []
function renderLinks() {
	const box = $("linkChips")
	box.innerHTML = ""
	links.forEach((l, i) => {
		const chip = document.createElement("span")
		chip.className = "tag-chip"
		chip.append("🔗 " + (l.label || l.url))
		chip.title = l.url
		const x = document.createElement("button")
		x.type = "button"
		x.textContent = "✕"
		x.setAttribute("aria-label", "Remove link " + (l.label || l.url))
		x.onclick = () => {
			links.splice(i, 1)
			renderLinks()
		}
		chip.appendChild(x)
		box.appendChild(chip)
	})
	const full = links.length >= 3
	$("addLinkBtn").classList.toggle("hidden", full)
	$("linkMax").classList.toggle("hidden", !full)
}

// The add-link modal (the site's .confirm-modal shape).
const linkModal = $("linkModal")
const openLinkModal = () => {
	input("linkLabel").value = input("linkUrl").value = ""
	$("linkErr").textContent = ""
	linkModal.classList.remove("hidden")
	input("linkLabel").focus()
}
const closeLinkModal = () => linkModal.classList.add("hidden")
$("addLinkBtn").onclick = openLinkModal
$("linkCancel").onclick = closeLinkModal
linkModal.addEventListener("click", (e) => {
	if (e.target === linkModal) closeLinkModal()
})
linkModal.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closeLinkModal()
	if (e.key === "Enter") $("linkAdd").click()
})
$("linkAdd").onclick = () => {
	const label = input("linkLabel").value.trim()
	const url = input("linkUrl").value.trim()
	if (!/^https?:\/\//i.test(url)) {
		$("linkErr").textContent = "Links must start with http:// or https://."
		return
	}
	if (links.length >= 3) return closeLinkModal()
	links.push({ label: label || url.slice(0, 40), url })
	renderLinks()
	closeLinkModal()
	say(true, "Link added: hit Save profile to keep it.")
}

function fill() {
	if (!me) return
	setUserChip(me)
	input("setUsername").value = me.username
	input("setEmail").value = me.email || ""
	input("setAvatar").value = me.avatar || ""
	$<HTMLSelectElement>("setAvatarFit").value = me.avatarFit === "contain" ? "contain" : "cover"
	$<HTMLTextAreaElement>("setAbout").value = aboutSource(me.about)
	const snd: Partial<SoundPrefs> = typeof me.sounds === "object" && me.sounds !== null ? me.sounds : {}
	input("sndChat").checked = snd.chat !== false
	input("sndStory").checked = snd.story !== false
	input("sndClock").checked = snd.clock !== false
	input("sndGimmick").checked = snd.gimmick !== false
	input("setMember").checked = me.isAMemberOfBylerOffscreen === true
	links = (me.links || []).map((l) => ({ label: l.label || "", url: l.url || "" }))
	renderLinks()
	const mine = safeColor(me.color)
	document.querySelectorAll<HTMLElement>(".swatch").forEach((x) => x.classList.toggle("sel", x.dataset.color === mine))
	// a colour off the palette lights the Custom well instead of a swatch
	input("colorPick").value = mine
	input("colorHex").value = mine
	$("colorPickRing").style.background = mine
	input("colorPick").parentElement!.classList.toggle("sel", !PALETTE.includes(mine))
	paintPreview(mine)
}
function paintPreview(c: string) {
	const p = $("colorPreview")
	p.textContent = me?.username || ""
	p.style.color = c
}
function saveColor(c: string) {
	return api<{ user: Partial<Me> }>("/api/account/color", { color: c })
		.then((r) => {
			me = { ...me!, ...r.user }
			fill()
			say(true, "Color saved.")
		})
		.catch((e) => say(false, (e as Error).message))
}
// the picker paints live and saves on change; the hex box saves on
// Enter or on leaving the field
input("colorPick").oninput = () => {
	const c = input("colorPick").value
	input("colorHex").value = c
	$("colorPickRing").style.background = c
	paintPreview(c)
}
input("colorPick").onchange = () => saveColor(input("colorPick").value)
input("colorHex").oninput = () => {
	let v = input("colorHex").value.trim()
	if (v && v[0] !== "#") v = "#" + v
	if (isHex(v)) {
		input("colorPick").value = v.toLowerCase()
		$("colorPickRing").style.background = v
		paintPreview(v)
	}
}
function commitHex() {
	let v = input("colorHex").value.trim()
	if (v && v[0] !== "#") v = "#" + v
	if (!isHex(v)) return say(false, "A colour is six hex digits, like #ff8800.")
	if (v.toLowerCase() === safeColor(me?.color)) return
	saveColor(v.toLowerCase())
}
input("colorHex").onkeydown = (e) => {
	if (e.key === "Enter") {
		e.preventDefault()
		commitHex()
	}
}
input("colorHex").onchange = commitHex

const sw = $("swatches")
PALETTE.forEach((c) => {
	const d = document.createElement("div")
	d.className = "swatch"
	d.style.background = c
	d.dataset.color = c
	d.onclick = () => saveColor(c)
	sw.appendChild(d)
})

input("setMember").onchange = async () => {
	try {
		const r = await api<{ user: Partial<Me> }>("/api/account/membership", { isAMemberOfBylerOffscreen: input("setMember").checked })
		me = { ...me!, ...r.user }
		say(true, input("setMember").checked ? "Marked as a Byler Offscreen member." : "Membership unmarked.")
	} catch (e) {
		say(false, (e as Error).message)
	}
}

// Sounds save the moment a box is toggled — no separate save button.
for (const id of ["sndChat", "sndStory", "sndClock", "sndGimmick"])
	$(id).onchange = async () => {
		try {
			const r = await api<{ user: Partial<Me> }>("/api/account/sounds", {
				chat: input("sndChat").checked,
				story: input("sndStory").checked,
				clock: input("sndClock").checked,
				gimmick: input("sndGimmick").checked,
			})
			me = { ...me!, ...r.user }
			say(true, "Sound settings saved.")
		} catch (e) {
			say(false, (e as Error).message)
		}
	}

$("saveUsername").onclick = async () => {
	try {
		const r = await api<{ user: Partial<Me> }>("/api/account/username", { username: input("setUsername").value.trim() })
		me = { ...me!, ...r.user }
		fill()
		say(true, "Username saved.")
	} catch (e) {
		say(false, (e as Error).message)
	}
}
$("saveProfile").onclick = async () => {
	try {
		const r = await api<{ user: Partial<Me> }>("/api/account/profile", {
			about: $<HTMLTextAreaElement>("setAbout").value,
			links,
			avatar: input("setAvatar").value.trim(),
			avatarFit: $<HTMLSelectElement>("setAvatarFit").value,
		})
		me = { ...me!, ...r.user }
		fill()
		say(true, "Profile saved.")
	} catch (e) {
		say(false, (e as Error).message)
	}
}
$("saveEmail").onclick = async () => {
	try {
		const r = await api<{ user: Partial<Me> }>("/api/account/email", { email: input("setEmail").value.trim(), password: input("emailPass").value })
		me = { ...me!, ...r.user }
		input("emailPass").value = ""
		fill()
		say(true, "Email saved.")
	} catch (e) {
		say(false, (e as Error).message)
	}
}
$("savePass").onclick = async () => {
	try {
		await api("/api/account/password", { oldPassword: input("oldPass").value, newPassword: input("newPass").value })
		input("oldPass").value = input("newPass").value = ""
		say(true, "Password changed: other devices were signed out.")
	} catch (e) {
		say(false, (e as Error).message)
	}
}
fill()
