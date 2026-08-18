// The Cleradin moon: a woodcut-style full moon, drawn from data so the craters
// can be moved, resized or thinned out without redrawing anything by hand.
//
// It is built in four passes, which is roughly how an engraver would do it:
//   1. the disc, with limb darkening so it reads as a sphere and not a coin
//   2. the maria — the big dark seas, irregular blobs, the moon's face
//   3. the craters — rim, floor, and a shadow crescent whose side depends on
//      where the crater sits, so the whole surface is lit from one direction
//   4. the rays — bright splashes thrown out of the two youngest craters
//
// Everything is clipped to the disc, so a crater near the edge is cut off by
// the limb instead of hanging in the sky. Pure: returns a string, no DOM.

// Light comes from the upper left, like the tower's. One constant, so every
// crater's shadow agrees with every other one's.
const LIGHT = { x: -0.55, y: -0.62 }

// The seas. Each is a closed blob in a 0–200 space; they are deliberately
// lopsided — a symmetrical mare reads as a logo, not a moon.
const MARIA = [
	"M 62 52 q 26 -12 44 2 q 18 14 8 32 q -12 20 -38 16 q -26 -4 -30 -22 q -4 -18 16 -28 Z",
	"M 108 46 q 22 -6 30 8 q 8 14 -6 22 q -16 8 -28 -2 q -10 -10 4 -28 Z",
	"M 54 96 q 20 -6 30 8 q 8 16 -8 24 q -20 8 -30 -6 q -8 -14 8 -26 Z",
	"M 96 104 q 30 -10 40 10 q 8 18 -12 26 q -24 8 -34 -8 q -8 -14 6 -28 Z",
	"M 128 78 q 16 -4 20 8 q 4 12 -10 16 q -14 4 -18 -8 q -2 -10 8 -16 Z",
]

// Craters: [x, y, radius]. A handful of big ringed ones and a scatter of small
// pocks — the scatter is what keeps it from looking like a diagram.
const CRATERS = [
	[150, 62, 15],
	[142, 128, 11],
	[46, 132, 9],
	[74, 150, 12],
	[118, 158, 8],
	[38, 74, 7],
	[92, 34, 6],
	[164, 96, 6],
	[60, 40, 4.5],
	[110, 74, 4],
	[86, 122, 3.6],
	[130, 40, 3.4],
	[54, 112, 3],
	[100, 146, 3],
	[152, 142, 3.4],
	[70, 88, 2.8],
	[126, 110, 2.6],
	[36, 100, 2.6],
	[168, 118, 2.4],
	[104, 58, 2.4],
]

// The two ray craters. Rays are thin tapered slivers, not lines: wide at the
// crater, gone by the time they reach the limb.
const RAY_SOURCES = [
	{ x: 74, y: 150, r: 12, count: 13, reach: 86 },
	{ x: 150, y: 62, r: 15, count: 11, reach: 70 },
]

const round = (n) => Number(n.toFixed(1))

// A crater is drawn the way an engraver would cut one: a dark floor, a thin
// ring for the wall, and a bright arc on the LIT side only — the arc is a
// dashed circle rotated to face the light, which is why every crater on the
// disc catches the light from the same direction without any of them being
// hand-placed. Small ones skip the arc; below a few pixels it would be noise.
const LIGHT_ANGLE = (Math.atan2(LIGHT.y, LIGHT.x) * 180) / Math.PI

function craterHtml([x, y, r]) {
	const c = 2 * Math.PI * r
	const arc = c * 0.4 // how much of the wall is lit
	const spin = LIGHT_ANGLE - 72 // start the dash before the light, end after
	const floor = `<circle cx="${x}" cy="${y}" r="${round(r)}" class="cm-floor" />`
	const wall = `<circle cx="${x}" cy="${y}" r="${round(r)}" class="cm-rim" />`
	if (r < 3.4) return floor + wall
	const lit =
		`<circle cx="${x}" cy="${y}" r="${round(r * 0.94)}" class="cm-lit"` +
		` stroke-dasharray="${round(arc)} ${round(c)}" transform="rotate(${round(spin)} ${x} ${y})" />`
	// a shallow bowl: the floor pulls away from the lit wall
	const bowl = `<circle cx="${round(x - LIGHT.x * r * 0.22)}" cy="${round(y - LIGHT.y * r * 0.22)}" r="${round(
		r * 0.6,
	)}" class="cm-bowl" />`
	return floor + bowl + lit + wall
}

