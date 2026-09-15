// The Palace Arcade Galaga gimmick (see lib/gimmicks.js): a shared arcade
// battle fought OVER the live game, the same way the dice are thrown over it.
// Every player who starts a run gets a pixel ship in their OWN palette
// colour at the foot of the screen, a bobbing bee fleet up top, and shots in
// between — and the whole table (spectators too) watches every battle at
// once, because each player relays their ship/fleet/shots as fractions of
// their own screen (`gimmick-ship`, throttled, exactly like `gimmick-die`)
// and the server clamps + rebroadcasts. Several battles run side by side;
// only the FINAL score is authoritative: it goes up as `gimmick-galaga
// {score, steal}` and beating GALAGA_TARGET steals the turn like a natural
// 20 (same opt-out, same localStorage key as the die).
//
// The layer takes no pointer events — the game under it stays usable — so my
// ship steers from the document: mouse/finger position and ←/→ move it,
// Space (or the HUD's Fire button) shoots, and every key is ignored while
// the focus is in an editor or input, so a writer typing a line never fires
// a shot. Pure string builders (galagaHtml, galagaResultHtml, shipShadow)
// are exported for tests; mountGalaga() is the DOM + socket half. It owns no
// rules — the server does.
import { esc, safeColor } from "../util.js"
import { hudCtlHtml } from "./gimmick-dock.js"
import type { Gimmick, GimmickMountOpts, Ack } from "./gimmick-types.js"

/** A bee on the relay: [x, y, dive, id] as fractions of the owner's screen. */
export type BeeOnWire = [number, number, 0 | 1, number] | [number, number, 0 | 1]
export interface RemoteShip {
	userId: string
	name: string
	color: string
	x: number
	score?: number
	shots?: [number, number][]
	bees?: BeeOnWire[]
	on?: boolean
}
export interface GalagaResult {
	score?: number
	kind?: string
	stole?: boolean
	declined?: boolean
	error?: string
}

export const GALAGA_TARGET = 8000 // beat this and the run steals the turn (server agrees)
export const ROUND_SECS = 45
export const POINTS: { bob: number; dive: number } = { bob: 100, dive: 300 } // a diving bee is worth chasing; a long run of ~55+ kills reaches the 8,000 target
export const STEAL_KEY = "cowriteDiceSteal" // one standing preference for every gimmick
const SLOTS = 4 // fleet columns (two rows)
const MOVE_MS = 80 // how often my battle goes out while running (dice use 60)

// The player ship sprite: the arcade theme's pixel triangle, its red pixels
// re-inked in the writer's own palette colour so every ship at the table
// reads as its owner.
export const shipShadow = (color: string): string => {
	const c = safeColor(color)
	return (
		`0 -8px 0 ${c},` +
		`0 -4px 0 #f6edff,` +
		`-4px 0 0 #f6edff, 0 0 0 #f6edff, 4px 0 0 #f6edff,` +
		`-8px 4px 0 #f6edff, -4px 4px 0 #f6edff, 0 4px 0 ${c}, 4px 4px 0 #f6edff, 8px 4px 0 #f6edff`
	)
}

export const galagaHtml = (): string => `<div class="gg-layer hidden" id="ggLayer" aria-label="Palace Arcade Galaga">
	<div id="ggOthers"></div>
	<div class="gg-battle hidden" id="ggMine"></div>
	<div class="gg-hud glass hidden" id="ggHud">${hudCtlHtml()}
		<b class="gg-title">👾 Palace Arcade</b>
		<div class="gg-row"><span class="gg-score" id="ggScore">0</span><span class="gg-meta">beat ${GALAGA_TARGET} to steal the turn</span><span class="gg-time" id="ggTime">${ROUND_SECS}</span></div>
		<div class="gg-over hidden" id="ggOver"></div>
		<label class="gg-steal checkline"><input type="checkbox" id="ggSteal" checked /> Steal the turn if I beat ${GALAGA_TARGET}</label>
		<div class="gg-row">
			<button type="button" class="gg-fire" data-act="gg-fire">🔫 Fire (Space)</button>
			<button type="button" class="ghost" data-act="gg-exit">↩ Put away</button>
		</div>
	</div>
</div>`

