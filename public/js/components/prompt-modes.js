// The prompt-generation mode picker — markup AND wiring, so the lobby (before
// the game starts) and the vote card (while it's running) mount the same
// control and can't drift. Two modes ship: "simple" deals curated scenarios
// from prompts.json untouched, "intermediate" (Advanced) assembles one from
// axes — season, canon, place, situation, relationship, tone — plus one weighted
// trope and, past the age gate, the explicit layer. See docs/PROMPT_GENERATION.md.
import { esc } from "../util.js"

export const PROMPT_MODES = [
	{ id: "simple", label: "Simple", hint: "Hand-written scenarios, ready to write" },
	{ id: "intermediate", label: "Advanced", hint: "Build the scene from axes and tropes you choose" },
]

// Every guided axis: the id suffix its control gets, its label, and where its
// choices come from. `menu` names a pool from /api/prompt-options.
export const GUIDED_FIELDS = [
	{ key: "seasonId", suffix: "Season", label: "Season", menu: "seasons" },
	{ key: "canonId", suffix: "Canon", label: "Canon", menu: "canon" },
	// only shown while Canon is Alternate universe — which world it is
	{ key: "worldId", suffix: "World", label: "AU world", menu: "worlds", onlyWhen: { canonId: "au" } },
	{ key: "placeId", suffix: "Place", label: "Place", menu: "places" },
	{ key: "situationId", suffix: "Situation", label: "Situation", menu: "situations", off: "situationOff" },
	{ key: "relationshipId", suffix: "Rel", label: "Relationship", menu: "relationships" },
	// `off` names the control that leaves this part out entirely (a checkbox
	// beside the label): switched off, the part is never drawn, so it never
	// reaches the card
	{ key: "toneId", suffix: "Tone", label: "Tone", menu: "tones", off: "toneOff" },
	// the explicit dropdowns: shown past None, enabled only at Explicit (the
	// gate never deals a Kinks line under Suggestive)
	{ key: "setupId", suffix: "Setup", label: "Setup", menu: "setups", onlyWhen: { explicitLevel: ["suggestive", "explicit"] }, explicitOnly: true, off: "setupOff" },
	{ key: "dynamicId", suffix: "Dynamic", label: "Dynamic", menu: "dynamics", onlyWhen: { explicitLevel: ["suggestive", "explicit"] }, explicitOnly: true, off: "dynamicOff" },
	{ key: "actId", suffix: "Act", label: "Act", menu: "acts", onlyWhen: { explicitLevel: ["suggestive", "explicit"] }, explicitOnly: true, off: "actOff" },
	{ key: "kinkId", suffix: "Kink", label: "Kink", menu: "kinks", onlyWhen: { explicitLevel: ["suggestive", "explicit"] }, explicitOnly: true, off: "kinkOff" },
]
export const OFF_KEYS = GUIDED_FIELDS.filter((f) => f.off).map((f) => f.off)
// The fallback when /api/prompt-options carries no levels; the wire copy wins.
export const EXPLICIT_LEVELS = [
	{ id: "none", label: "None" },
	{ id: "suggestive", label: "Suggestive" },
	{ id: "explicit", label: "Explicit", adultOnly: true },
]
export const DEFAULT_CONTROLS = {
	seasonId: "random",
	canonId: "random",
	worldId: "random",
	placeId: "random",
	situationId: "random",
	relationshipId: "random",
	toneId: "random",
	explicitLevel: "none",
	setupId: "random",
	dynamicId: "random",
	actId: "random",
	kinkId: "random",
	situationOff: false,
	toneOff: false,
	setupOff: false,
	dynamicOff: false,
	actOff: false,
	kinkOff: false,
}

// "forced-proximity" -> "Forced proximity", for any pool authored as bare ids.
export function labelize(id) {
	const s = String(id || "").replace(/-/g, " ")
	return s ? s[0].toUpperCase() + s.slice(1) : ""
}

// A <select>'s children: a Random entry plus one per component. `disabled`
// is a Set of ids that can't go with the other current choices.
export function menuHtml(items, selected, { random = true, disabled } = {}) {
	const rows = [...(random ? [{ id: "random", label: "Random" }] : []), ...(items || [])].map((it) =>
		typeof it === "string" ? { id: it, label: labelize(it) } : it,
	)
	const current = selected || (random ? "random" : rows[0]?.id)
	return rows
		.map(
			(it) =>
				`<option value="${esc(it.id)}"${it.id === current ? " selected" : ""}${disabled?.has(it.id) ? " disabled" : ""}>${esc(
					it.label || labelize(it.id),
				)}</option>`,
		)
		.join("")
}

// The tags the current choices put into play, the way the generator would
// (lib/prompt-gen.js isCompatible): the chosen season's age, the canon and
// world, relationship and tone tags, and "explicit" when that rating is set.
export function activeContext(menus, c) {
	const d = menus?.intermediate || {}
	const find = (list, id) => (list || []).find((x) => x.id === id)
	const season = find(d.seasons, c.seasonId)
	const picks = [find(d.canon, c.canonId), find(d.worlds, c.worldId), find(d.relationships, c.relationshipId), find(d.tones, c.toneId), find(d.situations, c.situationId), find(d.places, c.placeId)]
	const tags = new Set(picks.flatMap((p) => p?.tags || []))
	if (season) for (const t of season.tags || []) tags.add(t)
	if (c.explicitLevel === "explicit") tags.add("explicit")
	return { ageGroup: season?.ageGroup || null, canonId: c.canonId && c.canonId !== "random" ? c.canonId : null, tags }
}