function raysHtml(s) {
	const out = []
	for (let i = 0; i < s.count; i++) {
		// an irregular fan: the step is deliberately not 360/count
		const a = (i * 360) / s.count + (i % 3) * 7
		const rad = (a * Math.PI) / 180
		const len = s.reach * (0.4 + ((i * 37) % 45) / 100)
		const w = s.r * (0.34 - (i % 4) * 0.05)
		const cos = Math.cos(rad)
		const sin = Math.sin(rad)
		const x0 = s.x + cos * s.r * 0.9
		const y0 = s.y + sin * s.r * 0.9
		const x1 = s.x + cos * (s.r + len)
		const y1 = s.y + sin * (s.r + len)
		const nx = -sin * w
		const ny = cos * w
		out.push(
			`<path d="M ${round(x0 + nx)} ${round(y0 + ny)} L ${round(x1)} ${round(y1)} L ${round(x0 - nx)} ${round(
				y0 - ny,
			)} Z" class="cm-ray" />`,
		)
	}
	return out.join("")
}

// Surface tooth: a scatter of tiny pocks, deterministic (a hash of the index,
// never Math.random) so the same moon is drawn every time.
function speckleHtml(n = 90, size = 200) {
	const out = []
	for (let i = 1; i <= n; i++) {
		const a = (i * 137.508 * Math.PI) / 180 // golden angle — an even scatter
		const rad = (size / 2 - 8) * Math.sqrt((i % 61) / 61)
		const x = round(size / 2 + Math.cos(a) * rad)
		const y = round(size / 2 + Math.sin(a) * rad)
		out.push(`<circle cx="${x}" cy="${y}" r="${round(0.5 + (i % 5) * 0.22)}" />`)
	}
	return out.join("")
}

export function moonSvg({ size = 200 } = {}) {
	const c = size / 2
	return `<svg class="cm-moon-svg" viewBox="0 0 ${size} ${size}" fill="none"
	xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
	<defs>
		<clipPath id="cm-disc"><circle cx="${c}" cy="${c}" r="${c - 2}" /></clipPath>
		<!-- limb darkening: bright a little up-left of centre, falling off to the
		     edge, which is the whole difference between a sphere and a disc -->
		<radialGradient id="cm-face" cx="0.4" cy="0.36" r="0.72">
			<stop offset="0" stop-color="var(--cm-hi)" />
			<stop offset="0.62" stop-color="var(--cm-mid)" />
			<stop offset="1" stop-color="var(--cm-low)" />
		</radialGradient>
	</defs>
	<g class="cm-glowring"><circle cx="${c}" cy="${c}" r="${c - 2}" /></g>
	<g clip-path="url(#cm-disc)">
		<circle cx="${c}" cy="${c}" r="${c - 2}" fill="url(#cm-face)" />
		<g class="cm-maria">${MARIA.map((d) => `<path d="${d}" />`).join("")}</g>
		<g class="cm-rays">${RAY_SOURCES.map(raysHtml).join("")}</g>
		<g class="cm-speckle">${speckleHtml(90, size)}</g>
		<g class="cm-craters">${CRATERS.map(craterHtml).join("")}</g>
		<!-- the terminator's ghost: the faintest darkening down the lower right -->
		<circle cx="${c * 1.42}" cy="${c * 1.5}" r="${c}" class="cm-shade" />
	</g>
	<circle cx="${c}" cy="${c}" r="${c - 2}" class="cm-edge" />
</svg>`
}
