// The Starcourt Milkshake gimmick (see lib/gimmicks.js): a paper Scoops-Ahoy
// cup you drag anywhere over the live game and TIP — the spill rains down the
// screen, pools at the bottom and runs right over the chat dock. Adapted from
// the jazz-milkshake.html reference (its cup SVG, drop physics and merging
// puddle model), with GSAP swapped for a tiny rAF tween and the shake tinted
// in the OWNER'S palette colour, so whose mess is whose is never in doubt.
//
// Shared exactly like the dice and the Galaga battles: the owner streams
// their cup (`gimmick-cup {on, x, y, rot, level}`, fractions/degrees,
// throttled) and every viewer simulates the drops and puddles locally from
// that stream — the server relays the cup, never a drop. A full pour also
// goes up as `gimmick-pour`, which the server calls in the chat (cooldown,
// no steal — the milkshake is pure distraction). Pure string builders
// (cupSvg, layerHtml, hudHtml, shade) are exported for tests;
// mountMilkshake() is the DOM + socket half.
import { esc, safeColor } from "../util.js"

export const CUP_W = 150 // on-screen cup width (viewBox is 240x340)
const CUP_VB = { w: 240, h: 340, rimY: 84, rimRx: 78, pivotX: 120, pivotY: 340 * 0.86 }
const MOVE_MS = 80 // how often my cup goes out (dice use 60)
export const POUR_ROT = 74 // a full pour tips this far
const GRAV = 1750
const MAX_DROPS = 320
const MAX_PUDDLES = 60
const POOL_X = 1.55, POOL_Y = 0.3, SPREAD = 2.4

