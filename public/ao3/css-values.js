// What the previewer's editor suggests AFTER the colon: per-property keywords,
// hand-curated for the properties work skins actually use. This is editor
// help, NOT the lint whitelist — AO3 accepts any bare identifier as a value
// (ao3-rules.js `valueStatus`), so a keyword missing here still saves; what
// matters is that nothing offered here is something AO3 refuses. Function
// names come from ao3-rules.js's own lists so the two can't drift.

import { TRANSFORM_FUNCTIONS, FILTER_FUNCTIONS, COLOR_FUNCTIONS, GRADIENT_FUNCTIONS, URL_PROPERTIES, VENDOR_PREFIXES } from "./ao3-rules.js"

export const GLOBALS = ["inherit", "initial", "unset", "revert"]
export const IMPORTANT = "!important"

const BORDER_STYLE = ["none", "hidden", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"]
const WIDTH_KW = ["thin", "medium", "thick"]
const SIZE_KW = ["auto", "max-content", "min-content", "fit-content"]
const FONT_SIZE = ["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "smaller", "larger"]
const FONT_STYLE = ["normal", "italic", "oblique"]
const FONT_WEIGHT = ["normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"]
const FONT_VARIANT = ["normal", "small-caps", "all-small-caps", "petite-caps", "titling-caps", "unicase"]
const FONT_STRETCH = ["normal", "ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"]
const FONT_FAMILY = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]
const LIST_TYPE = ["none", "disc", "circle", "square", "decimal", "decimal-leading-zero", "lower-roman", "upper-roman", "lower-alpha", "upper-alpha", "lower-greek", "lower-latin", "upper-latin"]
const LIST_POS = ["inside", "outside"]
const BG_REPEAT = ["repeat", "repeat-x", "repeat-y", "no-repeat", "space", "round"]
const BG_POS = ["left", "center", "right", "top", "bottom"]
const BG_SIZE = ["auto", "cover", "contain"]
const BG_ATTACH = ["scroll", "fixed", "local"]
const BG_BOX = ["border-box", "padding-box", "content-box"]
const OVERFLOW = ["visible", "hidden", "clip", "scroll", "auto"]
const TIMING = ["ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end"]
const FLEX_ALIGN = ["flex-start", "flex-end", "center", "stretch", "baseline", "start", "end"]
const TEXT_DECO_LINE = ["none", "underline", "overline", "line-through"]
const TEXT_DECO_STYLE = ["solid", "double", "dotted", "dashed", "wavy"]

export const VALUES = {
	display: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "none", "contents", "table", "table-row", "table-cell", "list-item", "flow-root"],
	position: ["static", "relative", "absolute", "fixed", "sticky"],
	float: ["none", "left", "right", "inline-start", "inline-end"],
	clear: ["none", "left", "right", "both", "inline-start", "inline-end"],
	visibility: ["visible", "hidden", "collapse"],
	overflow: OVERFLOW,
	"overflow-x": OVERFLOW,
	"overflow-y": OVERFLOW,
	"overflow-wrap": ["normal", "break-word", "anywhere"],
	"white-space": ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"],
	"word-break": ["normal", "break-all", "keep-all", "break-word"],
	"word-wrap": ["normal", "break-word", "anywhere"],
	hyphens: ["none", "manual", "auto"],
	"text-align": ["left", "right", "center", "justify", "start", "end"],
	"text-align-last": ["auto", "left", "right", "center", "justify", "start", "end"],
	"text-decoration": [...TEXT_DECO_LINE, ...TEXT_DECO_STYLE],
	"text-decoration-line": TEXT_DECO_LINE,
	"text-decoration-style": TEXT_DECO_STYLE,
	"text-transform": ["none", "capitalize", "uppercase", "lowercase", "full-width"],
	"text-indent": ["hanging", "each-line"],
	"text-overflow": ["clip", "ellipsis"],
	"text-shadow": ["none"],
	"vertical-align": ["baseline", "sub", "super", "text-top", "text-bottom", "middle", "top", "bottom"],
	"letter-spacing": ["normal"],
	"word-spacing": ["normal"],
	"line-height": ["normal"],
	font: [...FONT_STYLE, ...FONT_WEIGHT, ...FONT_SIZE, ...FONT_FAMILY, "small-caps", "caption", "icon", "menu", "message-box", "small-caption", "status-bar"],
	"font-family": FONT_FAMILY,
	"font-size": FONT_SIZE,
	"font-style": FONT_STYLE,
	"font-variant": FONT_VARIANT,
	"font-weight": FONT_WEIGHT,
	"font-stretch": FONT_STRETCH,
	"font-smooth": ["auto", "never", "always", "antialiased"],
	color: [],
	"accent-color": ["auto"],
	"color-scheme": ["normal", "light", "dark", "only"],
	opacity: [],
	"list-style": [...LIST_TYPE, ...LIST_POS],
	"list-style-type": LIST_TYPE,
	"list-style-position": LIST_POS,
	"list-style-image": ["none"],
	border: [...BORDER_STYLE, ...WIDTH_KW],
	"border-top": [...BORDER_STYLE, ...WIDTH_KW],
	"border-right": [...BORDER_STYLE, ...WIDTH_KW],
	"border-bottom": [...BORDER_STYLE, ...WIDTH_KW],
	"border-left": [...BORDER_STYLE, ...WIDTH_KW],
	"border-style": BORDER_STYLE,
	"border-width": WIDTH_KW,
	"border-color": ["transparent", "currentcolor"],
	"border-radius": [],
	"border-collapse": ["collapse", "separate"],
	"border-spacing": [],
	"border-image": ["none", "stretch", "repeat", "round", "space", "fill"],
	outline: [...BORDER_STYLE, ...WIDTH_KW, "auto", "invert"],
	"outline-style": [...BORDER_STYLE, "auto"],
	"outline-width": WIDTH_KW,
	"outline-offset": [],
	"box-shadow": ["none", "inset"],
	"box-sizing": ["content-box", "border-box"],
	background: [...BG_REPEAT, ...BG_POS, ...BG_SIZE, ...BG_ATTACH, ...BG_BOX, "none", "transparent", "currentcolor"],
	"background-color": ["transparent", "currentcolor"],
	"background-image": ["none"],
	"background-repeat": BG_REPEAT,
	"background-position": BG_POS,
	"background-size": BG_SIZE,
	"background-attachment": BG_ATTACH,
	"background-clip": [...BG_BOX, "text"],
	"background-origin": BG_BOX,
	"background-blend-mode": ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
	width: SIZE_KW,
	height: SIZE_KW,
	"min-width": SIZE_KW,
	"min-height": SIZE_KW,
	"max-width": [...SIZE_KW, "none"],
	"max-height": [...SIZE_KW, "none"],
	margin: ["auto"],
	"margin-top": ["auto"],
	"margin-right": ["auto"],
	"margin-bottom": ["auto"],
	"margin-left": ["auto"],
	padding: [],
	top: ["auto"],
	right: ["auto"],
	bottom: ["auto"],
	left: ["auto"],
	"z-index": ["auto"],
	"aspect-ratio": ["auto"],
	cursor: ["auto", "default", "none", "pointer", "text", "help", "wait", "progress", "crosshair", "move", "not-allowed", "grab", "grabbing", "zoom-in", "zoom-out"],
	"user-select": ["auto", "none", "text", "all", "contain"],
	resize: ["none", "both", "horizontal", "vertical"],
	appearance: ["none", "auto"],
	direction: ["ltr", "rtl"],
	"unicode-bidi": ["normal", "embed", "isolate", "bidi-override", "isolate-override", "plaintext"],
	"writing-mode": ["horizontal-tb", "vertical-rl", "vertical-lr"],
	"table-layout": ["auto", "fixed"],
	"caption-side": ["top", "bottom"],
	"empty-cells": ["show", "hide"],
	"image-orientation": ["none", "from-image"],
	flex: ["none", "auto", "initial"],
	"flex-direction": ["row", "row-reverse", "column", "column-reverse"],
	"flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
	"flex-grow": [],
	"flex-shrink": [],
	"flex-basis": [...SIZE_KW, "content"],
	"justify-content": [...FLEX_ALIGN, "space-between", "space-around", "space-evenly", "left", "right"],
	"align-items": FLEX_ALIGN,
	"align-content": [...FLEX_ALIGN, "space-between", "space-around", "space-evenly"],
	"align-self": ["auto", ...FLEX_ALIGN],
	order: [],
	"column-count": ["auto"],
	"column-width": ["auto"],
	"column-gap": ["normal"],
	"column-rule": [...BORDER_STYLE, ...WIDTH_KW],
	columns: ["auto"],
	transform: ["none"],
	"transform-origin": ["left", "center", "right", "top", "bottom"],
	transition: [...TIMING, "all", "none"],
	"transition-property": ["all", "none"],
	"transition-timing-function": TIMING,
	"transition-duration": [],
	"transition-delay": [],
	filter: ["none"],
	quotes: ["none", "auto"],
	content: ["none", "normal", "open-quote", "close-quote", "no-open-quote", "no-close-quote"],
	"counter-reset": ["none"],
	"counter-increment": ["none"],
	"page-break-before": ["auto", "always", "avoid", "left", "right"],
	"page-break-after": ["auto", "always", "avoid", "left", "right"],
	"page-break-inside": ["auto", "avoid"],
	"scrollbar-width": ["auto", "thin", "none"],
	"scrollbar-color": ["auto"],
	fill: ["none", "currentcolor"],
	stroke: ["none", "currentcolor"],
	"stroke-width": [],
	widows: [],
	orphans: [],
}

