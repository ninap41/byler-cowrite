// The Rink-O-Mania Disco Ball gimmick (see lib/gimmicks.js): a mirrored ball
// you hang anywhere over the live game — it dangles by a chain to the top
// edge — and SPIN: for the length of one show, colored light spots sweep the
// whole page, tinted in the seated players' palette colours. No steal, pure
// distraction, the milkshake's category.
//
// Shared exactly like the cups: the owner streams their ball's position
// (`gimmick-ball {on, x, y}`, fractions, throttled) and a spin goes up as
// `gimmick-spin`, which the server calls in the chat (cooldown = the show's
// length) and relays with a `duration` — every viewer then runs the light
// show locally from that one event; no light spot ever crosses the wire.
// Pure string builders (ballSvg, layerHtml, spotColors) are exported for
// tests; mountDiscoBall() is the DOM + socket half.
import { esc, safeColor } from "../util.js"

export const BALL_W = 76 // on-screen ball width (viewBox is 100x100)
const MOVE_MS = 80 // how often my ball goes out (cups use the same)
const SPOTS_PER_SPIN = 8 // one show's light spots
const MAX_SPOTS = 16 // hard cap across overlapping shows — oldest show trims
const SPOT_R = 150 // a spot's radius, px

// The mirror ball. Every SVG id is suffixed `key` because ids are
// document-global and several balls share the page. Not tinted — a disco
// ball is silver for everyone; whose it is lives in the name tag.
export function ballSvg(key) {
	const rows = []
	// facet grid: latitude bands of small rects, denser toward the equator
	for (let ry = 8; ry < 100; ry += 12) {
		for (let rx = (ry / 12) % 2 ? 2 : 8; rx < 100; rx += 12) rows.push(`<rect x="${rx}" y="${ry}" width="9" height="9" rx="1"/>`)
	}
	return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
	<defs>
		<radialGradient id="dbshine${key}" cx="0.35" cy="0.3" r="0.9">
			<stop offset="0" stop-color="#f4f7ff"/><stop offset="0.55" stop-color="#aeb6c8"/><stop offset="1" stop-color="#5a6274"/>
		</radialGradient>
		<clipPath id="dbclip${key}"><circle cx="50" cy="50" r="46"/></clipPath>
	</defs>
	<circle cx="50" cy="50" r="46" fill="url(#dbshine${key})"/>
	<g class="db-facets" clip-path="url(#dbclip${key})" fill="#e8ecf6" opacity=".5" stroke="#3c4254" stroke-width=".6">${rows.join("")}</g>
	<circle cx="50" cy="50" r="46" fill="none" stroke="#2c3140" stroke-width="2"/>
	<ellipse cx="36" cy="30" rx="14" ry="9" fill="#fff" opacity=".55"/>
</svg>`
}

export const layerHtml = () => `<div class="db-layer hidden" id="dbLayer" aria-label="Disco ball">
	<div id="dbLights"></div>
	<div id="dbOthers"></div>
	<button type="button" class="db-ball hidden" id="dbBall" aria-label="Disco ball. Drag to move, click to spin."></button>
	<div class="db-hud glass hidden" id="dbHud">
		<b class="db-title">🪩 Rink-O-Mania Disco Ball</b>
		<span class="db-hint" id="dbHint">Drag to hang it · click to spin the lights</span>
		<div class="db-row">
			<button type="button" data-act="db-spin">Spin</button>
			<button type="button" class="ghost" data-act="db-exit">↩ Put the ball away</button>
		</div>
	</div>
</div>`

// One show's spot colours: the owner's colour first, then the table's,
// repeated to fill — so simultaneous shows read as whose they are.
export function spotColors(ownerColor, tableColors = [], n = SPOTS_PER_SPIN) {
	const pool = [safeColor(ownerColor), ...tableColors.map((c) => safeColor(c))]
	return Array.from({ length: n }, (_, i) => pool[i % pool.length])
}

// opts: { socket, getMyUserId, getMyColor, getMyName, getTableColors, document }
export function mountDiscoBall(opts) {
	const { socket } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("dbLayer")
	const ballEl = doc.getElementById("dbBall")
	const othersBox = doc.getElementById("dbOthers")
	const lightsBox = doc.getElementById("dbLights")
	const hud = doc.getElementById("dbHud")
	const hint = doc.getElementById("dbHint")
	const myUserId = () => opts.getMyUserId?.() ?? null

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	// A ball is positioned by its CENTER (left/top %), chain drawn up from it.
	const setPos = (el, px, py) => {
		el.style.left = Math.round(px) + "px"
		el.style.top = Math.round(py) + "px"
		const chain = el.querySelector(".db-chain")
		if (chain) chain.style.height = Math.max(0, Math.round(py - BALL_W / 2)) + "px"
	}
	const ballInner = (key, name, color) =>
		`<span class="db-chain"></span>` + ballSvg(key) +
		(name ? `<span class="db-tag" style="color:${safeColor(color)}">${esc(name)}</span>` : "")

	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}

	// ---- the light show: spot sets keyed by owner, one shared rAF loop ----
	// spot: { el, color, ax, bx, fx, fy, phx, phy, born, dur, dead }
	const shows = new Map() // ownerId -> spot[]
	let raf = 0, looping = false
	const totalSpots = () => [...shows.values()].reduce((n, set) => n + set.length, 0)
	function startShow(ownerId, ownerColor, duration) {
		endShow(ownerId) // a repeat spin replaces its owner's set
		while (totalSpots() + SPOTS_PER_SPIN > MAX_SPOTS && shows.size) endShow(shows.keys().next().value)
		const colors = spotColors(ownerColor, opts.getTableColors?.() ?? [])
		// deterministic-ish seeds from the owner id so every viewer's sweep is similar
		const seed = [...String(ownerId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
		const set = colors.map((color, i) => {
			const el = doc.createElement("div")
			el.className = "db-spot"
			el.style.background = `radial-gradient(circle, ${color} 0%, transparent 68%)`
			lightsBox.appendChild(el)
			const k = seed + i * 137
			return {
				el, color,
				fx: 0.10 + ((k * 7) % 100) / 400, fy: 0.13 + ((k * 13) % 100) / 400, // sweep speeds, Hz-ish
				phx: (k % 63) / 10, phy: (k % 47) / 10, // phases
				born: nowMs(), dur: Math.max(1000, Number(duration) || 8000), dead: false,
			}
		})
		shows.set(ownerId, set)
		syncLayer()
		loop()
	}
	function endShow(ownerId, { fade = false } = {}) {
		const set = shows.get(ownerId)
		if (!set) return
		shows.delete(ownerId)
		for (const sp of set) fade ? fadeOut(sp.el, () => sp.el.remove()) : sp.el.remove()
		syncLayer()
	}
	const nowMs = () => (win?.performance || performance).now()
	function loop() {
		if (looping || !win?.requestAnimationFrame) return
		looping = true
		raf = win.requestAnimationFrame(frame)
	}
	function frame(now) {
		if (!shows.size || layer.classList.contains("hidden")) {
			looping = false
			return
		}
		for (const [ownerId, set] of [...shows.entries()]) {
			const t = (now - set[0].born) / 1000
			const dur = set[0].dur
			const age = now - set[0].born
			if (age > dur + 600) { endShow(ownerId); continue }
			// fade in 300ms, hold, fade out over the last 600ms past dur
			const alpha = age < 300 ? age / 300 : age > dur ? Math.max(0, 1 - (age - dur) / 600) : 1
			set.forEach((sp, i) => {
				// slow Lissajous sweep across the whole viewport
				const x = (0.5 + 0.48 * Math.sin(6.283 * sp.fx * t + sp.phx)) * vw()
				const y = (0.5 + 0.46 * Math.sin(6.283 * sp.fy * t + sp.phy)) * vh()
				sp.el.style.transform = `translate(${Math.round(x - SPOT_R)}px, ${Math.round(y - SPOT_R)}px)`
				sp.el.style.opacity = (alpha * 0.5).toFixed(2)
			})
		}
		raf = win.requestAnimationFrame(frame)
	}

	// ---- my ball ----
	let open = false, x = 0, y = 0
	const remote = new Map() // userId -> { el, x, y }
	const syncLayer = () => {
		const on = open || remote.size > 0 || shows.size > 0
		layer.classList.toggle("hidden", !on)
	}

	// relaying my ball
	let reportTimer = null
	function report(now = false) {
		if (!open) return
		if (!now) {
			if (reportTimer) return
			reportTimer = setTimeout(() => {
				reportTimer = null
				sendBall()
			}, MOVE_MS)
			return
		}
		clearTimeout(reportTimer)
		reportTimer = null
		sendBall()
	}
	function sendBall() {
		socket.emit("gimmick-ball", {
			on: true,
			x: clamp(x / Math.max(1, vw()), 0, 1),
			y: clamp(y / Math.max(1, vh()), 0, 1),
		})
	}

	// dragging: same feel as the cup — a clean click spins
	let dragging = false, moved = false, ox = 0, oy = 0
	ballEl.addEventListener("pointerdown", (e) => {
		if (e.button != null && e.button !== 0) return
		dragging = true
		moved = false
		ox = e.clientX
		oy = e.clientY
		ballEl.setPointerCapture?.(e.pointerId)
		ballEl.classList.add("grabbing")
		e.preventDefault()
	})
	ballEl.addEventListener("pointermove", (e) => {
		if (!dragging) return
		if (Math.hypot(e.clientX - ox, e.clientY - oy) > 6) moved = true
		x = clamp(e.clientX, BALL_W / 2, vw() - BALL_W / 2)
		y = clamp(e.clientY, BALL_W / 2, vh() - BALL_W / 2)
		setPos(ballEl, x, y)
		report()
	})
	const release = (e) => {
		if (!dragging) return
		dragging = false
		ballEl.classList.remove("grabbing")
		ballEl.releasePointerCapture?.(e.pointerId)
		if (!moved) return spin() // a clean click lights it up
		report(true)
	}
	ballEl.addEventListener("pointerup", release)
	ballEl.addEventListener("pointercancel", release)
	ballEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			spin()
		}
	})

	function spin() {
		if (!open) return
		// the server calls it in chat (and is the cooldown); the relayed
		// gimmick-spin — my own included — is what starts the show.
		socket.emit("gimmick-spin", {}, (ack) => {
			if (!ack?.ok && ack?.error) hint.textContent = ack.error
			else if (ack?.ok) hint.textContent = "Lights! 🪩"
		})
	}

	// ---- HUD ----
	layer.addEventListener("click", (e) => {
		if (e.target.closest('[data-act="db-exit"]')) exit()
		else if (e.target.closest('[data-act="db-spin"]')) spin()
	})

	function start() {
		if (open) return
		open = true
		const myName = opts.getMyName?.() || ""
		ballEl.innerHTML = ballInner("me", myName, opts.getMyColor?.())
		ballEl.classList.remove("hidden")
		hud.classList.remove("hidden")
		hint.textContent = "Drag to hang it · click to spin the lights"
		x = vw() * 0.72
		y = vh() * 0.28
		setPos(ballEl, x, y)
		ballEl.querySelector("svg")?.classList.remove("spinning")
		syncLayer()
		report(true)
	}
	function exit({ fade = false } = {}) {
		if (!open) return
		open = false
		clearTimeout(reportTimer)
		reportTimer = null
		const done = () => {
			ballEl.classList.add("hidden")
			hud.classList.add("hidden")
			syncLayer()
		}
		if (fade) {
			fadeOut(ballEl, done)
			fadeOut(hud, () => {})
		} else done()
		socket.emit("gimmick-ball", { on: false })
	}

	// The table went friendly: every ball and every light fades away rather
	// than blinking off. Returns whether anything was out.
	function gimmicksOff() {
		const had = open || remote.size > 0 || shows.size > 0
		for (const uid of [...shows.keys()]) endShow(uid, { fade: true })
		for (const uid of [...remote.keys()]) dropRemote(uid, { fade: true })
		if (open) exit({ fade: true })
		return had
	}

	// ---- everyone else's balls ----
	function upsertRemote(d) {
		let r = remote.get(d.userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "db-ball remote"
			el.innerHTML = ballInner(d.userId, d.name, d.color)
			othersBox.appendChild(el)
			r = { el, x: 0, y: 0 }
			remote.set(d.userId, r)
		}
		r.x = d.x
		r.y = d.y
		setPos(r.el, d.x * vw(), d.y * vh())
		syncLayer()
	}
	function dropRemote(userId, { fade = false } = {}) {
		const r = remote.get(userId)
		if (!r) return
		remote.delete(userId) // out of the map now; the fade only delays the DOM
		const done = () => {
			r.el.remove()
			syncLayer()
		}
		fade ? fadeOut(r.el, done) : done()
	}
	socket.on("gimmick-ball", (d) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId, { fade: true })
		else upsertRemote(d)
	})
	socket.on("gimmick-balls", (list) => {
		for (const d of list || []) if (d.userId !== myUserId()) upsertRemote(d)
	})
	// One spin lights every screen — mine included (my own relay starts my show,
	// so the animation and the chat call can never disagree).
	socket.on("gimmick-spin", (d) => {
		if (!d?.userId) return
		const el = d.userId === myUserId() ? ballEl : remote.get(d.userId)?.el
		el?.querySelector("svg")?.classList.add("spinning")
		const dur = Math.max(1000, Number(d.duration) || 8000)
		startShow(d.userId, d.color, dur)
		setTimeout(() => el?.querySelector("svg")?.classList.remove("spinning"), dur)
	})

	win?.addEventListener?.("resize", () => {
		if (!open) return
		x = clamp(x, BALL_W / 2, vw() - BALL_W / 2)
		y = clamp(y, BALL_W / 2, vh() - BALL_W / 2)
		setPos(ballEl, x, y)
	})

	return {
		start,
		exit,
		spin,
		gimmicksOff,
		get open() {
			return open
		},
		get others() {
			return [...remote.keys()]
		},
		get spotCount() {
			return totalSpots()
		},
	}
}
