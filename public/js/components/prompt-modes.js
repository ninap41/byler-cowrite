// The prompt-generation mode picker — markup AND wiring, so the lobby (before
// the game starts) and the vote card (while it's running) mount the same
// control and can't drift. Two modes ship: "simple" deals curated scenarios
// from prompts.json untouched, "intermediate" (Guided) assembles one from
// compatible clauses. See docs/PROMPT_GENERATION.md.
import { esc } from "../util.js"

export const PROMPT_MODES = [
	{ id: "simple", label: "Simple", hint: "Hand-written scenarios, ready to write" },
	{ id: "intermediate", label: "Guided", hint: "Build the scene from parts you choose" },
]

// Every guided knob: the id suffix its control gets, its label, and where its
// choices come from. `menu` names a pool from /api/prompt-options.
export const GUIDED_FIELDS = [
	{ key: "timePeriodId", suffix: "Period", label: "Time period", menu: "timePeriods" },
	{ key: "relationshipContextId", suffix: "Rel", label: "Relationship", menu: "relationshipContexts" },
	{ key: "toneId", suffix: "Tone", label: "Tone", menu: "tones" },
	{ key: "scenarioCategory", suffix: "Category", label: "Scenario type", menu: "categories" },
]
export const INTENSITIES = [
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
]
export const DEFAULT_CONTROLS = {
	timePeriodId: "random",
	relationshipContextId: "random",
	toneId: "random",
	scenarioCategory: "random",
	tensionIntensity: "medium",
	includeCatalyst: false,
}

// "forced-proximity" -> "Forced proximity". Tension categories are authored as
// bare ids in prompts.json, so the menu derives its labels rather than
// duplicating them.
export function labelize(id) {
	const s = String(id || "").replace(/-/g, " ")
	return s ? s[0].toUpperCase() + s.slice(1) : ""
}

// A <select>'s children: a Random entry plus one per component.
export function menuHtml(items, selected) {
	const rows = [{ id: "random", label: "Random" }, ...(items || [])].map((it) =>
		typeof it === "string" ? { id: it, label: labelize(it) } : it,
	)
	return rows
		.map(
			(it) =>
				`<option value="${esc(it.id)}"${it.id === (selected || "random") ? " selected" : ""}>${esc(
					it.label || labelize(it.id),
				)}</option>`,
		)
		.join("")
}

// The component chips under a guided option — what scene it was assembled
// from. A curated or hand-written scenario has no meta and gets nothing.
export function optionChipsHtml(meta) {
	const labels = meta?.labels
	if (!labels) return ""
	const chips = ["timePeriod", "location", "relationshipContext", "tension", "catalyst", "tone"]
		.map((k) => labels[k])
		.filter(Boolean)
	if (!chips.length) return ""
	return `<span class="opt-chips">${chips.map((c) => `<span class="opt-chip">${esc(c)}</span>`).join("")}</span>`
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
	<label for="${p}Intensity">Tension<select id="${p}Intensity">${INTENSITIES.map(
		(i) => `<option value="${i.id}"${i.id === "medium" ? " selected" : ""}>${i.label}</option>`,
	).join("")}</select></label>
	<label class="gc-check" for="${p}Catalyst"><input type="checkbox" id="${p}Catalyst" /> Add a catalyst</label>
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
		tensionIntensity: el("Intensity").value,
		includeCatalyst: el("Catalyst").checked,
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
	el("Controls").addEventListener("change", fire)

	const api = {
		// The menus arrive from /api/prompt-options; ids+labels only.
		setMenus(next) {
			menus = next
			const d = next?.intermediate
			if (d) for (const f of GUIDED_FIELDS) el(f.suffix).innerHTML = menuHtml(d[f.menu], controls[f.key])
			paint()
			return api
		},
		setState(nextMode, nextControls) {
			if (nextMode) mode = nextMode
			if (nextControls) {
				controls = { ...controls, ...nextControls }
				for (const f of GUIDED_FIELDS) if (el(f.suffix).options.length) el(f.suffix).value = controls[f.key]
				el("Intensity").value = controls.tensionIntensity || "medium"
				el("Catalyst").checked = !!controls.includeCatalyst
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
