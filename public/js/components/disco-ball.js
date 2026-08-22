// The Rink-O-Mania Disco Ball gimmick (see lib/gimmicks.js): a mirrored ball
// you hang anywhere over the live game — it dangles by a chain to the top
// edge — and SPIN: for the length of one show, colored light spots orbit the
// ball and a beam fan turns under it (the repo-root disco-ball.html look),
// tinted in the seated players' palette colours. No steal, pure
// distraction, the milkshake's category.
//
// Shared exactly like the cups: the owner streams their ball's position
// (`gimmick-ball {on, x, y}`, fractions, throttled) and a spin goes up as
// `gimmick-spin`, which the server calls in the chat (cooldown = the show's
// length) and relays with a `duration` — every viewer then runs the light
// show locally from that one event; no light spot ever crosses the wire.
// Pure string builders (ballHtml, layerHtml, spotColors) are exported for
// tests; mountDiscoBall() is the DOM + socket half.
import { esc, safeColor } from "../util.js"

export const BALL_W = 76 // on-screen ball width (viewBox is 100x100)
const MOVE_MS = 80 // how often my ball goes out (cups use the same)
const SPOTS_PER_SPIN = 8 // one show's light spots
const MAX_SPOTS = 16 // hard cap across overlapping shows — oldest show trims
const SPOT_R = 13 // a spot dot's radius, px (the reference's 26px dot; size comes from scale())