// The end-of-run card inside the HUD.
export function galagaResultHtml({ score, kind, stole, declined = false, error = "" }: GalagaResult = {}): string {
	if (error) return `<b class="gg-final">${esc(error)}</b>`
	const pts = Number(score || 0).toLocaleString()
	const line =
		kind === "highscore"
			? stole
				? "You beat " + GALAGA_TARGET + ", the turn is yours. Go write."
				: declined
					? "You beat " + GALAGA_TARGET + ", and let the writer keep the turn."
					: "You beat " + GALAGA_TARGET + "!"
			: "The fleet holds. " + GALAGA_TARGET + " steals the turn."
	return `<b class="gg-final${kind === "highscore" ? " win" : ""}">${pts}</b><span class="gg-hint">${line}</span><button type="button" data-act="gg-again">Play again</button>`
}

// opts: { socket, getMyUserId, getMyName, getMyColor, document }
export interface GalagaGimmick extends Gimmick {
	shoot(): void
	readonly score: number
	readonly others: string[]
	/** tests end a run without waiting out the clock */
	finishNow(): void
}
interface Shot {
	el: HTMLElement
	x: number
	y: number
}
interface Bee {
	el: HTMLElement
	slot: number
	id: number
	dive: boolean
	t: number
	x: number
	y: number
	dead: boolean
}
interface RemoteBattle {
	el: HTMLElement
	ship: HTMLElement
	tag: HTMLElement
	bees: Map<string, HTMLElement>
	shots: HTMLElement[]
	color: string
}
export function mountGalaga(opts: GimmickMountOpts): GalagaGimmick {
	const { socket, getMyColor = () => "#e63946", getMyName = () => "me" } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", galagaHtml())
	const layer = doc.getElementById("ggLayer")!
	const mine = doc.getElementById("ggMine")!
	const othersBox = doc.getElementById("ggOthers")!
	const hud = doc.getElementById("ggHud")!
	const scoreEl = doc.getElementById("ggScore")!
	const timeEl = doc.getElementById("ggTime")!
	const overEl = doc.getElementById("ggOver")!
	const stealBox = doc.getElementById("ggSteal") as HTMLInputElement
	const myUserId = () => opts.getMyUserId?.() ?? null
	let store: Storage | null = null
	try {
		store = win?.localStorage || null
	} catch {}
	stealBox.checked = store?.getItem(STEAL_KEY) !== "0"
	stealBox.addEventListener("change", () => store?.setItem(STEAL_KEY, stealBox.checked ? "1" : "0"))

	const vw = () => win?.innerWidth || 1200
	const vh = () => win?.innerHeight || 800
	const setPos = (el: HTMLElement, x: number, y: number) => {
		el.style.left = Math.round(x) + "px"
		el.style.top = Math.round(y) + "px"
	}
	const shipY = () => vh() - 110 // above the foot bar + HUD line

	// ---- my battle ----
	let open = false, // my ship is out (running, or standing on the result)
		running = false,
		score = 0,
		left = ROUND_SECS,
		shipX = 0.5, // fraction of my screen width
		keys = { l: false, r: false },
		shots: Shot[] = [], // px
		bees: Bee[] = [], // px
		raf = 0,
		timerId: ReturnType<typeof setInterval> | 0 = 0,
		diveId: ReturnType<typeof setInterval> | 0 = 0,
		lastT = 0
	let shipEl: HTMLElement | null = null,
		myTag: HTMLElement | null = null
	const paintMyTag = () => {
		if (myTag) myTag.textContent = `${getMyName()} · ${score.toLocaleString()}`
	}

	function slotXY(slot: number) {
		const col = slot % SLOTS,
			row = Math.floor(slot / SLOTS)
		return { x: vw() * (0.2 + (0.6 / (SLOTS - 1)) * col), y: vh() * 0.1 + row * 46 }
	}
	let beeN = 0 // stable per-bee ids ride the relay so viewers can tell a KILL from a reshuffle
	function spawnBee(slot: number) {
		const el = doc.createElement("i")
		el.className = "gg-enemy"
		mine.appendChild(el)
		const b: Bee = { el, slot, id: beeN++, dive: false, t: Math.random() * 6.28, x: 0, y: 0, dead: false }
		const p = slotXY(slot)
		b.x = p.x
		b.y = p.y
		setPos(el, b.x, b.y)
		bees.push(b)
		return b
	}
	function killBee(b: Bee) {
		b.dead = true
		b.el.classList.add("hit")
		score += b.dive ? POINTS.dive : POINTS.bob
		scoreEl.textContent = score.toLocaleString()
		paintMyTag()
		const el = b.el,
			slot = b.slot
		setTimeout(() => el.remove(), 260)
		bees = bees.filter((x) => x !== b)
		if (running) setTimeout(() => running && spawnBee(slot), 1100) // the fleet refills — targets never run out
	}
	function startDive() {
		const calm = bees.filter((b) => !b.dive && !b.dead)
		if (!calm.length) return
		const b = calm[Math.floor(Math.random() * calm.length)]!
		b.dive = true
		b.el.classList.add("dive")
	}

	function step(now: number) {
		if (!running) return
		const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016)
		lastT = now
		if (keys.l) shipX -= 0.9 * dt
		if (keys.r) shipX += 0.9 * dt
		shipX = Math.max(0.03, Math.min(0.97, shipX))
		if (shipEl) setPos(shipEl, shipX * vw(), shipY())
		if (myTag) setPos(myTag, shipX * vw(), shipY() + 18)
		for (const sh of shots) {
			sh.y -= 520 * dt
			setPos(sh.el, sh.x, sh.y)
		}
		for (const b of bees) {
			if (b.dead) continue
			if (b.dive) {
				b.t += dt * 3
				b.y += 150 * dt
				b.x += Math.sin(b.t) * 80 * dt
				if (b.y > vh() + 24) {
					b.dive = false
					b.el.classList.remove("dive")
					const p = slotXY(b.slot)
					b.x = p.x
					b.y = -24
				}
			} else {
				b.t += dt * 2.2
				const p = slotXY(b.slot)
				b.x += (p.x - b.x) * Math.min(1, dt * 3)
				b.y += (p.y + Math.sin(b.t) * 8 - b.y) * Math.min(1, dt * 3)
			}
			setPos(b.el, b.x, b.y)
		}
		for (const sh of [...shots]) {
			for (const b of bees) {
				if (b.dead) continue
				if (Math.abs(sh.x - b.x) < 16 && Math.abs(sh.y - b.y) < 16) {
					killBee(b)
					dropShot(sh)
					break
				}
			}
			if (sh.y < -16) dropShot(sh)
		}
		report()
		raf = win?.requestAnimationFrame?.(step) ?? 0
	}
	function dropShot(sh: Shot) {
		sh.el.remove()
		shots = shots.filter((x) => x !== sh)
	}
	function shoot() {
		if (!running || shots.length >= 3) return
		const el = doc.createElement("i")
		el.className = "gg-shot"
		el.style.background = safeColor(getMyColor())
		mine.appendChild(el)
		const sh: Shot = { el, x: shipX * vw(), y: shipY() - 16 }
		setPos(el, sh.x, sh.y)
		shots.push(sh)
	}

	// ---- relaying my battle to the table (throttled, like the die) ----
	let lastSent = 0
	function report(now = false) {
		if (!open) return
		const t = Date.now()
		if (!now && t - lastSent < MOVE_MS) return
		lastSent = t
		socket.emit("gimmick-ship", {
			on: true,
			x: shipX,
			score,
			shots: shots.map((sh) => [sh.x / vw(), sh.y / vh()]),
			bees: bees.filter((b) => !b.dead).map((b) => [b.x / vw(), b.y / vh(), b.dive ? 1 : 0, b.id]),
		})
	}

	// ---- controls: the layer takes no pointer, so my ship steers from the
	// document — and never while the writer is typing somewhere.
	const typing = (t: EventTarget | null): boolean => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable], #chatCard")
	function onKey(e: KeyboardEvent, down: boolean) {
		if (!running || typing(e.target)) return
		if (e.key === "ArrowLeft" || e.key === "a") keys.l = down
		else if (e.key === "ArrowRight" || e.key === "d") keys.r = down
		else if (down && (e.key === " " || e.key === "ArrowUp")) shoot()
		else if (down && e.key === "Escape") return exit()
		else return
		e.preventDefault()
	}
	doc.addEventListener("keydown", (e) => onKey(e, true))
	doc.addEventListener("keyup", (e) => onKey(e, false))
	doc.addEventListener("pointermove", (e) => {
		if (running) shipX = Math.max(0.03, Math.min(0.97, e.clientX / (vw() || 1)))
	})
	layer.addEventListener("click", (e) => {
		const t = e.target as Element | null
		if (t?.closest('[data-act="gg-exit"]') || t?.closest('[data-hud="close"]')) exit()
		else if (t?.closest('[data-act="gg-again"]')) begin()
		else if (t?.closest('[data-act="gg-fire"]')) shoot()
	})

	// Fade an element out with gsap when the page loads it; instant otherwise.
	const fadeOut = (el: HTMLElement | null, done: () => void) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.5, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}
	// The layer shows whenever ANY battle is on (mine or theirs). While one
	// is, the ARCADE THEME's own ambient Galaga (fleet/ship/shot in
	// .bg-set.arcade) is put away — two fleets reads as noise, and the game
	// one is the one being played (html.gg-live in base.css fades them).
	const syncLayer = () => {
		const on = open || remote.size > 0
		layer.classList.toggle("hidden", !on)
		doc.documentElement.classList.toggle("gg-live", on)
	}

	// ---- the run ----
	function clearMine() {
		for (const b of bees) b.el.remove()
		for (const sh of shots) sh.el.remove()
		bees = []
		shots = []
	}
	function begin() {
		overEl.classList.add("hidden")
		overEl.innerHTML = ""
		clearMine()
		if (!shipEl) {
			shipEl = doc.createElement("i")
			shipEl.className = "gg-ship"
			mine.appendChild(shipEl)
			myTag = doc.createElement("span")
			myTag.className = "gg-ship-tag"
			mine.appendChild(myTag)
		}
		shipEl.style.boxShadow = shipShadow(getMyColor())
		myTag!.style.color = safeColor(getMyColor())
		paintMyTag()
		score = 0
		left = ROUND_SECS
		scoreEl.textContent = "0"
		timeEl.textContent = String(left)
		setPos(shipEl, shipX * vw(), shipY())
		setPos(myTag!, shipX * vw(), shipY() + 18)
		for (let i = 0; i < SLOTS * 2; i++) spawnBee(i)
		running = true
		lastT = win?.performance?.now?.() ?? 0
		raf = win?.requestAnimationFrame?.(step) ?? 0
		if (timerId) clearInterval(timerId)
		timerId = setInterval(() => {
			left -= 1
			timeEl.textContent = String(Math.max(0, left))
			if (left <= 0) finish()
		}, 1000)
		if (diveId) clearInterval(diveId)
		diveId = setInterval(startDive, 1600)
		report(true)
	}
	function halt() {
		running = false
		win?.cancelAnimationFrame?.(raf)
		if (timerId) clearInterval(timerId)
		if (diveId) clearInterval(diveId)
	}
	function finish() {
		halt()
		report(true) // the table sees the battlefield freeze where it ended
		// the server decides what the score means; the ack paints the card
		socket.emit("gimmick-galaga", { score, steal: stealBox.checked }, (res) => {
			const ack = res as Ack<GalagaResult>
			overEl.innerHTML = galagaResultHtml(
				ack?.ok
					? { ...ack, declined: ack.kind === "highscore" && !ack.stole && !stealBox.checked }
					: { error: (ack && "error" in ack && ack.error) || "The arcade ate your quarter." },
			)
			overEl.classList.remove("hidden")
		})
	}

	function start() {
		if (open) return
		open = true
		mine.classList.remove("hidden")
		hud.classList.remove("hidden")
		syncLayer()
		begin()
	}
	function exit({ fade = false }: { fade?: boolean } = {}) {
		if (!open) return
		halt()
		open = false
		const done = () => {
			clearMine()
			shipEl?.remove()
			shipEl = null
			myTag?.remove()
			myTag = null
			mine.classList.add("hidden")
			hud.classList.add("hidden")
			overEl.classList.add("hidden")
			syncLayer()
		}
		if (fade) {
			fadeOut(mine, done)
			fadeOut(hud, () => {})
		} else done()
		socket.emit("gimmick-ship", { on: false })
	}

	// The table went friendly: every battle fades away rather than blinking
	// off. Returns whether anything was out, so the page knows to say why.
	function gimmicksOff() {
		const had = open || remote.size > 0
		for (const uid of [...remote.keys()]) dropRemote(uid, { fade: true })
		if (open) exit({ fade: true })
		return had
	}

	// ---- everyone else's battles: painted from the relay, inert ----
	const remote = new Map<string, RemoteBattle>()
	function upsertRemote(d: RemoteShip) {
		let r = remote.get(d.userId)
		if (!r) {
			const el = doc.createElement("div")
			el.className = "gg-battle remote"
			const ship = doc.createElement("i")
			ship.className = "gg-ship"
			el.appendChild(ship)
			const tag = doc.createElement("span")
			tag.className = "gg-ship-tag"
			el.appendChild(tag)
			othersBox.appendChild(el)
			r = { el, ship, tag, bees: new Map(), shots: [], color: "" }
			remote.set(d.userId, r)
		}
		if (r.color !== d.color) {
			r.color = d.color
			r.ship.style.boxShadow = shipShadow(d.color)
			r.tag.style.color = safeColor(d.color)
		}
		r.tag.textContent = `${d.name} · ${Number(d.score || 0).toLocaleString()}`
		setPos(r.ship, d.x * vw(), shipY())
		setPos(r.tag, d.x * vw(), shipY() + 18)
		// Bees are keyed by the id riding the relay ([x, y, dive, id]) so a
		// kill removes exactly the bee that was hit — index-matching made every
		// LATER bee jump into the dead one's place. A bee that vanishes between
		// updates was shot: it explodes here too (the shooter's own .hit flash)
		// instead of silently blinking away. Updates arrive throttled (~80ms),
		// so the remote elements carry a CSS left/top transition — but a dive
		// wrapping from the bottom edge back to the top would GLIDE up the whole
		// screen, so a jump longer than half the screen snaps instead.
		const seen = new Set()
		;(d.bees || []).forEach((p, i) => {
			const key = p.length > 3 && Number.isFinite(Number(p[3])) ? "b" + p[3] : "i" + i
			seen.add(key)
			let el = r.bees.get(key)
			if (!el) {
				el = doc.createElement("i")
				el.className = "gg-enemy"
				r.el.appendChild(el)
				r.bees.set(key, el)
			}
			el.classList.toggle("dive", !!p[2])
			const py = p[1] * vh()
			const prevY = Number(el.dataset.y)
			if (Number.isFinite(prevY) && Math.abs(py - prevY) > vh() * 0.4) {
				el.style.transition = "none"
				setTimeout(() => (el.style.transition = ""), 60)
			}
			el.dataset.y = String(py)
			setPos(el, p[0] * vw(), py)
		})
		for (const [key, el] of [...r.bees.entries()]) {
			if (seen.has(key)) continue
			r.bees.delete(key)
			el.classList.add("hit")
			setTimeout(() => el.remove(), 260)
		}
		const want = d.shots || []
		while (r.shots.length < want.length) {
			const el = doc.createElement("i")
			el.className = "gg-shot"
			r.el.appendChild(el)
			r.shots.push(el)
		}
		while (r.shots.length > want.length) r.shots.pop()!.remove()
		want.forEach((p, i) => {
			r.shots[i]!.style.background = safeColor(d.color)
			setPos(r.shots[i]!, p[0] * vw(), p[1] * vh())
		})
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
	socket.on("gimmick-ship", (d: RemoteShip) => {
		if (!d || d.userId === myUserId()) return
		if (d.on === false) dropRemote(d.userId, { fade: true })
		else upsertRemote(d)
	})
	socket.on("gimmick-ships", (list: RemoteShip[]) => {
		for (const d of list || []) if (d.userId !== myUserId()) upsertRemote(d)
	})

	win?.addEventListener?.("resize", () => {
		if (open && shipEl) setPos(shipEl, shipX * vw(), shipY())
	})

	return {
		start,
		exit,
		shoot,
		gimmicksOff,
		get open() {
			return open
		},
		get score() {
			return score
		},
		get others() {
			return [...remote.keys()]
		},
		finishNow: finish, // tests end a run without waiting out the clock
	}
}
