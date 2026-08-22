// Vecna's Curse gimmick (see lib/gimmicks.js and UNLOCKS.md): the first toy
// aimed at a PERSON. The HUD lists your tablemates; click one and — on their
// screen — the clock chimes, the page greys out under a red mist vignette,
// and debris drifts upward like the Creel house ceiling. They're being
// taken. Everyone else watches from outside: the victim's chips pulse red.
//
// The escape is the theme's own logic inverted: WRITING is the song that
// saves you. Typing ~15 characters (CURSE_LIFT_CHARS) anywhere lifts the
// curse (`gimmick-uncurse`, and the payoff line lands in chat); left alone
// it fades after the relayed `duration`. Nothing is ever blocked — the veil
// is pointer-events none, the text stays readable underneath. Cosmetic
// dread, zero mechanical harm.
import { esc, safeColor } from "../util.js"

export const CURSE_LIFT_CHARS = 15 // mirrors lib/gimmicks.js (the server agrees)

export const layerHtml = () => `<div class="vcx-layer hidden" id="vcxLayer" aria-label="Vecna's curse">
	<div class="vcx-veil hidden" id="vcxVeil">
		<i class="vcx-mote m1"></i><i class="vcx-mote m2"></i><i class="vcx-mote m3"></i>
		<i class="vcx-mote m4"></i><i class="vcx-mote m5"></i><i class="vcx-mote m6"></i>
		<div class="vcx-word" id="vcxWord"></div>
	</div>
	<div class="vcx-hud glass hidden" id="vcxHud">
		<b class="vcx-title">🕰️ Vecna's Curse</b>
		<span class="vcx-hint" id="vcxHint">Choose who the clock strikes for</span>
		<div class="vcx-row" id="vcxTargets"></div>
		<div class="vcx-row">
			<button type="button" class="ghost" data-act="vcx-exit">↩ Leave the clock alone</button>
		</div>
	</div>
</div>`

// The target list: every OTHER connected writer is clickable; you and the
// disconnected are listed but disabled — the server enforces the same rule.
export function targetsHtml(writers = [], myUserId = null) {
	if (!writers.length) return `<span class="vcx-none">Nobody else is at the table.</span>`
	return writers
		.map((w) => {
			const disabled = w.userId === myUserId || w.connected === false
			const why = w.userId === myUserId ? " (you)" : w.connected === false ? " (away)" : ""
			return `<button type="button" class="vcx-target" data-target="${esc(String(w.userId ?? ""))}"${disabled ? " disabled" : ""} style="color:${safeColor(w.color)}">${esc(w.name)}${why}</button>`
		})
		.join("")
}

