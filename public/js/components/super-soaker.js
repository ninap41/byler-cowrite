// The SuperSoaker gimmick (see lib/gimmicks.js): a water gun you drag
// anywhere over the live game — drag to aim, a clean click FIRES: a burst of
// droplets arcs out of the muzzle and every drop that reaches the floor
// POOLS there — the milkshake's own puddle ground (components/puddle-ground.js),
// so the water runs along the bottom of the screen right over the chat dock
// and stays until the last gun leaves, each shooter's pools their own, and
// Wipe up mops only mine. No steal, pure soak, the milkshake's category.
//
// Shared exactly like the disco ball: the owner streams their gun's position
// and aim (`gimmick-gun {on, x, y, angle}`, fractions + degrees, throttled)
// and a shot goes up as `gimmick-squirt`, which the server calls in the chat
// (cooldown) and relays with a SEED — every viewer then simulates the same
// burst locally; no droplet ever crosses the wire.
// Pure string builders (gunHtml, layerHtml) are exported for tests;
// mountSuperSoaker() is the DOM + socket half.
import { esc, safeColor } from "../util.js"
import { createGround } from "./puddle-ground.js"

export const GUN_W = 64 // on-screen gun width
const MOVE_MS = 80 // how often my gun goes out (cups use the same)
const DROPS_PER_BURST = 26
const MAX_BURSTS = 3 // concurrent bursts across the table — oldest dries first
const BURST_MS = 8000 // a drop still in the air after this long dries away

const frac = (n) => {
	const x = Math.sin(n) * 43758.5453
	return x - Math.floor(x)
}

// The gun: the water-pistol emoji (green on every modern platform) — whose it
// is lives in the name tag beside it; the owner's colour still tints the
// water itself. The emoji glyph points LEFT, so setPos() flips it to face the
// way the burst will fly.
export function gunHtml(key, color = "#38bdf8") {
	const c = safeColor(color)
	return `<span class="sk-gun3d" style="--sk-c:${c}"><span class="sk-emoji">🔫</span></span>`
}

export const layerHtml = () => `<div class="sk-layer hidden" id="skLayer" aria-label="SuperSoaker">
	<canvas id="skGround"></canvas>
	<div id="skWater"></div>
	<div id="skOthers"></div>
	<button type="button" class="sk-gunbtn hidden" id="skGun" aria-label="SuperSoaker. Drag to aim, click to fire."></button>
	<div class="sk-hud glass hidden" id="skHud">
		<b class="sk-title">🔫 SuperSoaker</b>
		<span class="sk-hint" id="skHint">Drag to aim · click to fire</span>
		<div class="sk-row">
			<button type="button" data-act="sk-fire">Fire 💦</button>
			<button type="button" class="ghost" data-act="sk-wipe">Wipe up</button>
			<button type="button" class="ghost" data-act="sk-exit">↩ Put the gun away</button>
		</div>
	</div>
</div>`

