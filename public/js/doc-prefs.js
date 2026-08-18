// Per-writer editor preferences — how the page LOOKS to you while drafting,
// never what the document contains.
//
// The distinction matters: font size is typed into the story and travels with
// it (beta readers and exports see it). Line spacing is comfort only — it is
// stored per browser, applied as a CSS variable, and deliberately never
// reaches the html, the server, or anyone else's screen.
//
// `storage` is injectable so tests don't need a real localStorage.
const KEY = "cowriteEditorPrefs"

// Named steps rather than a free number: the control is a stepper, and these
// are the values that actually read differently on screen.
export const LINE_STEPS = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4]
export const DEFAULT_LINE = 1.7 // matches .editor's own line-height

// Paper colour of the writing surface — the same kind of preference as line
// spacing: it changes how the page looks to YOU and never touches the html.
// "theme" is the site's own panel colour (the default, and what every earlier
// draft looked like); light/dark force a plain white or black page for people
// who draft more comfortably against one of them.
export const PAPERS = ["theme", "light", "dark"]
export const DEFAULT_PAPER = "theme"

const cleanPaper = (v) => (PAPERS.includes(v) ? v : DEFAULT_PAPER)

// The typeface the drafting surface is set in — the third view preference,
// alongside line spacing and paper. "theme" means whatever the current theme
// picked (--font-story); the rest are the families this site already loads,
// mirroring fonts.json (test/fonts.test.mjs fails if the two drift apart), so
// choosing one costs no extra download.
export const DOC_FONTS = [
	{ key: "theme", label: "Theme font", stack: "" },
	{ key: "fraunces", label: "Fraunces", stack: '"Fraunces", serif' },
	{ key: "newsreader", label: "Newsreader", stack: '"Newsreader", serif' },
	{ key: "jakarta", label: "Plus Jakarta Sans", stack: '"Plus Jakarta Sans", sans-serif' },
	{ key: "grotesk", label: "Space Grotesk", stack: '"Space Grotesk", sans-serif' },
	{ key: "orbitron", label: "Orbitron", stack: '"Orbitron", sans-serif' },
	{ key: "inconsolata", label: "Inconsolata", stack: '"Inconsolata", ui-monospace, monospace' },
]
export const DEFAULT_FONT = "theme"
export const fontOf = (key) => DOC_FONTS.find((f) => f.key === key) || DOC_FONTS[0]

// The typeface menu shows each face IN that face — a name is a poor preview of
// a letterform. "Theme font" has no stack of its own and inherits, so it
// previews as whatever the theme is already using.
export function fontMenuHtml(selected) {
	return DOC_FONTS.map(
		(f) =>
			`<option value="${f.key}" style="font-family:${f.stack || "inherit"};font-size:1.05em"${
				f.key === selected ? " selected" : ""
			}>${f.label}</option>`,
	).join("")
}
const cleanFont = (v) => (DOC_FONTS.some((f) => f.key === v) ? v : DEFAULT_FONT)

// The comments drawer: whether it's open, and how wide you dragged it. Same
// class of preference as the others — it changes your view of the page and
// never the document. Width is clamped so a drag can't leave the prose column
// unusable or the rail too narrow to hold a comment card.
export const SIDE_MIN = 240
export const SIDE_MAX = 560
export const DEFAULT_SIDE = 300
export const clampSide = (v) => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_SIDE
	return Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, n)))
}

const clampLine = (v) => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_LINE
	return Math.min(LINE_STEPS[LINE_STEPS.length - 1], Math.max(LINE_STEPS[0], n))
}

export function loadPrefs(storage = localStorage) {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null")
		return {
			lineHeight: v && v.lineHeight != null ? clampLine(v.lineHeight) : DEFAULT_LINE,
			paper: cleanPaper(v?.paper),
			font: cleanFont(v?.font),
			sideWidth: clampSide(v?.sideWidth),
			sideOpen: v?.sideOpen !== false,
		}
	} catch (e) {
		return { lineHeight: DEFAULT_LINE, paper: DEFAULT_PAPER, font: DEFAULT_FONT, sideWidth: DEFAULT_SIDE, sideOpen: true }
	}
}

export function savePrefs(prefs, storage = localStorage) {
	const clean = {
		lineHeight: clampLine(prefs?.lineHeight),
		paper: cleanPaper(prefs?.paper),
		font: cleanFont(prefs?.font),
		sideWidth: clampSide(prefs?.sideWidth),
		sideOpen: prefs?.sideOpen !== false,
	}
	try {
		storage.setItem(KEY, JSON.stringify(clean))
	} catch (e) {
		/* private mode — the preference just won't persist */
	}
	return clean
}

// Next/previous step on the ladder, snapping from whatever the current value is.
export function stepLine(current, dir) {
	const now = clampLine(current)
	if (dir > 0) return clampLine(LINE_STEPS.find((s) => s > now + 0.001) ?? now)
	return clampLine([...LINE_STEPS].reverse().find((s) => s < now - 0.001) ?? now)
}