// The properties that take a colour anywhere in their value — those get the
// colour functions, the named colours and `transparent`/`currentcolor`.
export const COLOR_PROPERTIES = [
	"color", "accent-color", "background", "background-color", "border", "border-top", "border-right", "border-bottom", "border-left",
	"border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline", "outline-color",
	"box-shadow", "text-shadow", "text-decoration", "text-decoration-color", "column-rule", "column-rule-color", "fill", "stroke",
	"scrollbar-color", "text-emphasis-color",
]
const GRADIENT_PROPERTIES = ["background", "background-image", "list-style-image", "border-image"]

export const FUNCTIONS = {}
FUNCTIONS.transform = [...TRANSFORM_FUNCTIONS]
FUNCTIONS.filter = [...FILTER_FUNCTIONS]
for (const p of COLOR_PROPERTIES) FUNCTIONS[p] = [...(FUNCTIONS[p] || []), ...COLOR_FUNCTIONS.filter((f) => f !== "color-stop")]
for (const p of GRADIENT_PROPERTIES) FUNCTIONS[p] = [...(FUNCTIONS[p] || []), ...GRADIENT_FUNCTIONS]
for (const p of URL_PROPERTIES) FUNCTIONS[p] = [...(FUNCTIONS[p] || []), "url"]

// The CSS named colours (Level 4), `transparent` and `currentcolor` first.
export const NAMED_COLORS = [
	"transparent", "currentcolor",
	"aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet",
	"brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan",
	"darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
	"darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey",
	"darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
	"forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew",
	"hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue",
	"lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
	"lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
	"linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
	"mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose",
	"moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
	"palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
	"rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna",
	"silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
	"tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
]

const VENDOR_RE = new RegExp("^-(" + VENDOR_PREFIXES.join("|") + ")-(.+)$")
export const unprefix = (prop) => {
	const p = String(prop || "").trim().toLowerCase()
	const m = p.match(VENDOR_RE)
	return m ? m[2] : p
}

/**
 * valuesFor(prop) → [{label, type, kind}] in the order the dropdown shows them:
 * the property's keywords, its functions (kind "function", label "fn("), the
 * named colours on colour properties, then the globals and `!important`.
 * A property the table doesn't know still gets the globals and `!important`.
 */
export function valuesFor(prop) {
	const p = unprefix(prop)
	const seen = new Set()
	const out = []
	const push = (label, kind) => {
		if (seen.has(label)) return
		seen.add(label)
		out.push({ label, kind })
	}
	for (const k of VALUES[p] || []) push(k, "keyword")
	for (const f of FUNCTIONS[p] || []) push(f + "(", "function")
	if (COLOR_PROPERTIES.includes(p)) for (const c of NAMED_COLORS) push(c, "color")
	for (const g of GLOBALS) push(g, "global")
	push(IMPORTANT, "important")
	return out
}