// opts: { socket, getMyUserId, getMyColor, getMyName, document }
export function mountSuperSoaker(opts) {
	const { socket } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("skLayer")
	const gunEl = doc.getElementById("skGun")
	const othersBox = doc.getElementById("skOthers")
	const waterBox = doc.getElementById("skWater")
	const hud = doc.getElementById("skHud")
	const hint = doc.getElementById("skHint")
	const groundC = doc.getElementById("skGround")
	const myUserId = () => opts.getMyUserId?.() ?? null
	// the floor: every drop that gets there pools, per shooter
	const ground = createGround({ canvas: groundC, doc, win })

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	const setPos = (el, px, py, angle = 0) => {
		el.style.left = Math.round(px) + "px"
		el.style.top = Math.round(py) + "px"
		const g = el.querySelector(".sk-gun3d")
		if (!g) return
		// the emoji points LEFT: an aim toward the left keeps it as-is (rotated
		// so base+rotation lands on the aim), an aim toward the right mirrors
		// it first — either way the muzzle faces where the water will go and
		// the gun is never upside down
		const norm = ((Math.round(angle) % 360) + 360) % 360
		const lefty = norm > 90 && norm < 270
		g.style.transform = lefty ? `rotate(${Math.round(angle) - 180}deg)` : `rotate(${Math.round(angle)}deg) scaleX(-1)`
	}
	const gunInner = (key, name, color) =>
		gunHtml(key, color) + (name ? `<span class="sk-tag" style="color:${safeColor(color)}">${esc(name)}</span>` : "")
	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}

	// ---- the water, simulated the same on every screen from one seed ----
	// burst: { drops: [{el, x0, y0, vx, vy, delay, size, depth}], born, color, owner }
	const bursts = new Map() // burstKey -> burst
	let burstN = 0
	let raf = 0, looping = false
	const nowMs = () => (win?.performance || performance).now()
	function startBurst({ x, y, angle, seed, color, userId: owner }) {
		while (bursts.size >= MAX_BURSTS) endBurst(bursts.keys().next().value)
		const key = "b" + burstN++
		const a0 = ((Number(angle) || 0) * Math.PI) / 180
		const px = (Number(x) || 0.5) * vw()
		const py = (Number(y) || 0.5) * vh()
		const power = Math.min(vw(), 900) * 0.8
		const drops = []
		ground.resize()
		for (let i = 0; i < DROPS_PER_BURST; i++) {
			const k = (Number(seed) || 1) + i * 137
			const el = doc.createElement("i")
			el.className = "sk-drop"
			el.style.background = safeColor(color)
			waterBox.appendChild(el)
			const spread = (frac(k) - 0.5) * 0.5 // ±0.25 rad around the aim
			const speed = power * (0.55 + frac(k + 1) * 0.7)
			drops.push({
				el,
				x0: px, y0: py,
				vx: Math.cos(a0 + spread) * speed,
				vy: Math.sin(a0 + spread) * speed,
				delay: frac(k + 2) * 260, // the burst leaves the muzzle as a stream
				size: 4 + frac(k + 3) * 8,
				depth: frac(k + 4) * 22, // where on the floor band it lands
			})
		}
		bursts.set(key, { drops, born: nowMs(), color: safeColor(color), owner: owner ?? null })
		syncLayer()
		loop()
	}
	function endBurst(key, { fade = false } = {}) {
		const b = bursts.get(key)
		if (!b) return
		bursts.delete(key)
		for (const d of b.drops) fade ? fadeOut(d.el, () => d.el.remove()) : d.el.remove()
		b.drops.length = 0
		syncLayer()
	}
	function loop() {
		if (looping || !win?.requestAnimationFrame) return
		looping = true
		raf = win.requestAnimationFrame(frame)
	}
	let lastT = 0
	function frame(now) {
		const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016)
		lastT = now
		if (ground.tick(dt)) ground.draw()
		if (!bursts.size) {
			looping = false
			return
		}
		const G = 900 // gravity, px/s²
		for (const [key, b] of [...bursts.entries()]) {
			const age = now - b.born
			if (age > BURST_MS || !b.drops.length) { endBurst(key); continue }
			const dry = age > BURST_MS - 1500 ? 1 - (age - (BURST_MS - 1500)) / 1500 : 1
			for (let i = b.drops.length - 1; i >= 0; i--) {
				const d = b.drops[i]
				const t = Math.max(0, (age - d.delay) / 1000)
				const px = d.x0 + d.vx * t
				const py = d.y0 + d.vy * t + 0.5 * G * t * t
				const land = ground.floorY + d.depth
				if (py >= land) {
					// it reached the floor: the drop is a pool now, not a streak
					ground.add(px, land, d.size * 0.55, b.color, b.owner)
					d.el.remove()
					b.drops.splice(i, 1)
					continue
				}
				if (px < -60 || px > vw() + 60) {
					d.el.remove()
					b.drops.splice(i, 1)
					continue
				}
				d.el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) scale(${(d.size / 6).toFixed(2)})`
				d.el.style.opacity = (dry * 0.8).toFixed(2)
			}
		}
		raf = win.requestAnimationFrame(frame)
	}

	// ---- my gun ----
	let open = false, x = 0, y = 0, angle = 0
	const remote = new Map() // userId -> { el, x, y }
	const syncLayer = () => {
		const on = open || remote.size > 0 || bursts.size > 0
		layer.classList.toggle("hidden", !on)
		if (!on) ground.wipe() // the last gun left: the floor dries with it
	}
	let reportTimer = null
	function report(now = false) {
		if (!open) return
		if (!now) {
			if (reportTimer) return
			reportTimer = setTimeout(() => {
				reportTimer = null
				sendGun()
			}, MOVE_MS)
			return
		}
		clearTimeout(reportTimer)
		reportTimer = null
		sendGun()
	}
	function sendGun() {
		socket.emit("gimmick-gun", {
			on: true,
			x: clamp(x / Math.max(1, vw()), 0, 1),
			y: clamp(y / Math.max(1, vh()), 0, 1),
			angle,
		})
	}

	// dragging: same feel as the ball — a clean click fires
	let dragging = false, moved = false, ox = 0, oy = 0
	gunEl.addEventListener("pointerdown", (e) => {
		if (e.button != null && e.button !== 0) return
		dragging = true
		moved = false
		ox = e.clientX
		oy = e.clientY
		gunEl.setPointerCapture?.(e.pointerId)
		e.preventDefault()
	})
	gunEl.addEventListener("pointermove", (e) => {
		if (!dragging) return
		if (Math.hypot(e.clientX - ox, e.clientY - oy) > 6) moved = true
		x = clamp(e.clientX, GUN_W / 2, vw() - GUN_W / 2)
		y = clamp(e.clientY, GUN_W / 2, vh() - GUN_W / 2)
		// the gun aims away from the nearest side wall, tipped by height
		angle = x < vw() / 2 ? -20 : -160
		setPos(gunEl, x, y, angle)
		report()
	})
	const release = (e) => {
		if (!dragging) return
		dragging = false
		gunEl.releasePointerCapture?.(e.pointerId)
		if (!moved) return fire()
		report(true)
	}
	gunEl.addEventListener("pointerup", release)
	gunEl.addEventListener("pointercancel", release)
	gunEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			fire()
		}
	})

	function fire() {
		if (!open) return
		// the server calls it in chat (and is the cooldown); the relayed
		// gimmick-squirt — my own included — is what starts the water.
		socket.emit("gimmick-squirt", {}, (ack) => {
			if (!ack?.ok && ack?.error) hint.textContent = ack.error
			else if (ack?.ok) hint.textContent = "Soaked! 💦"
		})
	}

	layer.addEventListener("click", (e) => {
		if (e.target.closest('[data-act="sk-exit"]')) exit()
		else if (e.target.closest('[data-act="sk-fire"]')) fire()
		else if (e.target.closest('[data-act="sk-wipe"]')) ground.wipe(myUserId()) // my own water only
	})

	function start() {
		if (open) return
		open = true
		ground.resize()
		gunEl.innerHTML = gunInner("me", opts.getMyName?.() || "", opts.getMyColor?.())
		gunEl.classList.remove("hidden")
		hud.classList.remove("hidden")
		hint.textContent = "Drag to aim · click to fire"
		x = vw() * 0.24
		y = vh() * 0.62
		angle = -20
		setPos(gunEl, x, y, angle)
		syncLayer()
		report(true)
	}
	function exit({ fade = false } = {}) {
		if (!open) return
		open = false
		clearTimeout(reportTimer)
		reportTimer = null
		const done = () => {
			gunEl.classList.add("hidden")
			hud.classList.add("hidden")
			syncLayer()
		}
		if (fade) {
			fadeOut(gunEl, done)
			fadeOut(hud, () => {})
		} else done()
		socket.emit("gimmick-gun", { on: false })
	}

	// The table went friendly: guns and water fade away rather than blinking
	// off. Returns whether anything was out.
	function gimmicksOff() {
		const had = open || remote.size > 0 || bursts.size > 0
		if (had) fadeOut(groundC, () => {})
		for (const key of [...bursts.keys()]) endBurst(key, { fade: true })
		for (const uid of [...remote.keys()]) dropRemote(uid, { fade: true })
		if (open) exit({ fade: true })
		return had
	}

	// ---- everyone else's guns ----
	function upsertRemote(d) {
		let r = remote.get(d.userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "sk-gunbtn remote"
			el.innerHTML = gunInner(d.userId, d.name, d.color)
			othersBox.appendChild(el)
			r = { el }
			remote.set(d.userId, r)
		}
		setPos(r.el, (d.x || 0) * vw(), (d.y || 0) * vh(), d.angle || 0)
		syncLayer()
	}
	function dropRemote(userId, { fade = false } = {}) {
		const r = remote.get(userId)
		if (!r) return
		remote.delete(userId)
		const done = () => {
			r.el.remove()
			syncLayer()
		}
		fade ? fadeOut(r.el, done) : done()
	}
	socket.on("gimmick-gun", (d) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId, { fade: true })
		else upsertRemote(d)
	})
	socket.on("gimmick-guns", (list) => {
		for (const d of list || []) if (d.userId !== myUserId()) upsertRemote(d)
	})
	// One shot soaks every screen — mine included (my own relay starts my
	// water, so the burst and the chat call can never disagree).
	socket.on("gimmick-squirt", (d) => {
		if (!d?.userId) return
		startBurst(d)
	})

	win?.addEventListener?.("resize", () => {
		if (!layer.classList.contains("hidden")) ground.resize()
		if (!open) return
		x = clamp(x, GUN_W / 2, vw() - GUN_W / 2)
		y = clamp(y, GUN_W / 2, vh() - GUN_W / 2)
		setPos(gunEl, x, y, angle)
	})

	return {
		start,
		exit,
		fire,
		gimmicksOff,
		get open() {
			return open
		},
		get others() {
			return [...remote.keys()]
		},
		get dropCount() {
			return [...bursts.values()].reduce((n, b) => n + b.drops.length, 0)
		},
		get ground() {
			return ground
		},
	}
}
