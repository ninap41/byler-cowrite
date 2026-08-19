// The gimmick layer: the foot bar's 🎲 menu and the dice on the table. A die
// is a DISTRACTION — it tumbles over the live game UI, the writer's editor
// included, and EVERYONE in the session sees every die that's out: yours you
// drag anywhere, flick to throw, click to roll; theirs you just watch. The
// server decides the number, every landing is called in the session chat,
// and a natural 20 mid-writing steals the turn.
//
// Positions are shared as fractions of each viewer's own screen (x/y in
// 0..1), so a die thrown into the top-right corner lands top-right for
// everybody whatever their window size. Pure string builders (menuHtml,
// resultHtml, hintHtml) are exported for tests; mountGimmickDice() is the
// DOM + socket half. It owns no rules — the server does (lib/gimmicks.js).
import { esc, safeColor } from "../util.js"
import { createDie } from "./d20-die.js"

const lockTip = (lock) => `Unlocks at ${lock.name}${lock.min ? " · " + lock.min.toLocaleString() + " words" : ""}`

// The dropdown: one row per gimmick, worded for what this player can do.
//   friendly game → one disabled line explaining why
//   earned (or admin) → Play
//   not earned → 🔒 with the tier — still clickable, because a tablemate's
//                rank lets everyone play (the server has the final word)
export function menuHtml({ catalogue = [], unlocked = [], admin = false, locks = {}, friendly = true, seated = true }) {
	if (!seated) return `<div class="gd-menu-note">Take a seat in a game to play a gimmick.</div>`
	if (friendly) return `<div class="gd-menu-note">💛 This is a friendly game — gimmicks are off.</div>`
	if (!catalogue.length) return `<div class="gd-menu-note">No gimmicks yet.</div>`
	return catalogue
		.map((g) => {
			const can = admin || unlocked.includes(g.id)
			const lock = locks[g.id]
			if (can) return `<button type="button" class="gd-menu-item" data-gimmick="${g.id}" data-act="play">🎲 ${esc(g.name)} · Play</button>`
			const tip = (lock ? lockTip(lock) : "Not unlocked") + " · or play it while a tablemate has it"
			return `<button type="button" class="gd-menu-item locked" data-gimmick="${g.id}" data-act="play" data-tip="${esc(tip)}">🔒 ${esc(g.name)}</button>`
		})
		.join("")
}

// The readout after a landing (mine), or the standing hint.
export const hintHtml = () => `<span class="gd-hint">Drag to move · flick or click to roll · a natural 20 steals the turn</span>`
export function resultHtml({ value, kind, stole, declined = false }) {
	if (kind === "crit")
		return (
			`<b class="gd-result crit">Natural 20!</b><span class="gd-hint">` +
			(stole ? "You stole the turn — go write." : declined ? "You let the writer keep the turn." : "…but the turn wasn't anyone else's to take.") +
			`</span>`
		)
	if (kind === "fumble") return `<b class="gd-result fumble">Natural 1</b><span class="gd-hint">Fumble. Everyone saw that.</span>`
	return `<b class="gd-result">${Number(value)}</b><span class="gd-hint">Roll again</span>`
}

// The layer: my die (a button — the only thing that takes the pointer), the
// others' dice (inert), a small readout with the steal opt-out, and a note.
export const LAYER_HTML = `<div class="gd-layer hidden" id="gimmickLayer" aria-label="Gimmick dice">
	<div id="gdOthers"></div>
	<button type="button" class="gd-die hidden" id="gdDie" aria-label="Roll the die. Drag to move it."></button>
	<div class="gd-hud glass hidden" id="gdHud">
		<b id="gdTitle">🎲 Gimmick</b><span id="gdRead"></span>
		<label class="gd-steal checkline"><input type="checkbox" id="gdSteal" checked /> Steal the turn on a natural 20</label>
		<button type="button" class="ghost gd-away" data-act="exit">↩ Put the die away</button>
	</div>
	<div class="gd-note hidden" id="gdNote" role="status"></div>
</div>
<div class="gd-menu hidden" id="gimmickMenu" role="menu"></div>`

