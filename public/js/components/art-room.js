// Will's Art Room gimmick (see lib/gimmicks.js): a little paintbrush you take
// out over the live game and PAINT with — a swatch row plus a color picker —
// while the whole table watches the picture happen. No steal, pure
// distraction, the milkshake's category. Paint STAYS until its painter wipes
// it or leaves (or the game goes friendly); putting the brush away keeps it.
//
// Shared the strokes' way: the painter streams the stroke IN PROGRESS (the
// whole polyline so far, replaced each update, committed with `live: false`)
// plus their brush cursor as screen fractions (`gimmick-stroke`, throttled),
// the server validates/clamps/caps, and EVERY viewer redraws the paint on
// their own canvas — no pixel ever crosses the wire. `gimmick-paint` is the
// ack'd chat call when the brush comes out.
//
// The layer never takes the pointer for anyone but the painter: only while MY
// brush is out does an invisible catcher cover the page, so painting can
// never cost another writer their caret.
// Pure string builders (layerHtml, swatchRowHtml) are exported for tests;
// mountArtRoom() is the DOM + socket half.
import { esc, safeColor } from "../util.js"
import { hudCtlHtml } from "./gimmick-dock.js"

const MOVE_MS = 80 // how often my stroke-so-far goes out (cups use the same)
const BRUSH_SIZE = 6 // the default stroke width, px on a 1000px-wide screen (scales with width)
// The brush sizes on offer (the server clamps 2..40, so all of these ride
// the wire untouched). Ids keep the HUD readable; the dot preview is CSS.
export const BRUSH_SIZES = [
	{ id: "fine", size: 3 },
	{ id: "brush", size: 6 },
	{ id: "broad", size: 14 },
	{ id: "roller", size: 28 },
]
const MAX_PTS = 200 // a stroke past this auto-commits and a fresh one begins
const SWATCHES = ["#e63946", "#f4a261", "#facc15", "#3ddc84", "#38bdf8", "#c084fc", "#f5f0e8", "#16161d"]

// The swatch row: the painter's own palette colour leads, then the presets,
// then the free picker. Every colour paints a canvas strokeStyle, never a
// style attribute — but they're validated anyway (safeColor / the server's
// cleanHex) so junk can't ride along.
export function swatchRowHtml(myColor) {
	const colors = [safeColor(myColor), ...SWATCHES]
	const dots = colors
		.map((c, i) => `<button type="button" class="ar-swatch${i === 0 ? " on" : ""}" data-color="${c}" style="background:${c}" aria-label="Paint ${c}"></button>`)
		.join("")
	return `<span class="ar-swatches">${dots}<input type="color" id="arPick" value="#e63946" aria-label="Pick any color"><button type="button" class="ar-swatch ar-eraser" data-erase="1" aria-label="Eraser" title="Eraser">🧽</button></span>`
}

// The size row: one dot per brush width, the dot drawn at (a scaled-down
// version of) its own size so the row previews itself.
export function sizeRowHtml(selected = BRUSH_SIZE) {
	return `<span class="ar-sizes">${BRUSH_SIZES.map(
		(b) =>
			`<button type="button" class="ar-size${b.size === selected ? " on" : ""}" data-size="${b.size}" aria-label="Brush size ${b.id}" title="${b.id}"><i style="width:${Math.min(18, b.size)}px;height:${Math.min(18, b.size)}px"></i></button>`
	).join("")}</span>`
}

export const layerHtml = () => `<div class="ar-layer hidden" id="arLayer" aria-label="Art room">
	<canvas id="arCanvas"></canvas>
	<div id="arOthers"></div>
	<div id="arCatch" class="hidden"></div>
	<div class="ar-hud glass hidden" id="arHud">${hudCtlHtml()}
		<b class="ar-title">🎨 Will's Art Room</b>
		<span class="ar-hint" id="arHint">Drag anywhere to paint · put the brush away to grab other gimmicks</span>
		<div class="ar-row" id="arColors"></div>
		<div class="ar-row" id="arSizes"></div>
		<div class="ar-row">
			<button type="button" data-act="ar-wipe">Wipe my paint</button>
			<button type="button" class="ghost" data-act="ar-exit">↩ Put the brush away</button>
		</div>
	</div>
</div>`

