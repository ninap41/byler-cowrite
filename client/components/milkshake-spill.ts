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
import { createGround, shade, type Ground } from "./puddle-ground.js"
import { hudCtlHtml } from "./gimmick-dock.js"
import type { Gimmick, GimmickMountOpts, Ack } from "./gimmick-types.js"
export { shade }

export interface RemoteCup {
	userId: string
	name: string
	color: string
	x: number
	y: number
	rot?: number
	level?: number
	on?: boolean
}
export interface MilkshakeGimmick extends Gimmick {
	pour(): void
	readonly level: number
	readonly others: string[]
	readonly puddleCount: number
	readonly ground: Ground
}
interface Drop {
	x: number
	y: number
	vx: number
	vy: number
	r: number
	depth: number
	color: string
	owner: string | null
}
interface RemoteCupEl {
	el: HTMLElement
	tilt: SVGSVGElement
	svg: SVGSVGElement
	x: number
	y: number
	rot: number
	level: number
	color: string
}

export const CUP_W = 150 // on-screen cup width (viewBox is 240x340)
const CUP_VB = { w: 240, h: 340, rimY: 84, rimRx: 78, pivotX: 120, pivotY: 340 * 0.86 }
const MOVE_MS = 80 // how often my cup goes out (dice use 60)
export const POUR_ROT = 74 // a full pour tips this far
const GRAV = 1750
const MAX_DROPS = 320