// The steal opt-out is the player's own standing preference (localStorage).
export const STEAL_KEY = "cowriteDiceSteal"
// how often my die's position goes out while dragging / gliding
const MOVE_MS = 60

// opts: { socket, getMyUserId, getMyColor, isSeated, isFriendly, onEnter, onExit, onLand, document }
export function mountGimmickDice(opts) {
	const { socket, getMyColor = () => "#e63946", isSeated = () => true, isFriendly = () => true } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", LAYER_HTML)
	const layer = doc.getElementById("gimmickLayer")
	const menu = doc.getElementById("gimmickMenu")
	const btn = doc.getElementById("gimmickBtn")
	const dot = doc.getElementById("gimmickDot")
	const others = doc.getElementById("gdOthers")
	const dieEl = doc.getElementById("gdDie")
	const hud = doc.getElementById("gdHud")
	const read = doc.getElementById("gdRead")
	const $ = (id) => doc.getElementById(id)
	const myUserId = () => opts.getMyUserId?.() ?? null

	let gate = { catalogue: [], unlocked: [], admin: false, locks: {} }
	let open = false // MY die is out
	let current = null // gimmick id in play
	let die = null
	const remote = new Map() // userId -> { el, die, x, y } — everyone else's dice
	// opt out of stealing: unchecked = a natural 20 is still called, the turn stays
	const stealBox = $("gdSteal")
	let store = null
	try {
		store = win?.localStorage || null
	} catch (e) {}
	stealBox.checked = store?.getItem(STEAL_KEY) !== "0"
	stealBox.addEventListener("change", () => store?.setItem(STEAL_KEY, stealBox.checked ? "1" : "0"))

	// The layer shows whenever ANY die is on the table (mine or theirs).
	const syncLayer = () => layer.classList.toggle("hidden", !open && remote.size === 0)

	// ---- the menu ----
	const paintMenu = () => (menu.innerHTML = menuHtml({ ...gate, friendly: isFriendly(), seated: isSeated() }))
	function showMenu(on) {
		menu.classList.toggle("hidden", !on)
		btn?.setAttribute("aria-expanded", String(on))
		if (on) paintMenu()
	}
	btn?.addEventListener("click", (e) => {
		e.stopPropagation()
		if (open) return exit() // the bar button is the way back too
		showMenu(menu.classList.contains("hidden"))
	})
	doc.addEventListener("click", (e) => {
		if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target !== btn) showMenu(false)
	})
	doc.addEventListener("keydown", (e) => {
		if (e.key === "Escape") showMenu(false)
	})
	menu.addEventListener("click", (e) => {
		e.stopPropagation()
		const b = e.target.closest("button[data-act]")
		if (!b) return
		showMenu(false)
		enter(b.dataset.gimmick)
	})
	layer.addEventListener("click", (e) => {
		if (e.target.closest('[data-act="exit"]')) exit()
	})

	// ---- geometry: my die's top-left in px; shared as fractions of the screen ----
	const dieSize = () => Math.round(Math.max(110, Math.min(190, (win?.innerWidth || 1200) * 0.12)))
	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	const bounds = (s) => ({ minX: 4, minY: 4, maxX: vw() - s - 4, maxY: vh() - s - 4 })
	const toFrac = (px, py, s) => {
		const b = bounds(s)
		return { x: b.maxX > b.minX ? (px - b.minX) / (b.maxX - b.minX) : 0, y: b.maxY > b.minY ? (py - b.minY) / (b.maxY - b.minY) : 0 }
	}
	const fromFrac = (fx, fy, s) => {
		const b = bounds(s)
		return { x: b.minX + fx * (b.maxX - b.minX), y: b.minY + fy * (b.maxY - b.minY) }
	}
	const setPos = (el, px, py) => {
		// left/top, not transform: the global button hover/active rules set
		// transform and would snap the die back to the corner
		el.style.left = px + "px"
		el.style.top = py + "px"
	}

	// ---- my die ----
	let x = 0,
		y = 0
	function place(nx, ny, { send = true } = {}) {
		const b = bounds(dieSize())
		x = clamp(nx, b.minX, b.maxX)
		y = clamp(ny, b.minY, b.maxY)
		setPos(dieEl, x, y)
		if (send) report()
	}
	// throttled: at most one position per MOVE_MS, always the latest
	let reportTimer = null,
		reportDirty = false
	function report(now = false) {
		if (!open) return
		if (now) {
			clearTimeout(reportTimer)
			reportTimer = null
			return sendPos()
		}
		reportDirty = true
		if (reportTimer) return
		reportTimer = setTimeout(() => {
			reportTimer = null
			if (reportDirty) sendPos()
		}, MOVE_MS)
	}
	function sendPos() {
		reportDirty = false
		const f = toFrac(x, y, dieSize())
		socket.emit("gimmick-die", { on: true, x: f.x, y: f.y })
	}

	function enter(id = "d20") {
		if (open) return
		open = true
		current = id
		const g = gate.catalogue.find((c) => c.id === id)
		$("gdTitle").textContent = `🎲 ${g?.name || "Gimmick"}`
		read.innerHTML = hintHtml()
		dieEl.classList.remove("hidden")
		hud.classList.remove("hidden")
		syncLayer()
		if (btn) btn.textContent = "↩ Put the die away"
		if (!die) die = createDie(dieEl, { color: getMyColor(), size: dieSize() })
		else {
			die.setColor(getMyColor())
			die.setSize(dieSize())
		}
		const s = dieSize()
		place((vw() - s) / 2, (vh() - s) / 2, { send: false })
		report(true)
		opts.onEnter?.()
	}
	function exit() {
		if (!open) return
		open = false
		clearTimeout(reportTimer)
		reportTimer = null
		dieEl.classList.add("hidden")
		hud.classList.add("hidden")
		syncLayer()
		if (btn) btn.textContent = "🎲 Play gimmick"
		socket.emit("gimmick-die", { on: false })
		opts.onExit?.()
	}

	// drag / flick / click
	let dragging = false,
		moved = false,
		ox = 0,
		oy = 0, // where the press started (a click is a release within 6px of it)
		px = 0,
		py = 0,
		vx = 0,
		vy = 0,
		lastT = 0,
		throwRaf = 0
	const perfNow = () => (win?.performance || performance).now()
	dieEl.addEventListener("pointerdown", (e) => {
		if (e.button != null && e.button !== 0) return
		dragging = true
		moved = false
		ox = px = e.clientX
		oy = py = e.clientY
		vx = vy = 0
		lastT = perfNow()
		if (win) win.cancelAnimationFrame?.(throwRaf)
		dieEl.setPointerCapture?.(e.pointerId)
		dieEl.classList.add("grabbing")
		e.preventDefault()
	})
	dieEl.addEventListener("pointermove", (e) => {
		if (!dragging) return
		const now = perfNow()
		const dx = e.clientX - px,
			dy = e.clientY - py
		const dt = Math.max(16, now - lastT)
		vx = (dx / dt) * 1000
		vy = (dy / dt) * 1000
		px = e.clientX
		py = e.clientY
		lastT = now
		if (Math.hypot(e.clientX - ox, e.clientY - oy) > 6) moved = true
		place(x + dx, y + dy)
	})
	const release = (e) => {
		if (!dragging) return
		dragging = false
		dieEl.classList.remove("grabbing")
		dieEl.releasePointerCapture?.(e.pointerId)
		if (!moved) return roll() // a click
		// a hard flick throws the die and rolls it; a slow drop just moves it
		if (Math.hypot(vx, vy) > 650) {
			throwTo(x + vx * 0.22, y + vy * 0.22)
			roll()
		} else report(true)
	}
	dieEl.addEventListener("pointerup", release)
	dieEl.addEventListener("pointercancel", release)
	dieEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			roll()
		}
	})
	// glide to the landing spot (power3.out over ~1s), clamped to the screen
	function throwTo(tx, ty) {
		const b = bounds(dieSize())
		tx = clamp(tx, b.minX, b.maxX)
		ty = clamp(ty, b.minY, b.maxY)
		const sx = x,
			sy = y
		const t0 = perfNow()
		const step = (now) => {
			const p = Math.min(1, (now - t0) / 1000)
			const k = 1 - Math.pow(1 - p, 3)
			place(sx + (tx - sx) * k, sy + (ty - sy) * k)
			if (p < 1 && win) throwRaf = win.requestAnimationFrame(step)
			else report(true)
		}
		if (win?.requestAnimationFrame) throwRaf = win.requestAnimationFrame(step)
		else place(tx, ty)
	}

	// ---- rolling: the server decides, the die shows ----
	let rollLock = false
	let noteTimer = null
	function note(text) {
		const n = $("gdNote")
		n.textContent = text
		n.classList.remove("hidden")
		clearTimeout(noteTimer)
		noteTimer = setTimeout(() => n.classList.add("hidden"), 3200)
	}
	function roll() {
		if (rollLock || !open) return
		rollLock = true
		read.innerHTML = `<span class="gd-hint">Rolling…</span>`
		socket.emit("gimmick-roll", { id: current, steal: stealBox.checked }, (ack) => {
			if (!ack?.ok) {
				rollLock = false
				read.innerHTML = hintHtml()
				if (ack?.error) note(ack.error)
				return
			}
			// no sound here: the chat line carries the chime (nat 20 only)
			die.rollTo(ack.value, {
				onLand: () => {
					rollLock = false
					read.innerHTML = resultHtml({ ...ack, declined: ack.kind === "crit" && !ack.stole && !stealBox.checked })
					opts.onLand?.(ack)
				},
			})
		})
	}

	// ---- everyone else's dice ----
	function upsertRemote({ userId, name, color, x: fx, y: fy }) {
		let r = remote.get(userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "gd-die remote"
			el.title = `${name}'s die`
			const stage = doc.createElement("div")
			el.appendChild(stage)
			el.insertAdjacentHTML("beforeend", `<span class="gd-die-tag" style="color:${safeColor(color)}">${esc(name)}</span>`)
			others.appendChild(el)
			r = { el, die: createDie(stage, { color, size: dieSize() }), x: 0, y: 0 }
			remote.set(userId, r)
		} else r.die.setColor(color)
		r.x = fx
		r.y = fy
		const p = fromFrac(fx, fy, dieSize())
		setPos(r.el, p.x, p.y)
		syncLayer()
	}
	function dropRemote(userId) {
		const r = remote.get(userId)
		if (!r) return
		r.die.destroy()
		r.el.remove()
		remote.delete(userId)
		syncLayer()
	}
	socket.on("gimmick-die", (d) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId)
		else upsertRemote(d)
	})
	socket.on("gimmick-dice", (list) => {
		for (const d of list || []) if (d.userId !== myUserId()) upsertRemote(d)
	})
	// Someone else's landing: their die tumbles to it (mine lands off its ack).
	socket.on("gimmick-roll", (r) => {
		if (!r || r.userId === myUserId()) return
		remote.get(r.userId)?.die.rollTo(r.value)
	})

	if (doc && typeof doc.addEventListener === "function")
		doc.addEventListener("visibilitychange", () => {
			if (doc.visibilityState !== "visible") return
			die?.settleNow()
			for (const r of remote.values()) r.die.settleNow()
		})
	win?.addEventListener?.("resize", () => {
		const s = dieSize()
		if (open) {
			die?.setSize(s)
			place(x, y, { send: false })
		}
		for (const r of remote.values()) {
			r.die.setSize(s)
			const p = fromFrac(r.x, r.y, s)
			setPos(r.el, p.x, p.y)
		}
	})

	return {
		setGate(g) {
			gate = { ...gate, ...g }
			if (!menu.classList.contains("hidden")) paintMenu()
		},
		// The foot-bar button only means something once I'm seated.
		setSeated(on) {
			btn?.classList.toggle("hidden", !on)
			dot?.classList.toggle("hidden", !on)
			if (!on) exit()
		},
		enter,
		exit,
		roll,
		get open() {
			return open
		},
		get position() {
			return { x, y }
		},
		get others() {
			return [...remote.keys()]
		},
	}
}