// opts: { socket, getMyUserId, getTable, playChime, document }
// getTable() -> [{userId, name, color, connected}] (game.html keeps it from
// game-state); playChime() rings the vecna clock under the sound prefs.
export function mountVecnaCurse(opts) {
	const { socket } = opts
	const doc = opts.document || document
	const win = doc.defaultView || (typeof window !== "undefined" ? window : null)
	doc.body.insertAdjacentHTML("beforeend", layerHtml())
	const layer = doc.getElementById("vcxLayer")
	const veil = doc.getElementById("vcxVeil")
	const word = doc.getElementById("vcxWord")
	const hud = doc.getElementById("vcxHud")
	const hint = doc.getElementById("vcxHint")
	const targetsBox = doc.getElementById("vcxTargets")
	const myUserId = () => opts.getMyUserId?.() ?? null

	const fadeOut = (el, done) => {
		const g = win?.gsap
		if (!g || !el) return done()
		g.to(el, { opacity: 0, duration: 0.8, ease: "power2.in", onComplete: () => { g.set(el, { clearProps: "opacity" }); done() } })
	}

	// ---- the curse in flight (at most one per session) ----
	let cursed = null // { targetUserId, timer } — whoever it's on, seen by all
	let typed = 0 // MY typed characters while I am the victim
	const mineNow = () => cursed && cursed.targetUserId === myUserId()

	function markChips(on) {
		// the victim's name chips pulse red wherever they appear
		const name = cursed?.targetName
		for (const el of doc.querySelectorAll(".player-chip, .roster li, .story-line")) el.classList.remove("vcx-cursed")
		if (!on || !name) return
		const sel = win?.CSS?.escape ? win.CSS.escape(name) : name.replace(/["\\]/g, "\\$&")
		for (const el of doc.querySelectorAll(`[data-user="${sel}"]`)) el.classList.add("vcx-cursed")
	}
	function fall(d) {
		clearTimeout(cursed?.timer)
		cursed = { targetUserId: d.targetUserId, targetName: d.targetName, timer: null }
		typed = 0
		doc.documentElement.classList.add("vcx-live") // the vecna theme's clock is the tell
		markChips(true)
		if (mineNow()) {
			veil.classList.remove("hidden")
			word.textContent = "WRITE."
			// the victim's whole page runs backwards — mirrored text, the
			// Upside Down's way (cosmetic: clicks still land, nothing blocked)
			doc.documentElement.classList.add("vcx-taken")
			opts.playChime?.()
		}
		layer.classList.remove("hidden")
		// every screen clears itself at the duration even if the lift is missed
		cursed.timer = setTimeout(() => lift(), Math.max(1000, Number(d.duration) || 20000))
	}
	function lift() {
		if (!cursed) return
		clearTimeout(cursed.timer)
		cursed = null
		typed = 0
		doc.documentElement.classList.remove("vcx-live")
		doc.documentElement.classList.remove("vcx-taken")
		markChips(false)
		if (!veil.classList.contains("hidden")) fadeOut(veil, () => veil.classList.add("hidden"))
		syncLayer()
	}

	// WRITING is the way out: my own keys anywhere count while I'm cursed
	doc.addEventListener("keydown", (e) => {
		if (!mineNow()) return
		if (e.key?.length !== 1) return // characters, not chords/arrows
		typed++
		word.textContent = "WRITE." + "✍".repeat(Math.min(6, Math.ceil((typed / CURSE_LIFT_CHARS) * 6)))
		if (typed >= CURSE_LIFT_CHARS) socket.emit("gimmick-uncurse", {}, () => {})
	})

	// ---- the HUD ----
	let open = false
	const syncLayer = () => {
		layer.classList.toggle("hidden", !(open || cursed))
	}
	layer.addEventListener("click", (e) => {
		const t = e.target.closest(".vcx-target")
		if (t && !t.disabled) {
			socket.emit("gimmick-curse", { targetUserId: t.dataset.target }, (ack) => {
				hint.textContent = ack?.ok ? "The clock strikes… 🕰️" : ack?.error || "The curse slipped."
			})
			return
		}
		if (e.target.closest('[data-act="vcx-exit"]')) exit()
	})

	function start() {
		if (open) return
		open = true
		targetsBox.innerHTML = targetsHtml(opts.getTable?.() ?? [], myUserId())
		hint.textContent = "Choose who the clock strikes for"
		hud.classList.remove("hidden")
		syncLayer()
	}
	function exit({ fade = false } = {}) {
		if (!open) return
		open = false
		const done = () => {
			hud.classList.add("hidden")
			syncLayer()
		}
		fade ? fadeOut(hud, done) : done()
	}

	// The table went friendly: the HUD folds and any live curse lifts.
	function gimmicksOff() {
		const had = open || !!cursed
		if (cursed) lift()
		if (open) exit({ fade: true })
		return had
	}

	socket.on("gimmick-curse", (d) => {
		if (!d?.targetUserId) return
		if (d.lift) return lift()
		fall(d)
	})

	return {
		start,
		exit,
		gimmicksOff,
		get open() {
			return open
		},
		get cursedUserId() {
			return cursed?.targetUserId ?? null
		},
		get typed() {
			return typed
		},
	}
}