// opts: { socket, getMyUserId, getMyColor, getMyName, document }
export function mountArtRoom(opts) {
	const { socket } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("arLayer")
	const canvas = doc.getElementById("arCanvas")
	const othersBox = doc.getElementById("arOthers")
	const catcher = doc.getElementById("arCatch")
	const hud = doc.getElementById("arHud")
	const hint = doc.getElementById("arHint")
	const colorsRow = doc.getElementById("arColors")
	const sizesRow = doc.getElementById("arSizes")
	const myUserId = () => opts.getMyUserId?.() ?? null

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
	const fr = (v) => clamp(v, 0, 1)

	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}

	// ---- the shared painting ----
	// userId -> { strokes: [{color,size,pts}], live: stroke|null } — mine
	// included, so a wipe or redraw treats every painter alike.
	const paint = new Map()
	const strokeCount = () =>
		[...paint.values()].reduce((n, p) => n + p.strokes.length + (p.live ? 1 : 0), 0)
	// jsdom has no 2d context; state still tracks so tests can pin the wiring.
	const ctx = canvas.getContext?.("2d") ?? null
	function sizeCanvas() {
		canvas.width = vw()
		canvas.height = vh()
	}
	function drawStroke(s) {
		if (!ctx || !s?.pts?.length) return
		// the eraser is a stroke that takes paint away instead of leaving it
		ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over"
		ctx.strokeStyle = s.erase ? "rgba(0,0,0,1)" : s.color
		ctx.lineWidth = Math.max(2, (s.size || BRUSH_SIZE) * (s.erase ? 3 : 1) * (vw() / 1000))
		ctx.lineCap = "round"
		ctx.lineJoin = "round"
		ctx.beginPath()
		ctx.moveTo(s.pts[0][0] * vw(), s.pts[0][1] * vh())
		for (const [px, py] of s.pts.slice(1)) ctx.lineTo(px * vw(), py * vh())
		if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * vw() + 0.1, s.pts[0][1] * vh()) // a dot still marks
		ctx.stroke()
		ctx.globalCompositeOperation = "source-over"
	}
	function redraw() {
		if (!ctx) return
		// the canvas starts at the element default (300x150) until someone sizes
		// it — a viewer who never opened the room would have every remote stroke
		// land outside the bitmap and see nothing, so redraw sizes it on demand
		if (canvas.width !== vw() || canvas.height !== vh()) sizeCanvas()
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		for (const p of paint.values()) {
			for (const s of p.strokes) drawStroke(s)
			if (p.live) drawStroke(p.live)
		}
	}
	const painterOf = (userId) => {
		let p = paint.get(userId)
		if (!p) {
			p = { strokes: [], live: null }
			paint.set(userId, p)
		}
		return p
	}

	// ---- my brush ----
	let open = false
	let curColor = safeColor(opts.getMyColor?.())
	let curErase = false // 🧽 selected: strokes take paint away
	let curSize = BRUSH_SIZE
	let stroke = null // the stroke being painted right now
	const remote = new Map() // userId -> cursor el (their brush position)
	const syncLayer = () => {
		const on = open || remote.size > 0 || strokeCount() > 0
		layer.classList.toggle("hidden", !on)
	}

	// relaying my stroke-so-far (the WHOLE polyline, replaced server-side)
	let reportTimer = null
	let cursorAt = null
	function report(now = false) {
		if (!open) return
		if (!now) {
			if (reportTimer) return
			reportTimer = setTimeout(() => {
				reportTimer = null
				send()
			}, MOVE_MS)
			return
		}
		clearTimeout(reportTimer)
		reportTimer = null
		send()
	}
	function send(final = false) {
		const msg = { on: true }
		if (cursorAt) msg.cursor = cursorAt
		if (stroke?.pts.length) {
			msg.stroke = stroke
			msg.live = !final
		} else if (final) return
		socket.emit("gimmick-stroke", msg)
	}

	function beginStroke(px, py) {
		stroke = { color: curColor, size: curSize, pts: [[fr(px / vw()), fr(py / vh())]], ...(curErase ? { erase: true } : {}) }
		const p = painterOf(myUserId())
		p.live = stroke
		redraw()
		report(true)
	}
	function extendStroke(px, py) {
		if (!stroke) return
		stroke.pts.push([fr(px / vw()), fr(py / vh())])
		if (ctx) {
			const n = stroke.pts.length
			drawStroke({ ...stroke, pts: stroke.pts.slice(n - 2) }) // just the new segment
		}
		if (stroke.pts.length >= MAX_PTS) return endStroke() // commit and keep painting
		report()
	}
	function endStroke() {
		if (!stroke) return
		clearTimeout(reportTimer)
		reportTimer = null
		send(true)
		const p = painterOf(myUserId())
		p.live = null
		p.strokes.push(stroke)
		stroke = null
	}

	// painting: the catcher takes the pointer only while MY brush is out
	let painting = false
	catcher.addEventListener("pointerdown", (e) => {
		if (e.button != null && e.button !== 0) return
		painting = true
		catcher.setPointerCapture?.(e.pointerId)
		cursorAt = [fr(e.clientX / vw()), fr(e.clientY / vh())]
		beginStroke(e.clientX, e.clientY)
		e.preventDefault()
	})
	catcher.addEventListener("pointermove", (e) => {
		if (!open) return
		cursorAt = [fr(e.clientX / vw()), fr(e.clientY / vh())]
		if (painting) extendStroke(e.clientX, e.clientY)
		else report()
	})
	const release = (e) => {
		if (!painting) return
		painting = false
		catcher.releasePointerCapture?.(e.pointerId)
		endStroke()
	}
	catcher.addEventListener("pointerup", release)
	catcher.addEventListener("pointercancel", release)

	// ---- HUD ----
	layer.addEventListener("click", (e) => {
		const sz = e.target.closest(".ar-size")
		if (sz) {
			curSize = Math.max(2, Math.min(40, Number(sz.dataset.size) || BRUSH_SIZE))
			for (const b of sizesRow.querySelectorAll(".ar-size")) b.classList.toggle("on", b === sz)
			return
		}
		const sw = e.target.closest(".ar-swatch")
		if (sw) {
			curErase = sw.dataset.erase === "1"
			if (!curErase) curColor = safeColor(sw.dataset.color)
			for (const b of colorsRow.querySelectorAll(".ar-swatch")) b.classList.toggle("on", b === sw)
			return
		}
		if ((e.target.closest('[data-act="ar-exit"]') || e.target.closest('[data-hud="close"]'))) exit()
		else if (e.target.closest('[data-act="ar-wipe"]')) wipe()
	})
	layer.addEventListener("input", (e) => {
		if (e.target?.id !== "arPick") return
		const v = String(e.target.value || "")
		if (/^#[0-9a-fA-F]{6}$/.test(v)) {
			curColor = v.toLowerCase()
			curErase = false
			for (const b of colorsRow.querySelectorAll(".ar-swatch")) b.classList.remove("on")
		}
	})

	function wipe() {
		const p = paint.get(myUserId())
		if (p) {
			p.strokes = []
			p.live = null
		}
		stroke = null
		redraw()
		syncLayer()
		socket.emit("gimmick-stroke", { wipe: true })
	}

	function start() {
		if (open) return
		open = true
		sizeCanvas()
		redraw()
		colorsRow.innerHTML = swatchRowHtml(opts.getMyColor?.())
		sizesRow.innerHTML = sizeRowHtml(curSize)
		curColor = safeColor(opts.getMyColor?.())
		curErase = false
		catcher.classList.remove("hidden")
		hud.classList.remove("hidden")
		hint.textContent = "Drag anywhere to paint · put the brush away to grab other gimmicks"
		syncLayer()
		// the server calls the brush coming out in chat (and is the cooldown);
		// a hard refusal (friendly / nobody unlocked) shows here and the brush
		// goes back away — a cooldown just means "again already?" and paints on.
		socket.emit("gimmick-paint", {}, (ack) => {
			if (ack?.ok || !ack?.error) return
			hint.textContent = ack.error
			if (!/wet/i.test(ack.error)) exit({ keepHint: true })
		})
	}
	function exit({ fade = false, keepHint = false } = {}) {
		if (!open) return
		open = false
		painting = false
		if (stroke) endStroke()
		clearTimeout(reportTimer)
		reportTimer = null
		cursorAt = null
		const done = () => {
			catcher.classList.add("hidden")
			if (!keepHint) hud.classList.add("hidden")
			syncLayer()
		}
		if (fade) fadeOut(hud, done)
		else done()
		socket.emit("gimmick-stroke", { on: false }) // brush away — the paint stays
	}

	// The table went friendly: brushes, cursors and every stroke fade away
	// rather than blinking off. Returns whether anything was out.
	function gimmicksOff() {
		const had = open || remote.size > 0 || strokeCount() > 0
		for (const uid of [...remote.keys()]) dropCursor(uid, { fade: true })
		if (open) exit({ fade: true })
		if (strokeCount() > 0) {
			paint.clear()
			fadeOut(canvas, () => {
				redraw()
				syncLayer()
			})
		}
		syncLayer()
		return had
	}

	// ---- everyone else's brushes ----
	function upsertCursor(d) {
		if (!Array.isArray(d.cursor)) return
		let el = remote.get(d.userId)
		if (!el) {
			el = doc.createElement("div")
			el.className = "ar-brush remote"
			el.innerHTML = `🖌<span class="ar-tag" style="color:${safeColor(d.color)}">${esc(d.name || "")}</span>`
			othersBox.appendChild(el)
			remote.set(d.userId, el)
		}
		el.style.left = Math.round(fr(d.cursor[0]) * vw()) + "px"
		el.style.top = Math.round(fr(d.cursor[1]) * vh()) + "px"
		syncLayer()
	}
	function dropCursor(userId, { fade = false } = {}) {
		const el = remote.get(userId)
		if (!el) return
		remote.delete(userId)
		const done = () => {
			el.remove()
			syncLayer()
		}
		fade ? fadeOut(el, done) : done()
	}
	socket.on("gimmick-stroke", (d) => {
		if (!d || d.userId === myUserId()) return
		if (d.wipe && d.on === false) {
			// the painter left (or the game went friendly): paint and brush go
			paint.delete(d.userId)
			dropCursor(d.userId, { fade: true })
			redraw()
			syncLayer()
			return
		}
		if (d.wipe) {
			const p = paint.get(d.userId)
			if (p) {
				p.strokes = []
				p.live = null
			}
			redraw()
			syncLayer()
			return
		}
		if (d.on === false) return dropCursor(d.userId, { fade: true }) // brush away, paint stays
		if (d.cursor) upsertCursor(d)
		// no cursor riding along? the stroke's newest point says where the
		// brush is — the painter's name always follows their painting
		else if (d.stroke?.pts?.length) upsertCursor({ ...d, cursor: d.stroke.pts[d.stroke.pts.length - 1] })
		if (d.stroke) {
			const p = painterOf(d.userId)
			if (d.live === false) {
				p.live = null
				p.strokes.push(d.stroke)
			} else {
				p.live = d.stroke
			}
			redraw()
		}
		syncLayer()
	})
	socket.on("gimmick-paints", (list) => {
		for (const d of list || []) {
			if (d.userId === myUserId()) continue
			const p = painterOf(d.userId)
			p.strokes = Array.isArray(d.strokes) ? d.strokes : []
			p.live = d.live || null
			if (d.on !== false && d.cursor) upsertCursor(d)
		}
		sizeCanvas()
		redraw()
		syncLayer()
	})

	win?.addEventListener?.("resize", () => {
		sizeCanvas()
		redraw()
	})

	return {
		start,
		exit,
		wipe,
		gimmicksOff,
		get open() {
			return open
		},
		get others() {
			return [...remote.keys()]
		},
		get strokeCount() {
			return strokeCount()
		},
		get color() {
			return curColor
		},
		get size() {
			return curSize
		},
	}
}