// Would the generator refuse this option beside the other choices? The same
// rules as isCompatible, read off the menu row's shipped rules.
export function optionAllowed(item, ctx) {
	if (!item || item.id === "random") return true
	if (item.ageGroups && ctx.ageGroup && !item.ageGroups.includes(ctx.ageGroup)) return false
	if (item.adultOnly && ctx.ageGroup && ctx.ageGroup !== "adult") return false
	if (item.canon && ctx.canonId && !item.canon.includes(ctx.canonId)) return false
	if (item.excludes?.some((t) => ctx.tags.has(t))) return false
	if (item.requires?.some((t) => !ctx.tags.has(t))) return false
	return true
}

// The component chips under a guided option — what scene it was assembled
// from. A curated or hand-written scenario has no meta and gets nothing.
export const CHIP_ORDER = ["season", "canon", "world", "place", "relationship", "situation", "tropes", "tone", "explicit"]
export function optionChipsHtml(meta) {
	const labels = meta?.labels
	if (!labels) return ""
	const chips = CHIP_ORDER.flatMap((k) => (Array.isArray(labels[k]) ? labels[k] : [labels[k]])).filter(Boolean)
	if (!chips.length) return ""
	return `<span class="opt-chips">${chips.map((c) => `<span class="opt-chip">${esc(c)}</span>`).join("")}</span>`
}

// The explicit levels a season admits. Explicit is adult-only, and age comes
// from the season: a minor season leaves only None and Suggestive on the
// menu. Random offers everything — asking for explicit then narrows the
// season draw to the adult ones server-side.
export function levelsFor(levels = [], seasons = [], seasonId, tone = null) {
	const season = seasons.find((s) => s.id === seasonId)
	let out = !season || season.ageGroup === "adult" ? levels : levels.filter((l) => !l.adultOnly)
	// a tone that can't be explicit (fluff) takes Explicit off the menu too
	if (tone?.tags?.includes("no-explicit")) out = out.filter((l) => l.id !== "explicit")
	return out
}

// One page can hold two of these (lobby + vote card), so every id is prefixed.
export function promptModeHtml(prefix, { reroll = false } = {}) {
	const p = esc(prefix)
	const modes = PROMPT_MODES.map(
		(m) =>
			`<button class="head-chip" type="button" id="${p}Mode-${m.id}" data-mode="${m.id}" title="${esc(m.hint)}">${esc(m.label)}</button>`,
	).join("")
	const fields = GUIDED_FIELDS.map(
		(f) =>
			`<label for="${p}${f.suffix}" id="${p}${f.suffix}Wrap"${f.onlyWhen ? ' class="hidden"' : ""}>` +
			`<span class="pm-lab">${esc(f.label)}${
				f.off ? `<input type="checkbox" class="pm-off" id="${p}${f.suffix}Off" title="Leave ${esc(f.label)} out of the prompt" aria-label="Leave ${esc(f.label)} out">` : ""
			}</span>` +
			`<select id="${p}${f.suffix}"></select></label>`,
	).join("")
	return `<div class="mode-row" id="${p}Row">
	<span class="subtle">Scenarios:</span>${modes}
	<span class="subtle mode-hint" id="${p}Hint"></span>
</div>
<div class="guided-controls hidden" id="${p}Controls">
	${fields}
	<label for="${p}Explicit">Explicit<select id="${p}Explicit">${menuHtml(EXPLICIT_LEVELS, "none", { random: false })}</select></label>
	${reroll ? `<button type="button" class="ghost pm-reroll" id="${p}Reroll" title="Deal four new options from these settings">🎲 Reroll all</button>` : ""}
</div>`
}