// The mirror ball: a real CSS-3D sphere of mirror tiles (latitude bands of
// small quads, denser toward the equator, each rotated into place and pushed
// out by the sphere radius), turning forever inside a perspective stage, with
// a dark core behind the tiles, a shade + specular overlay that stay put
// while it turns, a screen-blend halo, and per-tile glints. Adapted from the
// repo-root `disco-ball.html` reference, shrunk to a draggable 76px ball.
// Not tinted — a disco ball is silver for everyone; whose it is lives in the
// name tag. Pure string builder: every per-tile "random" (glint timing,
// brightness) is derived from `key` + tile index, so the same ball rebuilds
// identically and two balls on one page shimmer differently.
const BALL_R = 34 // sphere radius inside the 76px button
const BALL_ROWS = 12 // latitude bands
const frac = (n) => {
	const x = Math.sin(n) * 43758.5453
	return x - Math.floor(x)
}
export function ballHtml(key) {
	const seed = [...String(key)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
	const tileH = (Math.PI * BALL_R) / BALL_ROWS
	const tiles = []
	for (let i = 0; i < BALL_ROWS; i++) {
		const lat = -90 + (180 * (i + 0.5)) / BALL_ROWS
		const ringR = Math.cos((lat * Math.PI) / 180) * BALL_R
		const count = Math.max(4, Math.round((2 * Math.PI * ringR) / tileH))
		const tileW = (2 * Math.PI * ringR) / count
		for (let j = 0; j < count; j++) {
			const lon = (360 * j) / count + (i % 2 ? 180 / count : 0)
			const k = seed + i * 977 + j * 137
			const w = (tileW + 0.6).toFixed(2)
			const h = (tileH + 0.6).toFixed(2)
			tiles.push(
				`<i class="db-facet" style="width:${w}px;height:${h}px;margin:${(-(tileH + 0.6) / 2).toFixed(2)}px 0 0 ${(-(tileW + 0.6) / 2).toFixed(2)}px;` +
					`transform:rotateY(${lon.toFixed(1)}deg) rotateX(${lat.toFixed(1)}deg) translateZ(${BALL_R}px);` +
					`--dur:${(3 + frac(k) * 7).toFixed(2)}s;--delay:${(-frac(k + 1) * 10).toFixed(2)}s;` +
					`filter:brightness(${(0.82 + frac(k + 2) * 0.36).toFixed(2)})"></i>`
			)
		}
	}
	return `<span class="db-ball3d">
	<span class="db-halo"></span>
	<span class="db-core"></span>
	<span class="db-stage"><span class="db-facets">${tiles.join("")}</span></span>
	<span class="db-shade"></span>
	<span class="db-spec"></span>
</span>`
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
		`<span class="db-chain"></span>` + ballHtml(key) +
		(name ? `<span class="db-tag" style="color:${safeColor(color)}">${esc(name)}</span>` : "")

	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}

	// ---- the light show, the reference's way (see repo-root disco-ball.html):
	// each show's spots ORBIT its owner's ball — small blurred dots on tilted
	// elliptical sweeps, swelling and brightening on the near side, flickering
	// — under a fan of blurred beams turning in step. The orbit centre is read
	// every frame, so the lights follow a ball being dragged mid-show. One
	// shared rAF loop; nothing here crosses the wire.
	// show: { spots: [{el, radius, yLift, tilt, size, phase, flickF, flickP}], beams, born, dur }
	const shows = new Map() // ownerId -> show
	let raf = 0, looping = false
	const ORBIT_S = 7 // seconds per sweep around the ball (the reference's SPIN, hurried)
	const BEAMS = 12
	const totalSpots = () => [...shows.values()].reduce((n, s) => n + s.spots.length, 0)
	// where a show's lights hang: its owner's ball, mine or theirs
	function showCenter(ownerId) {
		if (ownerId === myUserId() && open) return [x, y]
		const r = remote.get(ownerId)
		if (r) return [r.x * vw(), r.y * vh()]
		return [vw() / 2, vh() * 0.38] // owner's ball already gone — the reference's spot
	}
	function startShow(ownerId, ownerColor, duration) {
		endShow(ownerId) // a repeat spin replaces its owner's set
		while (totalSpots() + SPOTS_PER_SPIN > MAX_SPOTS && shows.size) endShow(shows.keys().next().value)
		const colors = spotColors(ownerColor, opts.getTableColors?.() ?? [])
		// deterministic-ish seeds from the owner id so every viewer's sweep is similar
		const seed = [...String(ownerId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
		const fit = Math.min(1.15, Math.max(0.42, Math.min(vw() / 760, vh() / 620))) // the reference's viewport fit
		const spots = colors.map((color, i) => {
			const el = doc.createElement("div")
			el.className = "db-spot"
			el.style.background = `radial-gradient(circle, ${color} 0%, rgba(255,255,255,.28) 40%, transparent 70%)`
			lightsBox.appendChild(el)
			const k = seed + i * 137
			return {
				el,
				radius: (240 + frac(k) * 640) * fit,
				yLift: (-260 + frac(k + 1) * 620) * fit,
				tilt: 0.44 * (0.3 + frac(k + 2) * 0.3), // the reference's two stacked scaleY()s
				size: 0.5 + frac(k + 3) * 1.9,
				phase: frac(k + 4) * 6.283,
				flickF: 0.4 + frac(k + 5) * 1.2, flickP: frac(k + 6) * 6.283, // shimmer, Hz + phase
			}
		})
		// the beam fan under the ball, turning with the orbit
		const beams = doc.createElement("div")
		beams.className = "db-beams"
		for (let b = 0; b < BEAMS; b++) {
			const bm = doc.createElement("i")
			bm.className = "db-beam"
			bm.style.transform = `rotate(${((360 / BEAMS) * b + frac(seed + b) * 8 - 4).toFixed(1)}deg)`
			bm.style.opacity = (0.35 + frac(seed + b + 50) * 0.65).toFixed(2)
			bm.style.width = Math.round(40 + frac(seed + b + 90) * 70) + "px"
			bm.style.height = Math.round(540 * fit) + "px"
			beams.appendChild(bm)
		}
		lightsBox.appendChild(beams)
		shows.set(ownerId, { spots, beams, born: nowMs(), dur: Math.max(1000, Number(duration) || 8000) })
		syncLayer()
		loop()
	}
	function endShow(ownerId, { fade = false } = {}) {
		const show = shows.get(ownerId)
		if (!show) return
		shows.delete(ownerId)
		for (const el of [...show.spots.map((sp) => sp.el), show.beams]) fade ? fadeOut(el, () => el.remove()) : el.remove()
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
		for (const [ownerId, show] of [...shows.entries()]) {
			const age = now - show.born
			if (age > show.dur + 600) { endShow(ownerId); continue }
			const t = age / 1000
			// fade in 300ms, hold, fade out over the last 600ms past dur
			const alpha = age < 300 ? age / 300 : age > show.dur ? Math.max(0, 1 - (age - show.dur) / 600) : 1
			const [cx, cy] = showCenter(ownerId)
			for (const sp of show.spots) {
				const ang = 6.283 * (t / ORBIT_S) + sp.phase
				const px = cx + sp.radius * Math.cos(ang)
				const py = cy + (sp.yLift + sp.radius * Math.sin(ang)) * sp.tilt
				// near side reads bigger and brighter than far side (the reference's yoyo)
				const near = 0.5 + 0.5 * Math.cos(ang)
				const sc = sp.size * (1 + 0.9 * near)
				const flick = 0.32 + 0.23 * Math.sin(6.283 * sp.flickF * t + sp.flickP)
				sp.el.style.transform = `translate(${Math.round(px - SPOT_R)}px, ${Math.round(py - SPOT_R)}px) scale(${sc.toFixed(2)})`
				sp.el.style.opacity = (alpha * flick * (0.6 + 0.4 * near)).toFixed(2)
			}
			show.beams.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px) rotate(${((360 * t) / ORBIT_S).toFixed(1)}deg)`
			show.beams.style.opacity = (alpha * 0.85).toFixed(2)
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
		ballEl.querySelector(".db-ball3d")?.classList.remove("spinning")
		syncLayer()
		report(true)
	}
	function exit({ fade = false } = {}) {
		if (!open) return
		open = false
		clearTimeout(reportTimer)
		reportTimer = null
		endShow(myUserId(), { fade: true }) // the lights hang from the ball — they leave with it
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
		endShow(userId, { fade: true }) // their lights leave with their ball
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
		el?.querySelector(".db-ball3d")?.classList.add("spinning")
		const dur = Math.max(1000, Number(d.duration) || 8000)
		startShow(d.userId, d.color, dur)
		setTimeout(() => el?.querySelector(".db-ball3d")?.classList.remove("spinning"), dur)
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
