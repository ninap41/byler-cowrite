// The prompt-generation mode picker — markup AND wiring, so the lobby (before
// the game starts) and the vote card (while it's running) mount the same
// control and can't drift. Two modes ship: "simple" deals curated scenarios
// from prompts.json untouched, "intermediate" (Advanced) assembles one from
// axes — season, canon, place, situation, relationship, tone — plus one weighted
// trope and, past the age gate, the explicit layer. See docs/PROMPT_GENERATION.md.
import { esc } from "../util.js"
import type { ControlIdKey, ControlOffKey, MenuRow, OptionMeta, PromptControls, PromptMenus, PromptMode } from "../shared/wire.js"

export interface GuidedField {
	key: ControlIdKey
	suffix: string
	label: string
	menu: string
	onlyWhen?: Record<string, string | string[]>
	off?: ControlOffKey
	explicitOnly?: boolean
}

export const PROMPT_MODES: readonly { id: PromptMode; label: string; hint: string }[] = [
	{ id: "simple", label: "Simple", hint: "Hand-written scenarios, ready to write" },
	{ id: "intermediate", label: "Advanced", hint: "Build the scene from axes and tropes you choose" },
]

// Every guided axis: the id suffix its control gets, its label, and where its
// choices come from. `menu` names a pool from /api/prompt-options.
export const GUIDED_FIELDS: readonly GuidedField[] = [
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
	// the explicit dropdowns: shown at Explicit
	{ key: "setupId", suffix: "Setup", label: "Setup", menu: "setups", onlyWhen: { explicitLevel: ["explicit"] }, explicitOnly: true, off: "setupOff" },
	{ key: "dynamicId", suffix: "Dynamic", label: "Dynamic", menu: "dynamics", onlyWhen: { explicitLevel: ["explicit"] }, explicitOnly: true, off: "dynamicOff" },
	{ key: "actId", suffix: "Act", label: "Act", menu: "acts", onlyWhen: { explicitLevel: ["explicit"] }, explicitOnly: true, off: "actOff" },
	{ key: "kinkId", suffix: "Kink", label: "Kink", menu: "kinks", onlyWhen: { explicitLevel: ["explicit"] }, explicitOnly: true, off: "kinkOff" },
]
export const KINK_COUNTS: readonly number[] = [1, 2, 3]
export const OFF_KEYS: ControlOffKey[] = GUIDED_FIELDS.filter((f) => f.off).map((f) => f.off!)
// The fallback when /api/prompt-options carries no levels; the wire copy wins.
export const EXPLICIT_LEVELS: MenuRow[] = [
	{ id: "none", label: "None" },
	{ id: "explicit", label: "Explicit", adultOnly: true },
]
// a season the explicit layer may reach: the adult one, or one the pack marks explicit-ok
export const seasonAllowsExplicit = (season: MenuRow | null | undefined): boolean => !!season && (season.ageGroup === "adult" || (season.tags || []).includes("explicit-ok"))
export const DEFAULT_CONTROLS: PromptControls = {
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
	kinkCount: 1,
}

// "forced-proximity" -> "Forced proximity", for any pool authored as bare ids.
export function labelize(id: unknown): string {
	const s = String(id || "").replace(/-/g, " ")
	return s ? s[0]!.toUpperCase() + s.slice(1) : ""
}

