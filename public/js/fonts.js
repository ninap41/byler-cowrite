// The font registry — ONE list, three readers: the theme menu's Font row
// (chrome.js/theme.js), the solo editor's typeface menu (doc-prefs.js) and
// test/fonts.test.mjs, which pins it against fonts.json and base.css.
// Pure data, no DOM at top level: theme.js is imported by the server too.
//
// LOADED_FONTS are the families every page already downloads (fonts.json's
// `families` + `extraFamilies`), so choosing one costs nothing.
// SYSTEM_FONTS are common local faces — nothing is downloaded, and a face a
// machine doesn't have falls through its stack to the generic family.
export const LOADED_FONTS = [
	{ key: "fraunces", label: "Fraunces", stack: '"Fraunces", serif' },
	{ key: "newsreader", label: "Newsreader", stack: '"Newsreader", serif' },
	{ key: "jakarta", label: "Plus Jakarta Sans", stack: '"Plus Jakarta Sans", sans-serif' },
	{ key: "grotesk", label: "Space Grotesk", stack: '"Space Grotesk", sans-serif' },
	{ key: "orbitron", label: "Orbitron", stack: '"Orbitron", sans-serif' },
	{ key: "inconsolata", label: "Inconsolata", stack: '"Inconsolata", ui-monospace, monospace' },
	// The one face here that no theme uses — loaded for the menus alone
	// (fonts.json's `extraFamilies`), because a pixel font is a drafting mood,
	// not a site-wide voice.
	{ key: "tiny5", label: "Tiny5", stack: '"Tiny5", system-ui, sans-serif' },
]

export const SYSTEM_FONTS = [
	{ key: "georgia", label: "Georgia", stack: "Georgia, serif" },
	{ key: "palatino", label: "Palatino", stack: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
	{ key: "times", label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
	{ key: "garamond", label: "Garamond", stack: 'Garamond, "EB Garamond", serif' },
	{ key: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
	{ key: "helvetica", label: "Helvetica / Arial", stack: "Helvetica, Arial, sans-serif" },
	{ key: "trebuchet", label: "Trebuchet MS", stack: '"Trebuchet MS", sans-serif' },
	{ key: "gillsans", label: "Gill Sans", stack: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
	{ key: "courier", label: "Courier New", stack: '"Courier New", Courier, monospace' },
	{ key: "system", label: "System UI", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
]

// What the theme menu offers as a site-wide override of the theme's body +
// story faces (display and mono stay the theme's — a theme keeps its voice).
export const SITE_FONTS = [...LOADED_FONTS, ...SYSTEM_FONTS]
export const fontByKey = (key, list = SITE_FONTS) => list.find((f) => f.key === key) || null
