// The prompt-generation mode picker — markup AND wiring, so the lobby (before
// the game starts) and the vote card (while it's running) mount the same
// control and can't drift. Two modes ship: "simple" deals curated scenarios
// from prompts.json untouched, "intermediate" (Guided) assembles one from
// axes — season, canon, place, situation, relationship, tone — plus one weighted
// trope and, past the age gate, the explicit layer. See docs/PROMPT_GENERATION.md.
import { esc } from "../util.js"

export const PROMPT_MODES = [
	{ id: "simple", label: "Simple", hint: "Hand-written scenarios, ready to write" },
	{ id: "intermediate", label: "Guided", hint: "Build the scene from axes and tropes you choose" },
]

// Every guided axis: the id suffix its control gets, its label, and where its
// choices come from. `menu` names a pool from /api/prompt-options.
export const GUIDED_FIELDS = [
	{ key: "seasonId", suffix: "Season", label: "Season", menu: "seasons" },
	{ key: "canonId", suffix: "Canon", label: "Canon", menu: "canon" },
	{ key: "placeId", suffix: "Place", label: "Place", menu: "places" },
	{ key: "situationId", suffix: "Situation", label: "Situation", menu: "situations" },
	{ key: "relationshipId", suffix: "Rel", label: "Relationship", menu: "relationships" },
	{ key: "toneId", suffix: "Tone", label: "Tone", menu: "tones" },
]
// The fallback when /api/prompt-options carries no levels; the wire copy wins.
export const EXPLICIT_LEVELS = [
	{ id: "none", label: "None" },
	{ id: "suggestive", label: "Suggestive" },
	{ id: "explicit", label: "Explicit", adultOnly: true },
]
export const DEFAULT_CONTROLS = {
	seasonId: "random",
	canonId: "random",
	placeId: "random",
	situationId: "random",
	relationshipId: "random",
	toneId: "random",
	explicitLevel: "none",
}

// "forced-proximity" -> "Forced proximity", for any pool authored as bare ids.
export function labelize(id) {
	const s = String(id || "").replace(/-/g, " ")
	return s ? s[0].toUpperCase() + s.slice(1) : ""
}

// A <select>'s children: a Random entry plus one per component.
export function menuHtml(items, selected, { random = true } = {}) {
	const rows = [...(random ? [{ id: "random", label: "Random" }] : []), ...(items || [])].map((it) =>
		typeof it === "string" ? { id: it, label: labelize(it) } : it,
	)
	const current = selected || (random ? "random" : rows[0]?.id)
	return rows
		.map(
			(it) =>
				`<option value="${esc(it.id)}"${it.id === current ? " selected" : ""}>${esc(
					it.label || labelize(it.id),
				)}</option>`,
		)
		.join("")
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
export function levelsFor(levels = [], seasons = [], seasonId) {
	const season = seasons.find((s) => s.id === seasonId)
	if (!season || season.ageGroup === "adult") return levels
	return levels.filter((l) => !l.adultOnly)
}

// One page can hold two of these (lobby + vote card), so every id is prefixed.
export function promptModeHtml(prefix) {
	const p = esc(prefix)
	const modes = PROMPT_MODES.map(
		(m) =>
			`<button class="head-chip" type="button" id="${p}Mode-${m.id}" data-mode="${m.id}" title="${esc(m.hint)}">${esc(m.label)}</button>`,
	).join("")
	const fields = GUIDED_FIELDS.map(
		(f) => `<label for="${p}${f.suffix}">${esc(f.label)}<select id="${p}${f.suffix}"></select></label>`,
	).join("")
	return `<div class="mode-row" id="${p}Row">
	<span class="subtle">Scenarios:</span>${modes}
	<span class="subtle mode-hint" id="${p}Hint"></span>
</div>
<div class="guided-controls hidden" id="${p}Controls">
	${fields}
	<label for="${p}Explicit">Explicit<select id="${p}Explicit">${menuHtml(EXPLICIT_LEVELS, "none", { random: false })}</select></label>
</div>`
}

// Mounts the control into `root`. onChange fires on any user change with the
// current {mode, controls} — the lobby just remembers it until Begin, the vote
// card emits set-prompt-mode.
export function mountPromptModes(root, { prefix = "pm", onChange } = {}) {
	root.innerHTML = promptModeHtml(prefix)
	const el = (suffix) => root.querySelector("#" + prefix + suffix)
	let mode = "simple"
	let controls = { ...DEFAULT_CONTROLS }
	let menus = null

	const readControls = () => ({
		...Object.fromEntries(GUIDED_FIELDS.map((f) => [f.key, el(f.suffix).value || "random"])),
		explicitLevel: el("Explicit").value || "none",
	})
	function paint() {
		// Guided is only offerable once we know the component pools exist.
		const guided = mode === "intermediate" && !!menus?.intermediate
		for (const m of PROMPT_MODES) el("Mode-" + m.id).classList.toggle("on", m.id === mode)
		el("Mode-intermediate").disabled = !menus?.intermediate
		el("Controls").classList.toggle("hidden", !guided)
		el("Hint").textContent = PROMPT_MODES.find((m) => m.id === mode)?.hint || ""
	}
	function fire() {
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
		const allowed = levelsFor(levels, d?.seasons || [], el("Season")?.value || "random")
		const want = allowed.some((l) => l.id === controls.explicitLevel) ? controls.explicitLevel : "none"
		el("Explicit").innerHTML = menuHtml(allowed, want, { random: false })
		controls.explicitLevel = want
	}
	el("Controls").addEventListener("change", (e) => {
		if (e.target === el("Season")) {
			controls = readControls()
			paintLevels()
		}
		fire()
	})

	const api = {
		// The menus arrive from /api/prompt-options; ids+labels only.
		setMenus(next) {
			menus = next
			const d = next?.intermediate
			if (d) for (const f of GUIDED_FIELDS) el(f.suffix).innerHTML = menuHtml(d[f.menu], controls[f.key])
			paintLevels()
			paint()
			return api
		},
		setState(nextMode, nextControls) {
			if (nextMode) mode = nextMode
			if (nextControls) {
				controls = { ...controls, ...nextControls }
				for (const f of GUIDED_FIELDS) if (el(f.suffix).options.length) el(f.suffix).value = controls[f.key]
				paintLevels()
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
