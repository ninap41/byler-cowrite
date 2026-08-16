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

const clampLine = (v) => {
	const n = Number(v)
	if (!Number.isFinite(n)) return DEFAULT_LINE
	return Math.min(LINE_STEPS[LINE_STEPS.length - 1], Math.max(LINE_STEPS[0], n))
}

export function loadPrefs(storage = localStorage) {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null")
		return { lineHeight: v && v.lineHeight != null ? clampLine(v.lineHeight) : DEFAULT_LINE }
	} catch (e) {
		return { lineHeight: DEFAULT_LINE }
	}
}

export function savePrefs(prefs, storage = localStorage) {
	const clean = { lineHeight: clampLine(prefs?.lineHeight) }
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