// The cup, tinted to its owner. Every SVG id is suffixed `key` because ids
// are document-global and several cups share the page.
export function cupSvg(color: string, key: string): string {
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

export const layerHtml = (): string => `<div class="ms-layer hidden" id="msLayer" aria-label="Milkshake spill">
	<canvas id="msGround"></canvas>
	<canvas id="msDrops"></canvas>
	<div id="msOthers"></div>
	<button type="button" class="ms-cup hidden" id="msCup" aria-label="Milkshake cup. Drag to move, click to tip and pour."></button>
	<div class="ms-hud glass hidden" id="msHud">${hudCtlHtml()}
		<b class="ms-title">🥤 Starcourt Milkshake</b>
		<div class="ms-meter"><i id="msLevel"></i></div>
		<span class="ms-hint" id="msHint">Drag to move · click to tip and pour · whip it to slosh</span>
		<div class="ms-row">
			<button type="button" data-act="ms-refill">Refill</button>
			<button type="button" class="ghost" data-act="ms-wipe">Wipe up</button>
			<button type="button" class="ghost" data-act="ms-exit">↩ Put away</button>
		</div>
	</div>
</div>`

// opts: { socket, getMyUserId, getMyColor, document }
export function mountMilkshake(opts: GimmickMountOpts): MilkshakeGimmick {
	const { socket, getMyColor = () => "#ff8fb1" } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("msLayer")!
	const cupEl = doc.getElementById("msCup")!
	const othersBox = doc.getElementById("msOthers")!
	const hud = doc.getElementById("msHud")!
	const levelBar = doc.getElementById("msLevel")!
	const hint = doc.getElementById("msHint")!
	const groundC = doc.getElementById("msGround") as HTMLCanvasElement
	const dropsC = doc.getElementById("msDrops") as HTMLCanvasElement
	const myUserId = () => opts.getMyUserId?.() ?? null

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const cupH = () => (CUP_W / CUP_VB.w) * CUP_VB.h
	const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
	const setPos = (el: HTMLElement, px: number, py: number) => {
		el.style.left = Math.round(px) + "px"
		el.style.top = Math.round(py) + "px"
	}

	// ---- canvases: the falling drops, and the mess they leave (the shared
	// puddle ground — pools per OWNER, so Wipe up mops only my own) ----
	const ground = createGround({ canvas: groundC, doc, win })
	let dctx: CanvasRenderingContext2D | null = null
	function sizeCanvases() {
		const DPR = Math.min(2, win?.devicePixelRatio || 1)
		dropsC.width = vw() * DPR
		dropsC.height = vh() * DPR
		dropsC.style.width = vw() + "px"
		dropsC.style.height = vh() + "px"
		dctx = dropsC.getContext?.("2d") || null
		dctx?.setTransform(DPR, 0, 0, DPR, 0, 0)
		ground.resize()
	}
	const drops: Drop[] = []

	// ---- cups: mine + everyone else's ----
	let open = false, // my cup is out
		x = 0,
		y = 0, // my cup's top-left, px
		rot = 0,
		level = 1,
		pouring = false
	const remote = new Map<string, RemoteCupEl>()
	const spillAngle = (lv: number): number => 20 + (1 - lv) * 26
	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el: HTMLElement | null, done: () => void) => {
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
			ground.wipe()
		} else loop()
	}

	// where the lower rim lip is on screen for a cup at (px, py) tipped r deg
	function lipPoint(px: number, py: number, r: number) {
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
	function emitFrom(px: number, py: number, r: number, lv: number, color: string, owner: string | null, dt: number, vx0 = 0): number {
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
				owner,
			})
			made++
		}
		return made
	}
	const applyTilt = (el: SVGSVGElement, r: number) => (el.style.transform = `rotate(${r}deg)`)
	const applyLevel = (svg: SVGSVGElement, lv: number) => {
		const yv = CUP_VB.rimY - 2 + (1 - lv) * 14
		svg.querySelectorAll(".ms-liquid-body, .ms-liquid-top").forEach((rect) => rect.setAttribute("y", String(yv)))
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
	function frame(now: number) {
		if (layer.classList.contains("hidden")) {
			looping = false
			return
		}
		const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016)
		lastT = now
		// my cup spills and drains
		if (open) {
			const made = emitFrom(x, y, rot, level, safeColor(getMyColor()), myUserId(), dt, dragVX)
			if (made) {
				level = Math.max(0, level - made * 0.0022)
				paintMyLevel()
				report()
			}
		}
		// everyone else's cups spill from their relayed state (their own screens
		// drain the level; here we just pour what they report)
		for (const [uid, r] of remote) emitFrom(r.x * (vw() - CUP_W), r.y * (vh() - cupH()), r.rot, r.level, r.color, uid, dt)
		// pools ease out, merge, repaint when the ground says so
		if (ground.tick(dt)) ground.draw()
		// drops fall
		if (dctx) {
			dctx.clearRect(0, 0, vw(), vh())
			for (let i = drops.length - 1; i >= 0; i--) {
				const d = drops[i]!
				d.vy += GRAV * dt
				d.x += d.vx * dt
				d.y += d.vy * dt
				const land = ground.floorY + d.depth
				if (d.y >= land) {
					ground.add(d.x, land, d.r, d.color, d.owner)
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
		raf = win!.requestAnimationFrame(frame)
	}

	// ---- tiny tween (GSAP's job in the reference) ----
	let tweenRaf = 0
	function tweenRot(to: number, dur: number, done?: () => void) {
		if (!win?.requestAnimationFrame) {
			setMyRot(to)
			return done?.()
		}
		win.cancelAnimationFrame(tweenRaf)
		const from = rot,
			t0 = (win.performance || performance).now()
		const step = (now: number) => {
			const p = Math.min(1, (now - t0) / (dur * 1000))
			const k = 1 - Math.pow(1 - p, 3) // power3.out
			setMyRot(from + (to - from) * k)
			if (p < 1) tweenRaf = win.requestAnimationFrame(step)
			else done?.()
		}
		tweenRaf = win.requestAnimationFrame(step)
	}
	function setMyRot(r: number) {
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
	let reportTimer: ReturnType<typeof setTimeout> | null = null
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
		if (reportTimer) clearTimeout(reportTimer)
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
	const release = (e: PointerEvent) => {
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
		socket.emit("gimmick-pour", {}, (res) => {
			const ack = res as Ack
			if (!ack?.ok) {
				if (ack && "error" in ack && ack.error) hint.textContent = ack.error
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
		const t = e.target as Element | null
		if (t?.closest('[data-act="ms-exit"]') || t?.closest('[data-hud="close"]')) exit()
		else if (t?.closest('[data-act="ms-wipe"]')) ground.wipe(myUserId()) // my own mess only
		else if (t?.closest('[data-act="ms-refill"]')) {
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
		const myName = opts.getMyName?.() || ""
		cupEl.innerHTML =
			cupSvg(getMyColor(), "me") +
			(myName ? `<span class="ms-cup-tag" style="color:${safeColor(getMyColor())}">${esc(myName)}</span>` : "")
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
	function exit({ fade = false }: { fade?: boolean } = {}) {
		if (!open) return
		open = false
		if (reportTimer) clearTimeout(reportTimer)
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
	function upsertRemote(d: RemoteCup) {
		let r = remote.get(d.userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "ms-cup remote"
			el.innerHTML = cupSvg(d.color, d.userId) + `<span class="ms-cup-tag" style="color:${safeColor(d.color)}">${esc(d.name)}</span>`
			othersBox.appendChild(el)
			const svg = el.querySelector("svg")!
			r = { el, tilt: svg, svg, x: 0, y: 0, rot: 0, level: 1, color: safeColor(d.color) }
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
	function dropRemote(userId: string, { fade = false }: { fade?: boolean } = {}) {
		const r = remote.get(userId)
		if (!r) return
		remote.delete(userId) // out of the map now; the fade only delays the DOM
		const done = () => {
			r.el.remove()
			syncLayer()
		}
		fade ? fadeOut(r.el, done) : done()
	}
	socket.on("gimmick-cup", (d: RemoteCup) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId, { fade: true })
		else upsertRemote(d)
	})
	socket.on("gimmick-cups", (list: RemoteCup[]) => {
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
			return ground.puddles.length
		},
		get ground() {
			return ground
		},
	}
}