// darken/lighten a #rrggbb by factor f (f<1 darkens) — the shake's shading
export function shade(hex, f) {
	const m = /^#([0-9a-f]{6})$/i.exec(hex || "")
	if (!m) return hex
	const n = parseInt(m[1], 16)
	const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
	return "#" + [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")
}

// The cup, tinted to its owner. Every SVG id is suffixed `key` because ids
// are document-global and several cups share the page.
export function cupSvg(color, key) {
	const c = safeColor(color)
	const dark = shade(c, 0.78)
	const light = shade(c, 1.25)
	const { rimY, rimRx } = CUP_VB
	return `<svg viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg">
	<defs>
		<clipPath id="msbody${key}"><path d="M42 ${rimY} L66 292 Q120 308 174 292 L198 ${rimY} Z"/></clipPath>
		<clipPath id="msbowl${key}"><ellipse cx="120" cy="${rimY}" rx="${rimRx - 8}" ry="12"/></clipPath>
		<clipPath id="msstraw${key}"><rect x="-60" y="-160" width="360" height="${rimY + 160}"/><ellipse cx="120" cy="${rimY}" rx="${rimRx - 8}" ry="12"/></clipPath>
		<pattern id="msstripe${key}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(58)">
			<rect width="16" height="16" fill="#fffdf8"/><rect width="8" height="16" fill="#e8384f"/>
		</pattern>
		<linearGradient id="msgrad${key}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${dark}"/>
		</linearGradient>
	</defs>
	<g class="ms-tilt">
		<g clip-path="url(#msbody${key})">
			<rect x="30" y="70" width="180" height="250" fill="#fffdf8"/>
			<rect x="30" y="176" width="180" height="26" fill="#00b6c8" opacity=".85"/>
			<rect x="30" y="206" width="180" height="10" fill="#e8384f" opacity=".85"/>
			<rect x="30" y="70" width="34" height="250" fill="#000" opacity=".10"/>
			<rect x="176" y="70" width="34" height="250" fill="#000" opacity=".07"/>
		</g>
		<ellipse cx="120" cy="${rimY}" rx="${rimRx - 8}" ry="12" fill="#3b2431"/>
		<g clip-path="url(#msbowl${key})">
			<g class="ms-liquid"><rect class="ms-liquid-body" x="-140" y="${rimY}" width="520" height="300" fill="url(#msgrad${key})"/><rect class="ms-liquid-top" x="-140" y="${rimY}" width="520" height="4" fill="${light}"/></g>
		</g>
		<ellipse class="ms-rim" cx="120" cy="${rimY}" rx="${rimRx}" ry="15" fill="none" stroke="#fffdf8" stroke-width="9"/>
		<g clip-path="url(#msstraw${key})">
			<rect x="152" y="-10" width="15" height="130" rx="7" fill="url(#msstripe${key})" transform="rotate(19 159 55)" stroke="#d9cfc0" stroke-width="1"/>
		</g>
	</g>
</svg>`
}

export const layerHtml = () => `<div class="ms-layer hidden" id="msLayer" aria-label="Milkshake spill">
	<canvas id="msGround"></canvas>
	<canvas id="msDrops"></canvas>
	<div id="msOthers"></div>
	<button type="button" class="ms-cup hidden" id="msCup" aria-label="Milkshake cup. Drag to move, click to tip and pour."></button>
	<div class="ms-hud glass hidden" id="msHud">
		<b class="ms-title">🥤 Starcourt Milkshake</b>
		<div class="ms-meter"><i id="msLevel"></i></div>
		<span class="ms-hint" id="msHint">Drag to move · click to tip and pour · whip it to slosh</span>
		<div class="ms-row">
			<button type="button" data-act="ms-refill">Refill</button>
			<button type="button" class="ghost" data-act="ms-wipe">Wipe up</button>
			<button type="button" class="ghost" data-act="ms-exit">↩ Put the cup away</button>
		</div>
	</div>
</div>`

// opts: { socket, getMyUserId, getMyColor, document }
export function mountMilkshake(opts) {
	const { socket, getMyColor = () => "#ff8fb1" } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("msLayer")
	const cupEl = doc.getElementById("msCup")
	const othersBox = doc.getElementById("msOthers")
	const hud = doc.getElementById("msHud")
	const levelBar = doc.getElementById("msLevel")
	const hint = doc.getElementById("msHint")
	const groundC = doc.getElementById("msGround")
	const dropsC = doc.getElementById("msDrops")
	const myUserId = () => opts.getMyUserId?.() ?? null

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const cupH = () => (CUP_W / CUP_VB.w) * CUP_VB.h
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	const setPos = (el, px, py) => {
		el.style.left = Math.round(px) + "px"
		el.style.top = Math.round(py) + "px"
	}

	// ---- canvases: the falling drops and the mess they leave ----
	let gctx = null,
		dctx = null,
		floorY = 0
	function sizeCanvases() {
		const DPR = Math.min(2, win?.devicePixelRatio || 1)
		for (const c of [groundC, dropsC]) {
			c.width = vw() * DPR
			c.height = vh() * DPR
			c.style.width = vw() + "px"
			c.style.height = vh() + "px"
		}
		gctx = groundC.getContext?.("2d") || null
		dctx = dropsC.getContext?.("2d") || null
		gctx?.setTransform(Math.min(2, win?.devicePixelRatio || 1), 0, 0, Math.min(2, win?.devicePixelRatio || 1), 0, 0)
		dctx?.setTransform(Math.min(2, win?.devicePixelRatio || 1), 0, 0, Math.min(2, win?.devicePixelRatio || 1), 0, 0)
		floorY = vh() - 26 // the spill pools along the bottom edge, chat dock included
		groundDirty = true
	}

	// ---- the spill model (from the reference): merging pools, per colour ----
	const drops = [] // { x, y, vx, vy, r, depth, color }
	const puddles = [] // { id, x, y, vol, r, rT, color }
	const flecks = [] // { x, y, r, color }
	let puddleId = 0
	let groundDirty = true
	const radiusFor = (vol) => Math.min(230, Math.sqrt(vol / Math.PI) * SPREAD)
	const poolDist = (dx, dy) => Math.hypot(dx / POOL_X, dy / POOL_Y)
	function addToPuddles(x, y, r, color) {
		const vol = r * r * 2.6
		let host = null
		for (const p of puddles) if (p.color === color && poolDist(x - p.x, y - p.y) < p.r + r * 2.5) { host = p; break }
		if (host) {
			const w = (vol / (host.vol + vol)) * 0.7
			host.x += (x - host.x) * w
			host.y += (y - host.y) * w
			host.vol += vol
			host.rT = radiusFor(host.vol)
		} else if (puddles.length < MAX_PUDDLES) {
			puddles.push({ id: ++puddleId, x, y, vol, r, rT: radiusFor(vol), color })
		} else {
			let best = puddles[0], bd = Infinity
			for (const p of puddles) {
				const d = poolDist(x - p.x, y - p.y)
				if (d < bd) { bd = d; best = p }
			}
			best.vol += vol
			best.rT = radiusFor(best.vol)
		}
		flecks.push({ x: x + (Math.random() - 0.5) * r * 13, y: y + (Math.random() - 0.5) * r * 2.8, r: 1 + Math.random() * 2.3, color })
		if (flecks.length > 240) flecks.splice(0, flecks.length - 240)
		groundDirty = true
	}
	function mergeOverlapping() {
		let merged = true
		while (merged) {
			merged = false
			for (let i = 0; i < puddles.length && !merged; i++)
				for (let j = i + 1; j < puddles.length; j++) {
					const a = puddles[i], b = puddles[j]
					if (a.color !== b.color) continue
					if (poolDist(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.84) {
						const v = a.vol + b.vol
						a.x = (a.x * a.vol + b.x * b.vol) / v
						a.y = (a.y * a.vol + b.y * b.vol) / v
						a.vol = v
						a.r = Math.max(a.r, b.r)
						a.rT = radiusFor(v)
						puddles.splice(j, 1)
						merged = true
						groundDirty = true
						break
					}
				}
		}
	}
	function blobPath(ctx, p, k) {
		const N = 18, R = p.r * k, pts = []
		for (let i = 0; i < N; i++) {
			const a = (i / N) * 6.28318
			const w = 1 + 0.15 * Math.sin(a * 3 + p.id * 1.7) + 0.09 * Math.sin(a * 5 + p.id * 0.9)
			pts.push([p.x + Math.cos(a) * R * w * POOL_X, p.y + Math.sin(a) * R * w * POOL_Y])
		}
		ctx.beginPath()
		ctx.moveTo((pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2)
		for (let i = 0; i < N; i++) {
			const [cx, cy] = pts[i], [nx, ny] = pts[(i + 1) % N]
			ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2)
		}
		ctx.closePath()
	}
	function drawGround() {
		if (!gctx) return
		gctx.clearRect(0, 0, vw(), vh())
		for (const f of flecks) {
			gctx.fillStyle = shade(f.color, 0.85)
			gctx.beginPath()
			gctx.ellipse(f.x, f.y, f.r * 1.5, f.r * 0.5, 0, 0, 6.28318)
			gctx.fill()
		}
		for (const p of puddles) {
			gctx.fillStyle = shade(p.color, 0.85)
			blobPath(gctx, p, 1)
			gctx.fill()
		}
		for (const p of puddles) {
			gctx.fillStyle = p.color
			blobPath(gctx, p, 0.84)
			gctx.fill()
		}
		for (const p of puddles) {
			const rx = p.r * POOL_X, ry = p.r * POOL_Y
			gctx.fillStyle = "rgba(255,255,255,.38)"
			gctx.beginPath()
			gctx.ellipse(p.x - rx * 0.3, p.y - ry * 0.4, rx * 0.3, Math.max(1, ry * 0.26), -0.1, 0, 6.28318)
			gctx.fill()
		}
	}

	// ---- cups: mine + everyone else's ----
	let open = false, // my cup is out
		x = 0,
		y = 0, // my cup's top-left, px
		rot = 0,
		level = 1,
		pouring = false
	const remote = new Map() // userId -> { el, tilt, liquid, tag, x, y, rot, level, color }
	const spillAngle = (lv) => 20 + (1 - lv) * 26
	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}
	const syncLayer = () => {
		const on = open || remote.size > 0
		layer.classList.toggle("hidden", !on)
		if (!on) {
			// nobody's cup is out: the mess is gone with them
			drops.length = 0
			puddles.length = 0
			flecks.length = 0
		} else loop()
	}

	// where the lower rim lip is on screen for a cup at (px, py) tipped r deg
	function lipPoint(px, py, r) {
		const s = CUP_W / CUP_VB.w
		const lipX = CUP_VB.pivotX + (r > 0 ? CUP_VB.rimRx : -CUP_VB.rimRx)
		const a = (r * Math.PI) / 180
		const dx = lipX - CUP_VB.pivotX, dy = CUP_VB.rimY - CUP_VB.pivotY
		return {
			x: px + (CUP_VB.pivotX + dx * Math.cos(a) - dy * Math.sin(a)) * s,
			y: py + (CUP_VB.pivotY + dx * Math.sin(a) + dy * Math.cos(a)) * s,
		}
	}
	// emit drops from one cup this frame; returns how many (owner drains level)
	function emitFrom(px, py, r, lv, color, dt, vx0 = 0) {
		const over = Math.abs(r) - spillAngle(lv)
		if (lv <= 0 || over <= 0) return 0
		const lip = lipPoint(px, py, r)
		const rate = clamp(over / 30, 0, 1) * 26 * dt
		let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0)
		let made = 0
		while (n-- > 0 && drops.length < MAX_DROPS) {
			drops.push({
				x: lip.x + (Math.random() - 0.5) * 12,
				y: lip.y + (Math.random() - 0.5) * 6,
				vx: Math.sign(r) * (30 + Math.random() * 90) + vx0 * 0.32,
				vy: 40 + Math.random() * 90,
				r: 2 + Math.random() * 3.6,
				depth: Math.random() * 22,
				color,
			})
			made++
		}
		return made
	}
	const applyTilt = (el, r) => (el.style.transform = `rotate(${r}deg)`)
	const applyLevel = (svg, lv) => {
		const yv = CUP_VB.rimY - 2 + (1 - lv) * 14
		svg.querySelectorAll(".ms-liquid-body, .ms-liquid-top").forEach((rect) => rect.setAttribute("y", yv))
	}

	// ---- the loop: runs while any cup is out ----
	let raf = 0,
		looping = false,
		lastT = 0
	function loop() {
		if (looping || !win?.requestAnimationFrame) return
		looping = true
		lastT = (win.performance || performance).now()
		raf = win.requestAnimationFrame(frame)
	}
	function frame(now) {
		if (layer.classList.contains("hidden")) {
			looping = false
			return
		}
		const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016)
		lastT = now
		// my cup spills and drains
		if (open) {
			const made = emitFrom(x, y, rot, level, safeColor(getMyColor()), dt, dragVX)
			if (made) {
				level = Math.max(0, level - made * 0.0022)
				paintMyLevel()
				report()
			}
		}
		// everyone else's cups spill from their relayed state (their own screens
		// drain the level; here we just pour what they report)
		for (const r of remote.values()) emitFrom(r.x * (vw() - CUP_W), r.y * (vh() - cupH()), r.rot, r.level, r.color, dt)
		// pools ease out, then merge
		let growing = false
		for (const p of puddles)
			if (Math.abs(p.r - p.rT) > 0.15) {
				p.r += (p.rT - p.r) * Math.min(1, dt * 5.5)
				growing = true
			}
		if (growing) mergeOverlapping()
		if (growing || groundDirty) {
			drawGround()
			groundDirty = false
		}
		// drops fall
		if (dctx) {
			dctx.clearRect(0, 0, vw(), vh())
			for (let i = drops.length - 1; i >= 0; i--) {
				const d = drops[i]
				d.vy += GRAV * dt
				d.x += d.vx * dt
				d.y += d.vy * dt
				const land = floorY + d.depth
				if (d.y >= land) {
					addToPuddles(d.x, land, d.r, d.color)
					drops.splice(i, 1)
					continue
				}
				if (d.x < -60 || d.x > vw() + 60) {
					drops.splice(i, 1)
					continue
				}
				const stretch = clamp(1 + d.vy / 900, 1, 2.6)
				dctx.fillStyle = d.color
				dctx.beginPath()
				dctx.ellipse(d.x, d.y, d.r, d.r * stretch, 0, 0, 6.284)
				dctx.fill()
			}
		}
		raf = win.requestAnimationFrame(frame)
	}

	// ---- tiny tween (GSAP's job in the reference) ----
	let tweenRaf = 0
	function tweenRot(to, dur, done) {
		if (!win?.requestAnimationFrame) {
			setMyRot(to)
			return done?.()
		}
		win.cancelAnimationFrame(tweenRaf)
		const from = rot,
			t0 = (win.performance || performance).now()
		const step = (now) => {
			const p = Math.min(1, (now - t0) / (dur * 1000))
			const k = 1 - Math.pow(1 - p, 3) // power3.out
			setMyRot(from + (to - from) * k)
			if (p < 1) tweenRaf = win.requestAnimationFrame(step)
			else done?.()
		}
		tweenRaf = win.requestAnimationFrame(step)
	}
	function setMyRot(r) {
		rot = r
		const t = cupEl.querySelector("svg")
		if (t) applyTilt(t, r)
	}
	function paintMyLevel() {
		levelBar.style.width = Math.round(level * 100) + "%"
		levelBar.classList.toggle("low", level <= 0.25)
		const svg = cupEl.querySelector("svg")
		if (svg) applyLevel(svg, level)
		if (level <= 0) hint.textContent = "Empty · hit Refill"
	}

	// ---- relaying my cup ----
	let reportTimer = null
	function report(now = false) {
		if (!open) return
		if (!now) {
			if (reportTimer) return
			reportTimer = setTimeout(() => {
				reportTimer = null
				sendCup()
			}, MOVE_MS)
			return
		}
		clearTimeout(reportTimer)
		reportTimer = null
		sendCup()
	}
	function sendCup() {
		socket.emit("gimmick-cup", {
			on: true,
			x: clamp(x / Math.max(1, vw() - CUP_W), 0, 1),
			y: clamp(y / Math.max(1, vh() - cupH()), 0, 1),
			rot,
			level,
		})
	}

	// ---- dragging my cup: same feel as the die (drag / whip / click) ----
	let dragging = false,
		moved = false,
		ox = 0,
		oy = 0,
		px = 0,
		py = 0,
		dragVX = 0,
		lastDragT = 0
	const perfNow = () => (win?.performance || performance).now()
	cupEl.addEventListener("pointerdown", (e) => {
		if (e.button != null && e.button !== 0) return
		dragging = true
		moved = false
		ox = px = e.clientX
		oy = py = e.clientY
		dragVX = 0
		lastDragT = perfNow()
		cupEl.setPointerCapture?.(e.pointerId)
		cupEl.classList.add("grabbing")
		e.preventDefault()
	})
	cupEl.addEventListener("pointermove", (e) => {
		if (!dragging) return
		const now = perfNow()
		const dx = e.clientX - px, dy = e.clientY - py
		dragVX = (dx / Math.max(16, now - lastDragT)) * 1000
		px = e.clientX
		py = e.clientY
		lastDragT = now
		if (Math.hypot(e.clientX - ox, e.clientY - oy) > 6) moved = true
		x = clamp(x + dx, 0, vw() - CUP_W)
		y = clamp(y + dy, 0, vh() - cupH())
		setPos(cupEl, x, y)
		// whip it sideways and the shake sloshes over the lip
		if (!pouring) setMyRot(clamp(-dragVX * 0.035, -58, 58))
		report()
	})
	const release = (e) => {
		if (!dragging) return
		dragging = false
		cupEl.classList.remove("grabbing")
		cupEl.releasePointerCapture?.(e.pointerId)
		dragVX = 0
		if (!moved) return pour() // a clean click tips it right over
		if (!pouring) tweenRot(0, 0.7)
		report(true)
	}
	cupEl.addEventListener("pointerup", release)
	cupEl.addEventListener("pointercancel", release)
	cupEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			pour()
		}
	})

	function pour() {
		if (pouring || !open || level <= 0) return
		// the server calls it in chat (and is the cooldown); pour on the ok
		socket.emit("gimmick-pour", {}, (ack) => {
			if (!ack?.ok) {
				if (ack?.error) hint.textContent = ack.error
				return
			}
			pouring = true
			hint.textContent = "Pouring…"
			const dir = x + CUP_W / 2 < vw() / 2 ? 1 : -1
			tweenRot(dir * POUR_ROT, 0.5, () => {
				setTimeout(() => {
					tweenRot(0, 0.9, () => {
						pouring = false
						if (level > 0) hint.textContent = "Drag to move · click to tip and pour · whip it to slosh"
					})
				}, 900)
			})
		})
	}

	// ---- HUD ----
	layer.addEventListener("click", (e) => {
		if (e.target.closest('[data-act="ms-exit"]')) exit()
		else if (e.target.closest('[data-act="ms-wipe"]')) {
			puddles.length = 0
			flecks.length = 0
			groundDirty = true
			drawGround()
		} else if (e.target.closest('[data-act="ms-refill"]')) {
			level = 1
			paintMyLevel()
			hint.textContent = "Drag to move · click to tip and pour · whip it to slosh"
			report(true)
		}
	})

	function start() {
		if (open) return
		open = true
		sizeCanvases()
		cupEl.innerHTML = cupSvg(getMyColor(), "me")
		cupEl.classList.remove("hidden")
		hud.classList.remove("hidden")
		level = 1
		setMyRot(0)
		paintMyLevel()
		x = (vw() - CUP_W) / 2
		y = (vh() - cupH()) / 2
		setPos(cupEl, x, y)
		syncLayer()
		report(true)
	}
	function exit({ fade = false } = {}) {
		if (!open) return
		open = false
		clearTimeout(reportTimer)
		reportTimer = null
		win?.cancelAnimationFrame?.(tweenRaf)
		pouring = false
		const done = () => {
			cupEl.classList.add("hidden")
			hud.classList.add("hidden")
			syncLayer()
		}
		if (fade) {
			fadeOut(cupEl, done)
			fadeOut(hud, () => {})
		} else done()
		socket.emit("gimmick-cup", { on: false })
	}

	// The table went friendly: every cup (and the whole mess — both canvases)
	// fades away rather than blinking off. Returns whether anything was out.
	function gimmicksOff() {
		const had = open || remote.size > 0
		if (had) {
			fadeOut(groundC, () => {})
			fadeOut(dropsC, () => {})
		}
		for (const uid of [...remote.keys()]) dropRemote(uid, { fade: true })
		if (open) exit({ fade: true })
		return had
	}

	// ---- everyone else's cups ----
	function upsertRemote(d) {
		let r = remote.get(d.userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "ms-cup remote"
			el.innerHTML = cupSvg(d.color, d.userId) + `<span class="ms-cup-tag" style="color:${safeColor(d.color)}">${esc(d.name)}</span>`
			othersBox.appendChild(el)
			r = { el, tilt: el.querySelector("svg"), svg: el.querySelector("svg"), x: 0, y: 0, rot: 0, level: 1, color: safeColor(d.color) }
			remote.set(d.userId, r)
		}
		r.x = d.x
		r.y = d.y
		r.rot = d.rot || 0
		r.level = d.level ?? 1
		setPos(r.el, d.x * (vw() - CUP_W), d.y * (vh() - cupH()))
		applyTilt(r.tilt, r.rot)
		applyLevel(r.svg, r.level)
		if (!looping) sizeCanvases()
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
	socket.on("gimmick-cup", (d) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId, { fade: true })
		else upsertRemote(d)
	})
	socket.on("gimmick-cups", (list) => {
		for (const d of list || []) if (d.userId !== myUserId()) upsertRemote(d)
	})

	win?.addEventListener?.("resize", () => {
		if (layer.classList.contains("hidden")) return
		sizeCanvases()
		x = clamp(x, 0, vw() - CUP_W)
		y = clamp(y, 0, vh() - cupH())
		if (open) setPos(cupEl, x, y)
	})

	return {
		start,
		exit,
		pour,
		gimmicksOff,
		get open() {
			return open
		},
		get level() {
			return level
		},
		get others() {
			return [...remote.keys()]
		},
		get puddleCount() {
			return puddles.length
		},
	}
}