// A <select>'s children: a Random entry plus one per component. `disabled`
// is a Set of ids that can't go with the other current choices.
export function menuHtml(items: (MenuRow | string)[] | null | undefined, selected?: string | null, { random = true, disabled }: { random?: boolean; disabled?: Set<string> } = {}): string {
	const rows: MenuRow[] = [...(random ? [{ id: "random", label: "Random" }] : []), ...(items || [])].map((it) =>
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
export interface ActiveContext {
	ageGroup: string | null
	canonId: string | null
	tags: Set<string>
}
type Pools = Record<string, MenuRow[] | undefined | null | { id: string; label: string }[]>
export function activeContext(menus: PromptMenus | null | undefined, c: Partial<PromptControls>): ActiveContext {
	const d = (menus?.intermediate || {}) as Pools
	const find = (list: Pools[string], id: string | undefined): MenuRow | undefined => ((list || []) as MenuRow[]).find((x) => x.id === id)
	const season = find(d.seasons, c.seasonId)
	const picks = [find(d.canon, c.canonId), find(d.worlds, c.worldId), find(d.relationships, c.relationshipId), find(d.tones, c.toneId), find(d.situations, c.situationId), find(d.places, c.placeId)]
	const tags = new Set(picks.flatMap((p) => p?.tags || []))
	// a world in play carries its own au-<id> tag (the generator's addTags
	// does the same), which is what that world's rooms require
	const world = find(d.worlds, c.worldId)
	if (world && (c.canonId === "au" || c.canonId === "random")) tags.add("au-" + world.id)
	if (season) for (const t of season.tags || []) tags.add(t)
	if (c.explicitLevel === "explicit") tags.add("explicit")
	return { ageGroup: season?.ageGroup || null, canonId: c.canonId && c.canonId !== "random" ? c.canonId : null, tags }
}

// Would the generator refuse this option beside the other choices? The same
// rules as isCompatible, read off the menu row's shipped rules.
export function optionAllowed(item: MenuRow | null | undefined, ctx: ActiveContext): boolean {
	if (!item || item.id === "random") return true
	if (item.ageGroups && ctx.ageGroup && !(item.ageGroups as string[]).includes(ctx.ageGroup)) return false
	if (item.adultOnly && ctx.ageGroup && ctx.ageGroup !== "adult") return false
	if (item.canon && ctx.canonId && !item.canon.includes(ctx.canonId)) return false
	if (item.excludes?.some((t) => ctx.tags.has(t))) return false
	if (item.requires?.some((t) => !ctx.tags.has(t))) return false
	return true
}

// The component chips under a guided option — what scene it was assembled
// from. A curated or hand-written scenario has no meta and gets nothing.
export const CHIP_ORDER: readonly string[] = ["season", "canon", "world", "place", "relationship", "situation", "tropes", "tone", "explicit"]
export function optionChipsHtml(meta: OptionMeta | null | undefined): string {
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
export function levelsFor(levels: MenuRow[] = [], seasons: MenuRow[] = [], seasonId?: string, tone: MenuRow | null | undefined = null): MenuRow[] {
	const season = seasons.find((s) => s.id === seasonId)
	// suggestive is deprecated: an old pack's row never reaches the menu
	levels = levels.filter((l) => l.id !== "suggestive")
	let out = !season || seasonAllowsExplicit(season) ? levels : levels.filter((l) => !l.adultOnly)
	// a tone that can't be explicit (fluff) takes Explicit off the menu too
	if (tone?.tags?.includes("no-explicit")) out = out.filter((l) => l.id !== "explicit")
	return out
}

// One page can hold two of these (lobby + vote card), so every id is prefixed.
export function promptModeHtml(prefix: string, { reroll = false }: { reroll?: boolean } = {}): string {
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
			`<select id="${p}${f.suffix}"></select>` +
			// how many kinks the line carries: beside the Kink menu, default one
			(f.key === "kinkId"
				? `<select id="${p}KinkN" class="pm-count" title="How many kinks on the line" aria-label="How many kinks">${KINK_COUNTS.map((n) => `<option value="${n}"${n === 1 ? " selected" : ""}>${n}</option>`).join("")}</select>`
				: "") +
			`</label>`,
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
export interface PromptModesOpts {
	prefix?: string
	onChange?: (v: { mode: PromptMode; controls: PromptControls }) => void
	onReroll?: () => void
}
export interface PromptModes {
	setMenus(next: PromptMenus | null): PromptModes
	setState(nextMode?: PromptMode | null, nextControls?: Partial<PromptControls> | null): PromptModes
	values(): { promptMode: PromptMode; promptControls: PromptControls }
	show(on: boolean): void
}
export function mountPromptModes(root: HTMLElement, { prefix = "pm", onChange, onReroll }: PromptModesOpts = {}): PromptModes {
	root.innerHTML = promptModeHtml(prefix, { reroll: !!onReroll })
	if (onReroll) root.querySelector("#" + prefix + "Reroll")!.addEventListener("click", () => onReroll())
	// every control is a <select>, the checkbox beside it, or a mode button; one
	// loose element surface keeps the wiring readable
	interface Ctl extends HTMLElement {
		value: string
		checked: boolean
		disabled: boolean
		options: HTMLOptionsCollection
	}
	const el = (suffix: string): Ctl => root.querySelector("#" + prefix + suffix) as Ctl
	let mode: PromptMode = "simple"
	let controls: PromptControls = { ...DEFAULT_CONTROLS }
	let menus: PromptMenus | null = null

	const readControls = (): PromptControls =>
		({
			...Object.fromEntries(GUIDED_FIELDS.map((f) => [f.key, el(f.suffix).value || "random"])),
			...Object.fromEntries(GUIDED_FIELDS.filter((f) => f.off).map((f) => [f.off!, !!el(f.suffix + "Off")?.checked])),
			explicitLevel: el("Explicit").value || "none",
			kinkCount: Number(el("KinkN")?.value) || 1,
		}) as PromptControls
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
		const valueOf = (k: string): string => (k === "explicitLevel" ? el("Explicit")?.value || "none" : el(GUIDED_FIELDS.find((g) => g.key === k)!.suffix)?.value || "random")
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
		// a first meeting has no relationship yet: the whole menu is off, not
		// just each row greyed (the rows are, too — every relationship refuses
		// the first-meeting tag — but a disabled select says it plainly)
		{
			const d = menus?.intermediate
			const sit = ((d?.situations || []) as MenuRow[]).find((x) => x.id === valueOf("situationId"))
			const first = !!sit?.tags?.includes("first-meeting")
			const rel = el("Rel")
			if (first) { rel.value = "random"; rel.disabled = true; rel.title = "A first meeting has no relationship yet" }
			else if (rel.disabled && rel.title === "A first meeting has no relationship yet") { rel.disabled = false; rel.title = "" }
		}
		// a part switched off: its menu is moot, so it reads Random and greys
		for (const f of GUIDED_FIELDS) {
			if (!f.off) continue
			const box = el(f.suffix + "Off")
			if (box?.checked) { el(f.suffix).value = "random"; el(f.suffix).disabled = true; el(f.suffix).title = f.label + " is left out" }
			else if (!f.explicitOnly) { el(f.suffix).disabled = false; el(f.suffix).title = "" }
		}
		const kn = el("KinkN")
		if (kn) kn.disabled = el("Kink").disabled
	}
	// Grey out what can't go with the rest. Each menu is judged against the
	// OTHER choices (not its own), so the current pick never disables itself;
	// a pick that has become impossible falls back to Random.
	// The pool a menu deals from. Only Place moves: under a chosen AU world it
	// is that world's own rooms (auPlaces whose `requires` names the world),
	// otherwise the generic places — so switching worlds, or back to canon,
	// swaps the whole list and a pick from the other pool falls to Random.
	function poolFor(f: GuidedField, c: PromptControls): MenuRow[] {
		const d = (menus?.intermediate || {}) as Pools
		if (f.key !== "placeId") return (d[f.menu] || []) as MenuRow[]
		const world = worldInPlay(c)
		if (!world) return (d.places || []) as MenuRow[]
		return ((d.auPlaces || []) as MenuRow[]).filter((p) => (p.requires || []).includes("au-" + world))
	}
	// the world that governs the Place menu: a chosen world when Canon is AU
	// or Random (a chosen world implies AU), never under a canon setting
	const worldInPlay = (c: PromptControls): string | null => (c.worldId && c.worldId !== "random" && (c.canonId === "au" || c.canonId === "random") ? c.worldId : null)
	function paintCompat() {
		const d = menus?.intermediate
		if (!d) return
		const c = readControls()
		for (const f of GUIDED_FIELDS) {
			const others: PromptControls = { ...c, [f.key]: "random" }
			const ctx = activeContext(menus, others)
			const pool = poolFor(f, c)
			const disabled = new Set(pool.filter((it) => !optionAllowed(it, ctx)).map((it) => it.id))
			const want = disabled.has(c[f.key]) || !pool.some((it) => it.id === c[f.key]) ? "random" : c[f.key]
			el(f.suffix).innerHTML = menuHtml(pool, want, { disabled })
			controls[f.key] = want
		}
	}
	function fire() {
		paintDependents()
		// levels narrow FIRST: a season that admits no Explicit drops the level
		// to None before the season menu is judged, so the season the host just
		// chose stays chosen (the two gates never fight); then once more after
		// the menus, in case a tone bounced
		paintLevels()
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
		const tone = ((d?.tones || []) as MenuRow[]).find((t) => t.id === el("Tone")?.value)
		const allowed = levelsFor(levels, (d?.seasons || []) as MenuRow[], el("Season")?.value || "random", tone)
		const want = allowed.some((l) => l.id === controls.explicitLevel) ? controls.explicitLevel : "none"
		el("Explicit").innerHTML = menuHtml(allowed, want, { random: false })
		controls.explicitLevel = want
	}
	el("Controls").addEventListener("change", () => {
		controls = readControls()
		fire()
	})

	const api: PromptModes = {
		// The menus arrive from /api/prompt-options; ids+labels only.
		setMenus(next) {
			menus = next
			const d = next?.intermediate
			if (d) for (const f of GUIDED_FIELDS) el(f.suffix).innerHTML = menuHtml(poolFor(f, controls), controls[f.key])
			paintLevels()
			paintDependents()
			paintCompat()
			paint()
			return api
		},
		setState(nextMode, nextControls) {
			if (nextMode) mode = nextMode
			if (nextControls) {
				controls = { ...controls, ...nextControls } as PromptControls
				for (const f of GUIDED_FIELDS) if (el(f.suffix).options.length) el(f.suffix).value = controls[f.key]
				for (const f of GUIDED_FIELDS) if (f.off && el(f.suffix + "Off")) el(f.suffix + "Off").checked = !!controls[f.off]
				if (el("KinkN")) el("KinkN").value = String(controls.kinkCount || 1)
				paintLevels()
				paintDependents()
				paintCompat()
			}
			paint()
			return api
		},
		values: () => ({ promptMode: mode, promptControls: readControls() }),
		show: (on) => void root.classList.toggle("hidden", !on),
	}
	paint()
	return api
}
