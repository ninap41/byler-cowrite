// Per-writer editor preferences — how the page LOOKS to you while drafting,
// never what the document contains.
//
// The distinction matters: font size is typed into the story and travels with
// it (beta readers and exports see it). Line spacing is comfort only — it is
// stored per browser, applied as a CSS variable, and deliberately never
// reaches the html, the server, or anyone else's screen.
//
// `storage` is injectable so tests don't need a real localStorage.
import { LOADED_FONTS, SYSTEM_FONTS, type FontFace } from "./fonts.js"
import type { StorageLike } from "./spectator-names.js"
const KEY = "cowriteEditorPrefs"

// Named steps rather than a free number: the control is a stepper, and these
// are the values that actually read differently on screen.
export const LINE_STEPS = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4] as const
export const DEFAULT_LINE = 1.7 // matches .editor's own line-height

// Text size, for READERS: a magnifier over the whole story (applied as CSS
// `zoom` on the reading surface, so the sizes an author typed in scale with
// the rest — a bigger font-size alone would leave every fs-* span at its
// own pixel size). Comfort only, like line spacing: per browser, never in
// the html. Authors size their text with the toolbar and don't get this.
export const TEXT_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2] as const
export const DEFAULT_TEXT = 1

// Paper colour of the writing surface — the same kind of preference as line
// spacing: it changes how the page looks to YOU and never touches the html.
// "theme" is the site's own panel colour (the default, and what every earlier
// draft looked like); light/dark force a plain white or black page for people
// who draft more comfortably against one of them.
export const PAPERS = ["theme", "light", "dark"] as const
export type Paper = (typeof PAPERS)[number]
export const DEFAULT_PAPER: Paper = "theme"

const cleanPaper = (v: unknown): Paper => ((PAPERS as readonly unknown[]).includes(v) ? (v as Paper) : DEFAULT_PAPER)

// The typeface the drafting surface is set in — the third view preference,
// alongside line spacing and paper. "theme" means whatever the current theme
// picked (--font-story, as overridden site-wide by the theme menu's Font row);
// the rest is the shared registry in fonts.js — the families this site
// already loads plus common system faces — so this menu and the theme menu
// can never offer different lists.
export const DOC_FONTS: readonly FontFace[] = [{ key: "theme", label: "Theme font", stack: "" }, ...LOADED_FONTS, ...SYSTEM_FONTS]
export const DEFAULT_FONT = "theme"
export const fontOf = (key: unknown): FontFace => DOC_FONTS.find((f) => f.key === key) || DOC_FONTS[0]!

// The typeface menu shows each face IN that face — a name is a poor preview of
// a letterform. "Theme font" has no stack of its own and inherits, so it
// previews as whatever the theme is already using.
export function fontMenuHtml(selected: string): string {
	return DOC_FONTS.map(
		(f) => `<option value="${f.key}" style="font-family:${f.stack || "inherit"};font-size:1.05em"${f.key === selected ? " selected" : ""}>${f.label}</option>`,
	).join("")
}
// The same list shaped for the flip menu (components/flip-select.js): each row
// previews itself in its own face, which is the entire reason that menu is our
// markup rather than a native option list.
export function fontRows(): { value: string; label: string; style: string }[] {
	return DOC_FONTS.map((f) => ({ value: f.key, label: f.label, style: `font-family:${f.stack || "var(--font-story)"}` }))
}
// And as the Appearance menu's inline radio list: a row per face, set in that
// face, the chosen one ticked.
export function fontListHtml(selected: string): string {
	return fontRows()
		.map(
			(f) =>
				`<button type="button" class="vis-opt menu-row font-opt${f.value === selected ? " on" : ""}" role="menuitemradio" ` +
				`aria-checked="${f.value === selected}" data-font="${f.value}" style="${f.style}">` +
				`<span>${f.label}</span><span class="menu-state">${f.value === selected ? "✓" : ""}</span></button>`,
		)
		.join("")
}
const cleanFont = (v: unknown): string => (DOC_FONTS.some((f) => f.key === v) ? (v as string) : DEFAULT_FONT)

// The comments drawer: whether it's open, and how wide you dragged it. Same
// class of preference as the others — it changes your view of the page and
// never the document. Width is clamped so a drag can't leave the prose column
// unusable or the rail too narrow to hold a comment card.
export const SIDE_MIN = 240
export const SIDE_MAX = 560
export const DEFAULT_SIDE = 300
export const clampSide = (v: unknown): number => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_SIDE
	return Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, n)))
}

const clampLine = (v: unknown): number => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_LINE
	return Math.min(LINE_STEPS[LINE_STEPS.length - 1]!, Math.max(LINE_STEPS[0], n))
}
const clampText = (v: unknown): number => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_TEXT
	return Math.min(TEXT_STEPS[TEXT_STEPS.length - 1]!, Math.max(TEXT_STEPS[0], n))
}

export interface EditorPrefs {
	lineHeight: number
	/** the reader's magnifier, 1 = as written */
	textSize: number
	paper: Paper
	font: string
	sideWidth: number
	sideOpen: boolean
	/** the chapter panel: open by default on a desktop, remembered after */
	chapOpen: boolean
}
const DEFAULTS: EditorPrefs = { lineHeight: DEFAULT_LINE, textSize: DEFAULT_TEXT, paper: DEFAULT_PAPER, font: DEFAULT_FONT, sideWidth: DEFAULT_SIDE, sideOpen: true, chapOpen: true }

const clean = (v: Partial<EditorPrefs> | null | undefined): EditorPrefs => ({
	lineHeight: v && v.lineHeight != null ? clampLine(v.lineHeight) : DEFAULT_LINE,
	textSize: v && v.textSize != null ? clampText(v.textSize) : DEFAULT_TEXT,
	paper: cleanPaper(v?.paper),
	font: cleanFont(v?.font),
	sideWidth: clampSide(v?.sideWidth),
	sideOpen: v?.sideOpen !== false,
	chapOpen: v?.chapOpen !== false,
})

export function loadPrefs(storage: StorageLike = localStorage): EditorPrefs {
	try {
		return clean(JSON.parse(storage.getItem(KEY) || "null") as Partial<EditorPrefs> | null)
	} catch {
		return { ...DEFAULTS }
	}
}

export function savePrefs(prefs: Partial<EditorPrefs> | null | undefined, storage: StorageLike = localStorage): EditorPrefs {
	const out = clean(prefs)
	try {
		storage.setItem(KEY, JSON.stringify(out))
	} catch {
		/* private mode — the preference just won't persist */
	}
	return out
}

// Next/previous step on the ladder, snapping from whatever the current value is.
export function stepLine(current: unknown, dir: number): number {
	const now = clampLine(current)
	if (dir > 0) return clampLine(LINE_STEPS.find((s) => s > now + 0.001) ?? now)
	return clampLine([...LINE_STEPS].reverse().find((s) => s < now - 0.001) ?? now)
}
export function stepText(current: unknown, dir: number): number {
	const now = clampText(current)
	if (dir > 0) return clampText(TEXT_STEPS.find((s) => s > now + 0.001) ?? now)
	return clampText([...TEXT_STEPS].reverse().find((s) => s < now - 0.001) ?? now)
}