// Mounts the control into `root`. onChange fires on any user change with the
// current {mode, controls} — the lobby just remembers it until Begin, the vote
// card emits set-prompt-mode.
export function mountPromptModes(root, { prefix = "pm", onChange, onReroll } = {}) {
	root.innerHTML = promptModeHtml(prefix, { reroll: !!onReroll })
	if (onReroll) root.querySelector("#" + prefix + "Reroll").addEventListener("click", () => onReroll())
	const el = (suffix) => root.querySelector("#" + prefix + suffix)
	let mode = "simple"
	let controls = { ...DEFAULT_CONTROLS }
	let menus = null

	const readControls = () => ({
		...Object.fromEntries(GUIDED_FIELDS.map((f) => [f.key, el(f.suffix).value || "random"])),
		...Object.fromEntries(GUIDED_FIELDS.filter((f) => f.off).map((f) => [f.off, !!el(f.suffix + "Off")?.checked])),
		explicitLevel: el("Explicit").value || "none",
	})
	function paint() {
		// Advanced is only offerable once we know the component pools exist.
		const guided = mode === "intermediate" && !!menus?.intermediate
		for (const m of PROMPT_MODES) el("Mode-" + m.id).classList.toggle("on", m.id === mode)
		el("Mode-intermediate").disabled = !menus?.intermediate
		el("Controls").classList.toggle("hidden", !guided)
		el("Hint").textContent = PROMPT_MODES.find((m) => m.id === mode)?.hint || ""
	}
	// A dependent knob (the AU world) only shows while its condition holds;
	// hidden, it reads as Random so a stale pick can't ride along.
	function paintDependents() {
		const valueOf = (k) => (k === "explicitLevel" ? el("Explicit")?.value || "none" : el(GUIDED_FIELDS.find((g) => g.key === k).suffix)?.value || "random")
		for (const f of GUIDED_FIELDS) {
			if (!f.onlyWhen) continue
			const on = Object.entries(f.onlyWhen).every(([k, v]) => (Array.isArray(v) ? v : [v]).includes(valueOf(k)))
			el(f.suffix + "Wrap").classList.toggle("hidden", !on)
			if (!on) el(f.suffix).value = "random"
			// listed under Suggestive so the host can see what Explicit offers,
			// but only Explicit reads them
			if (f.explicitOnly) {
				const live = valueOf("explicitLevel") === "explicit"
				el(f.suffix).disabled = !live
				el(f.suffix).title = live ? "" : "Explicit only"
				if (!live) el(f.suffix).value = "random"
				const box = el(f.suffix + "Off")
				if (box) box.disabled = !live
			}
		}
		// a part switched off: its menu is moot, so it reads Random and greys
		for (const f of GUIDED_FIELDS) {
			if (!f.off) continue
			const box = el(f.suffix + "Off")
			if (box?.checked) { el(f.suffix).value = "random"; el(f.suffix).disabled = true; el(f.suffix).title = f.label + " is left out" }
			else if (!f.explicitOnly) { el(f.suffix).disabled = false; el(f.suffix).title = "" }
		}
	}
	// Grey out what can't go with the rest. Each menu is judged against the
	// OTHER choices (not its own), so the current pick never disables itself;
	// a pick that has become impossible falls back to Random.
	function paintCompat() {
		const d = menus?.intermediate
		if (!d) return
		const c = readControls()
		for (const f of GUIDED_FIELDS) {
			const others = { ...c, [f.key]: "random" }
			const ctx = activeContext(menus, others)
			const disabled = new Set((d[f.menu] || []).filter((it) => !optionAllowed(it, ctx)).map((it) => it.id))
			const want = disabled.has(c[f.key]) ? "random" : c[f.key]
			el(f.suffix).innerHTML = menuHtml(d[f.menu], want, { disabled })
			controls[f.key] = want
		}
	}
	function fire() {
		paintDependents()
		paintCompat()
		paintLevels()
		controls = readControls()
		onChange?.({ mode, controls })
	}
	for (const m of PROMPT_MODES)
		el("Mode-" + m.id).addEventListener("click", () => {
			if (m.id === "intermediate" && !menus?.intermediate) return
			mode = m.id
			paint()
			fire()
		})
	// Narrowing the Explicit menu is not a change of anything the server needs
	// to hear about — it just stops the menu offering a level this season has
	// no room for. A level that falls out of the list falls back to None.
	function paintLevels() {
		const d = menus?.intermediate
		const levels = d?.explicitLevels?.length ? d.explicitLevels : EXPLICIT_LEVELS
		const tone = (d?.tones || []).find((t) => t.id === el("Tone")?.value)
		const allowed = levelsFor(levels, d?.seasons || [], el("Season")?.value || "random", tone)
		const want = allowed.some((l) => l.id === controls.explicitLevel) ? controls.explicitLevel : "none"
		el("Explicit").innerHTML = menuHtml(allowed, want, { random: false })
		controls.explicitLevel = want
	}
	el("Controls").addEventListener("change", () => {
		controls = readControls()
		fire()
	})

	const api = {
		// The menus arrive from /api/prompt-options; ids+labels only.
		setMenus(next) {
			menus = next
			const d = next?.intermediate
			if (d) for (const f of GUIDED_FIELDS) el(f.suffix).innerHTML = menuHtml(d[f.menu], controls[f.key])
			paintLevels()
			paintDependents()
			paintCompat()
			paint()
			return api
		},
		setState(nextMode, nextControls) {
			if (nextMode) mode = nextMode
			if (nextControls) {
				controls = { ...controls, ...nextControls }
				for (const f of GUIDED_FIELDS) if (el(f.suffix).options.length) el(f.suffix).value = controls[f.key]
				for (const f of GUIDED_FIELDS) if (f.off && el(f.suffix + "Off")) el(f.suffix + "Off").checked = !!controls[f.off]
				paintLevels()
				paintDependents()
				paintCompat()
			}
			paint()
			return api
		},
		values: () => ({ promptMode: mode, promptControls: readControls() }),
		show: (on) => root.classList.toggle("hidden", !on),
	}
	paint()
	return api
}
