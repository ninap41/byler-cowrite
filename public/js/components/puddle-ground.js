// The mess on the floor, shared by every gimmick that spills something: the
// milkshake's spill and the SuperSoaker's water both land in one of these.
// It is the jazz-milkshake.html reference's merging-puddle model — drops
// landing along a floor line just above the foot bar (the chat dock still
// included) become wobbly pools that grow, merge and fleck — lifted out of
// milkshake-spill.js so two gimmicks can't drift apart.
//
// Every puddle and fleck carries its OWNER (the userId whose cup or gun
// dropped it): pools only merge within one owner, and `wipe(owner)` clears
// that owner's mess alone — you mop up what YOU put on the floor, the way the
// art room wipes only your own paint. `wipe()` with no owner clears the lot.
//
// The ground is pure geometry + one 2d canvas; the caller runs the clock
// (`tick(dt)` eases and merges, `draw()` repaints when it says so). It is
// deliberately DOM-light so jsdom can run the model with no canvas at all.

const MAX_PUDDLES = 60
const MAX_FLECKS = 240
export const POOL_X = 1.55, POOL_Y = 0.3, SPREAD = 2.4
export const FLOOR_LIFT = 26 // the floor line sits this far above the foot bar

// darken/lighten a #rrggbb by factor f (f<1 darkens)
export function shade(hex, f) {
	const m = /^#([0-9a-f]{6})$/i.exec(hex || "")
	if (!m) return hex
	const n = parseInt(m[1], 16)
	const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
	return "#" + [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")
}

export const radiusFor = (vol) => Math.min(230, Math.sqrt(vol / Math.PI) * SPREAD)
export const poolDist = (dx, dy) => Math.hypot(dx / POOL_X, dy / POOL_Y)

// opts: { canvas, win, doc, random }
export function createGround(opts = {}) {
	const canvas = opts.canvas || null
	const doc = opts.doc || (typeof document !== "undefined" ? document : null)
	const win = opts.win || doc?.defaultView || (typeof window !== "undefined" ? window : null)
	const random = opts.random || Math.random
	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800

	const puddles = [] // { id, x, y, vol, r, rT, color, owner }
	const flecks = [] // { x, y, r, color, owner }
	let puddleId = 0
	let dirty = true
	let ctx = null
	let floorY = vh() - FLOOR_LIFT

	// size the canvas to the viewport and find the floor line just above the
	// foot bar — the pool runs right over the chat dock, never under it
	function resize() {
		const DPR = Math.min(2, win?.devicePixelRatio || 1)
		if (canvas) {
			canvas.width = vw() * DPR
			canvas.height = vh() * DPR
			canvas.style.width = vw() + "px"
			canvas.style.height = vh() + "px"
			ctx = canvas.getContext?.("2d") || null
			ctx?.setTransform(DPR, 0, 0, DPR, 0, 0)
		}
		const footH = parseFloat(win?.getComputedStyle?.(doc?.documentElement).getPropertyValue("--footbar-h")) || 0
		floorY = vh() - footH - FLOOR_LIFT
		dirty = true
	}

	function add(x, y, r, color, owner = null) {
		const vol = r * r * 2.6
		let host = null
		for (const p of puddles) if (p.owner === owner && p.color === color && poolDist(x - p.x, y - p.y) < p.r + r * 2.5) { host = p; break }
		if (host) {
			const w = (vol / (host.vol + vol)) * 0.7
			host.x += (x - host.x) * w
			host.y += (y - host.y) * w
			host.vol += vol
			host.rT = radiusFor(host.vol)
		} else if (puddles.length < MAX_PUDDLES) {
			puddles.push({ id: ++puddleId, x, y, vol, r, rT: radiusFor(vol), color, owner })
		} else {
			// full up: fatten this owner's nearest pool (anyone's if they have none)
			let best = null, bd = Infinity
			for (const p of puddles) {
				if (p.owner !== owner) continue
				const d = poolDist(x - p.x, y - p.y)
				if (d < bd) { bd = d; best = p }
			}
			if (!best) best = puddles[0]
			best.vol += vol
			best.rT = radiusFor(best.vol)
		}
		flecks.push({ x: x + (random() - 0.5) * r * 13, y: y + (random() - 0.5) * r * 2.8, r: 1 + random() * 2.3, color, owner })
		if (flecks.length > MAX_FLECKS) flecks.splice(0, flecks.length - MAX_FLECKS)
		dirty = true
	}

	function mergeOverlapping() {
		let merged = true
		while (merged) {
			merged = false
			for (let i = 0; i < puddles.length && !merged; i++)
				for (let j = i + 1; j < puddles.length; j++) {
					const a = puddles[i], b = puddles[j]
					if (a.owner !== b.owner || a.color !== b.color) continue
					if (poolDist(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.84) {
						const v = a.vol + b.vol
						a.x = (a.x * a.vol + b.x * b.vol) / v
						a.y = (a.y * a.vol + b.y * b.vol) / v
						a.vol = v
						a.r = Math.max(a.r, b.r)
						a.rT = radiusFor(v)
						puddles.splice(j, 1)
						merged = true
						dirty = true
						break
					}
				}
		}
	}

	// ease every pool toward its target size and merge what now overlaps;
	// returns true when the ground wants a repaint
	function tick(dt) {
		let growing = false
		for (const p of puddles)
			if (Math.abs(p.r - p.rT) > 0.15) {
				p.r += (p.rT - p.r) * Math.min(1, dt * 5.5)
				growing = true
			}
		if (growing) mergeOverlapping()
		return growing || dirty
	}

	function blobPath(p, k) {
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
	function draw() {
		dirty = false
		if (!ctx) return
		ctx.clearRect(0, 0, vw(), vh())
		for (const f of flecks) {
			ctx.fillStyle = shade(f.color, 0.85)
			ctx.beginPath()
			ctx.ellipse(f.x, f.y, f.r * 1.5, f.r * 0.5, 0, 0, 6.28318)
			ctx.fill()
		}
		for (const p of puddles) {
			ctx.fillStyle = shade(p.color, 0.85)
			blobPath(p, 1)
			ctx.fill()
		}
		for (const p of puddles) {
			ctx.fillStyle = p.color
			blobPath(p, 0.84)
			ctx.fill()
		}
		for (const p of puddles) {
			const rx = p.r * POOL_X, ry = p.r * POOL_Y
			ctx.fillStyle = "rgba(255,255,255,.38)"
			ctx.beginPath()
			ctx.ellipse(p.x - rx * 0.3, p.y - ry * 0.4, rx * 0.3, Math.max(1, ry * 0.26), -0.1, 0, 6.28318)
			ctx.fill()
		}
	}

	// mop up one owner's mess (everything when no owner is named)
	function wipe(owner) {
		const keep = owner === undefined ? () => false : (m) => m.owner !== owner
		for (const list of [puddles, flecks]) {
			const left = list.filter(keep)
			list.length = 0
			list.push(...left)
		}
		dirty = true
		draw()
	}

	return {
		resize,
		add,
		tick,
		draw,
		wipe,
		get floorY() {
			return floorY
		},
		get dirty() {
			return dirty
		},
		get puddles() {
			return puddles
		},
		get flecks() {
			return flecks
		},
		get canvas() {
			return canvas
		},
	}
}
