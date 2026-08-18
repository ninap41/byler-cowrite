// The Cleradin tower: a storybook watchtower, drawn as SVG from numbers rather
// than hand-plotted, so every part of it stays tweakable.
//
// The theme's name is a cleric and a paladin, and the tower is asked to carry
// both: the CLERIC in pale limestone, lancet windows and a rose light over the
// door — sanctuary architecture, luminous rather than gothic; the PALADIN in
// the straight taper, the ringed lookout on its corbels and the pennant that
// never comes down. Nothing gritty, nothing heavy.
//
// Structure (each is its own <g id="…"> in the output, in back-to-front order):
//   #cl-shaft    the cylindrical body: taper, masonry courses, weathering
//   #cl-spiral   the stair band winding up the outside — the defining feature
//   #cl-openings the arched windows and the rose light
//   #cl-door     the arched wooden door in its stone frame
//   #cl-moss     small green patches in the joints
//   #cl-balcony  the ringed lookout, its corbels and its arcaded railing
//   #cl-roof     the steep teal cone and its shingle courses
//   #cl-dormer   the arched dormer set into the roof
//   #cl-spire    the finial and the windswept pennant
//
// The builder is PURE — it returns a string and touches no DOM — so the
// background can inject it, a page can inline it, and a test can read it.

// One coordinate system for the whole drawing. Everything below is expressed in
// these numbers, so changing the proportions is changing this object.
export const TOWER = {
	w: 240,
	h: 900,
	cx: 120, // the tower's axis; the drawing is symmetric about it
	baseY: 812, // where the plinth meets the ground
	shaftBottomY: 770,
	shaftTopY: 300, // where the shaft ends and the balcony begins
	rBottom: 62, // half-width at the foot
	rTop: 46, // half-width under the balcony — the taper
	curve: 16, // how far a course bows down at the centre (the cylinder read)
	courseH: 26, // masonry course height
	turns: 6, // full wraps of the spiral stair
	roofTopY: 74,
	spireTopY: 8,
}

// Half-width of the shaft at a given y — one straight taper, which is what
// keeps the silhouette noble instead of bulbous.
export function radiusAt(y, t = TOWER) {
	const span = t.shaftBottomY - t.shaftTopY
	// k runs 0 at the foot to 1 under the balcony, so the taper narrows upward
	const k = Math.min(1, Math.max(0, (t.shaftBottomY - y) / span))
	return t.rBottom - (t.rBottom - t.rTop) * k
}

// A horizontal line across the shaft, bowed downward — the near side of a
// circle seen from slightly above. Every course, ledge and ring uses it, which
// is why the tower reads as a cylinder and not as a plank.
export function bow(y, r, cx = TOWER.cx, dip = TOWER.curve) {
	return `M ${cx - r} ${y} Q ${cx} ${y + dip} ${cx + r} ${y}`
}

// ---- #cl-shaft --------------------------------------------------------------
// Masonry courses with staggered joints. The joints are drawn per course from
// the course's own width, so they follow the taper without being re-plotted.
function masonry(t) {
	const rows = []
	let i = 0
	for (let y = t.shaftBottomY - t.courseH; y > t.shaftTopY; y -= t.courseH, i++) {
		const r = radiusAt(y, t)
		rows.push(`<path d="${bow(y, r, t.cx)}" class="cl-joint" />`)
		// four blocks a course, offset every other row so nothing lines up
		const n = 4
		for (let j = 0; j < n; j++) {
			const f = (j + (i % 2 ? 0.5 : 0)) / n
			const x = t.cx - r + f * r * 2
			if (x <= t.cx - r + 2 || x >= t.cx + r - 2) continue
			const dip = t.curve * (1 - Math.abs((x - t.cx) / r) ** 2)
			rows.push(`<path d="M ${x.toFixed(1)} ${(y + dip).toFixed(1)} v ${t.courseH}" class="cl-joint cl-joint-v" />`)
		}
	}
	return rows.join("\n\t\t")
}

function shaft(t) {
	const rb = t.rBottom
	const rt = t.rTop
	return `<g id="cl-shaft">
		<!-- plinth: a wider footing so the tower stands rather than floats -->
		<path d="M ${t.cx - rb - 10} ${t.baseY} L ${t.cx - rb - 6} ${t.shaftBottomY} L ${t.cx + rb + 6} ${t.shaftBottomY}
			L ${t.cx + rb + 10} ${t.baseY} Z" fill="url(#cl-stone)" stroke="var(--cl-line)" stroke-width="1.4" />
		<path d="${bow(t.baseY, rb + 10, t.cx, t.curve + 4)}" fill="none" stroke="var(--cl-line)" stroke-width="1.4" />
		<!-- the body itself -->
		<path d="M ${t.cx - rb} ${t.shaftBottomY} L ${t.cx - rt} ${t.shaftTopY} L ${t.cx + rt} ${t.shaftTopY}
			L ${t.cx + rb} ${t.shaftBottomY} Z" fill="url(#cl-stone)" stroke="var(--cl-line)" stroke-width="1.6" />
		<!-- form shading: one soft band down the right, one lit edge on the left -->
		<path d="M ${t.cx + rt - 22} ${t.shaftTopY} L ${t.cx + rt} ${t.shaftTopY} L ${t.cx + rb} ${t.shaftBottomY}
			L ${t.cx + rb - 26} ${t.shaftBottomY} Z" fill="url(#cl-shade)" />
		<path d="M ${t.cx - rt} ${t.shaftTopY} L ${t.cx - rt + 12} ${t.shaftTopY} L ${t.cx - rb + 14} ${t.shaftBottomY}
			L ${t.cx - rb} ${t.shaftBottomY} Z" fill="var(--cl-lit)" opacity="0.5" />
		<g class="cl-courses">
		${masonry(t)}
		</g>
	</g>`
}

// ---- #cl-spiral -------------------------------------------------------------
// The stair band, and the point of the whole drawing. Each turn is ONE pass
// around the tower: the front half is a solid ledge (bowed down, lit on top),
// the back half only shows as a faint line rising behind the body. Successive
// turns start where the last one ended, so the eye follows a real helix
// upwards rather than a stack of rings.
function spiral(t) {
	const parts = []
	const top = t.shaftTopY + 26
	const bottom = t.shaftBottomY - 40
	const rise = (bottom - top) / t.turns
	for (let i = 0; i < t.turns; i++) {
		const yStart = bottom - i * rise // left side of this turn
		const yEnd = yStart - rise / 2 // right side, half a turn higher
		const rL = radiusAt(yStart, t)
		const rR = radiusAt(yEnd, t)
		const th = 13 - i * 0.6 // the band narrows with the taper
		// the visible front face
		parts.push(
			`<path d="M ${(t.cx - rL).toFixed(1)} ${yStart.toFixed(1)}
				Q ${t.cx} ${(yStart + t.curve + 8).toFixed(1)} ${(t.cx + rR).toFixed(1)} ${yEnd.toFixed(1)}
				l 0 ${th} Q ${t.cx} ${(yStart + t.curve + 8 + th).toFixed(1)} ${(t.cx - rL).toFixed(1)} ${(yStart + th).toFixed(1)} Z"
				fill="url(#cl-ledge)" stroke="var(--cl-line)" stroke-width="1.2" stroke-linejoin="round" />`,
		)
		// treads: short ticks across the band, so it reads as a stair to climb
		// and not as a ribbon tied round the tower
		const steps = 7
		for (let k = 1; k < steps; k++) {
			const f = k / steps
			const x = t.cx - rL + f * (rL + rR)
			const y = yStart - (yStart - yEnd) * f + (t.curve + 8) * 2 * f * (1 - f)
			parts.push(`<path d="M ${x.toFixed(1)} ${y.toFixed(1)} v ${th.toFixed(1)}" class="cl-tread" />`)
		}
		// the far half, seen through the tower as a hint rather than a line
		const yBack = yEnd - rise / 2
		parts.push(
			`<path d="M ${(t.cx + rR).toFixed(1)} ${yEnd.toFixed(1)}
				Q ${t.cx} ${(yEnd - t.curve - 6).toFixed(1)} ${(t.cx - radiusAt(yBack, t)).toFixed(1)} ${yBack.toFixed(1)}"
				fill="none" stroke="var(--cl-line)" stroke-width="1" opacity="0.28" stroke-dasharray="5 6" />`,
		)
	}
	return `<g id="cl-spiral">\n\t\t${parts.join("\n\t\t")}\n\t</g>`
}

// ---- #cl-openings -----------------------------------------------------------
// A lancet — the tall round-headed window sacred buildings use, reused at every
// size. `w` is its full width, `h` the straight part under the arch.
export function lancet(x, y, w, h, cls = "cl-glass") {
	const r = w / 2
	return `<path d="M ${x - r} ${y} v ${-h} a ${r} ${r} 0 0 1 ${w} 0 v ${h} Z" class="${cls}" />`
}

function openings(t) {
	// three windows climbing with the stair, so the two features agree
	const wins = [
		{ y: t.shaftBottomY - 150, x: t.cx - 20, w: 17, h: 26 },
		{ y: t.shaftBottomY - 268, x: t.cx + 18, w: 16, h: 24 },
		{ y: t.shaftBottomY - 386, x: t.cx - 14, w: 15, h: 23 },
	]
	const frames = wins
		.map(
			(w) =>
				`<g class="cl-window">${lancet(w.x, w.y + 3, w.w + 8, w.h + 4, "cl-frame")}${lancet(w.x, w.y, w.w, w.h)}</g>`,
		)
		.join("\n\t\t")
	// the rose light over the door: a circle quartered into petals. The one
	// piece of pure ornament, kept small — sanctity, not spectacle.
	const rx = t.cx
	const ry = t.shaftBottomY - 116
	const rr = 17
	const petals = [0, 90, 180, 270]
		.map(
			(a) =>
				`<ellipse cx="${rx}" cy="${ry - rr * 0.52}" rx="${rr * 0.3}" ry="${rr * 0.46}"
					class="cl-petal" transform="rotate(${a} ${rx} ${ry})" />`,
		)
		.join("")
	return `<g id="cl-openings">
		${frames}
		<g class="cl-rose">
			<circle cx="${rx}" cy="${ry}" r="${rr + 5}" class="cl-frame" />
			<circle cx="${rx}" cy="${ry}" r="${rr}" class="cl-glass" />
			${petals}
			<circle cx="${rx}" cy="${ry}" r="${rr * 0.22}" class="cl-frame" />
		</g>
	</g>`
}

// ---- #cl-door ---------------------------------------------------------------
function door(t) {
	const y = t.shaftBottomY
	const w = 40
	const h = 34
	return `<g id="cl-door">
		<!-- stone surround, then the boards, then two iron bands -->
		${lancet(t.cx, y, w + 16, h + 6, "cl-frame")}
		${lancet(t.cx, y, w, h, "cl-wood")}
		<path d="M ${t.cx - w / 2 + 3} ${y - h - 10} h ${w - 6}" class="cl-iron" />
		<path d="M ${t.cx - w / 2 + 1} ${y - 12} h ${w - 2}" class="cl-iron" />
		<circle cx="${t.cx + 11}" cy="${y - 22}" r="2.6" class="cl-iron-dot" />
		<!-- three steps, each bowed like everything else that circles the tower -->
		<path d="${bow(y + 4, w * 0.8, t.cx, 4)}" class="cl-step" />
		<path d="${bow(y + 12, w * 0.95, t.cx, 5)}" class="cl-step" />
		<path d="${bow(y + 20, w * 1.1, t.cx, 6)}" class="cl-step" />
	</g>`
}

// ---- #cl-moss ---------------------------------------------------------------
// Weathering, in small doses: moss gathers where water sits — the plinth, the
// undersides of the ledges, one shaded joint.
function moss(t) {
	// each patch is placed as a fraction of the shaft's own width at that
	// height, so nothing ever floats off the stone as the taper changes
	const at = (y, f, rx, ry) => {
		const r = radiusAt(y, t)
		return [t.cx + f * (r - rx - 4), y, rx, ry]
	}
	const blobs = [
		at(t.shaftBottomY - 20, -0.72, 16, 6),
		at(t.shaftBottomY - 54, 0.66, 12, 5),
		at(t.shaftBottomY - 196, -0.5, 11, 4),
		at(t.shaftBottomY - 330, 0.46, 10, 4),
		at(t.shaftBottomY - 6, 0.2, 14, 5),
	]
	return `<g id="cl-moss">${blobs
		.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" class="cl-moss" />`)
		.join("")}</g>`
}

// ---- #cl-balcony ------------------------------------------------------------
// The ringed lookout: corbels underneath, a floor ring, and an arcaded railing
// of little lancets — the paladin's half of the building, but arcaded rather
// than crenellated, so it guards without glowering.
function balcony(t) {
	const y = t.shaftTopY
	const r = t.rTop + 24
	const corbels = []
	for (let i = -3; i <= 3; i++) {
		const x = t.cx + (i / 3.4) * (t.rTop + 6)
		const dip = t.curve * (1 - ((x - t.cx) / (t.rTop + 6)) ** 2)
		corbels.push(`<path d="M ${x.toFixed(1)} ${(y + 20 + dip).toFixed(1)} q 7 -4 7 -18 q -7 6 -14 6 q 7 4 7 12 Z" class="cl-corbel" />`)
	}
	const rail = []
	const n = 9
	for (let i = 0; i < n; i++) {
		const f = (i + 0.5) / n
		const x = t.cx - r + f * r * 2
		const dip = t.curve * (1 - ((x - t.cx) / r) ** 2)
		rail.push(lancet(x, y - 4 + dip, 13, 15, "cl-arch"))
	}
	return `<g id="cl-balcony">
		${corbels.join("\n\t\t")}
		<path d="${bow(y + 16, r, t.cx)} L ${t.cx + r} ${y + 4} Q ${t.cx} ${y + 4 + t.curve} ${t.cx - r} ${y + 4} Z"
			fill="url(#cl-stone)" stroke="var(--cl-line)" stroke-width="1.5" />
		<g class="cl-rail">${rail.join("")}</g>
		<path d="${bow(y - 30, r, t.cx)}" class="cl-caprail" />
	</g>`
}

// ---- #cl-roof ---------------------------------------------------------------
// The cone. Steep enough to be the tower's signature from across a page, in
// teal shingles laid in bowed courses that narrow as they climb.
function roof(t) {
	const baseY = t.shaftTopY - 22
	const r = t.rTop + 34
	const courses = []
	const rows = 9
	for (let i = 1; i <= rows; i++) {
		const f = i / (rows + 1)
		const y = baseY - (baseY - t.roofTopY) * f
		courses.push(`<path d="${bow(y, r * (1 - f) + 4, t.cx, 7 * (1 - f))}" class="cl-shingle" />`)
	}
	return `<g id="cl-roof">
		<path d="M ${t.cx} ${t.roofTopY} L ${t.cx + r} ${baseY} Q ${t.cx} ${baseY + t.curve + 4} ${t.cx - r} ${baseY} Z"
			fill="url(#cl-roofpaint)" stroke="var(--cl-roof-line)" stroke-width="1.6" stroke-linejoin="round" />
		<!-- the lit edge, so the cone turns -->
		<path d="M ${t.cx} ${t.roofTopY} L ${t.cx - r * 0.55} ${baseY} L ${t.cx - r * 0.18} ${baseY} Z"
			fill="var(--cl-roof-lit)" opacity="0.45" />
		<g class="cl-shingles">${courses.join("")}</g>
		<!-- eaves -->
		<path d="${bow(baseY, r + 6, t.cx, t.curve + 5)}" class="cl-eave" />
	</g>`
}

// ---- #cl-dormer -------------------------------------------------------------
function dormer(t) {
	const y = t.shaftTopY - 96
	return `<g id="cl-dormer">
		<path d="M ${t.cx - 20} ${y} L ${t.cx} ${y - 44} L ${t.cx + 20} ${y} Z"
			fill="url(#cl-roofpaint)" stroke="var(--cl-roof-line)" stroke-width="1.4" stroke-linejoin="round" />
		${lancet(t.cx, y - 4, 22, 14, "cl-frame")}
		${lancet(t.cx, y - 6, 15, 11, "cl-glass-lit")}
	</g>`
}

// ---- #cl-spire --------------------------------------------------------------
// Finial, mast, pennant. The flag is two curves — one gust, no flapping — and
// the CSS gives it the smallest possible sway.
function spire(t) {
	const y = t.roofTopY
	const mastTop = t.spireTopY
	return `<g id="cl-spire">
		<path d="M ${t.cx} ${y + 6} L ${t.cx} ${mastTop}" class="cl-mast" />
		<circle cx="${t.cx}" cy="${y - 2}" r="4.5" class="cl-finial" />
		<circle cx="${t.cx}" cy="${mastTop + 2}" r="3" class="cl-finial" />
		<g class="cl-flag">
			<path d="M ${t.cx + 2} ${mastTop + 6} q 26 4 42 -4 q -12 12 -4 22 q -20 6 -38 2 Z" class="cl-pennant" />
		</g>
	</g>`
}

// The whole thing. `id` prefixes nothing — the groups are named once and the
// SVG is meant to appear once per page, as a centrepiece.
export function towerSvg(t = TOWER) {
	return `<svg class="cl-tower-svg" viewBox="0 0 ${t.w} ${t.h}" fill="none"
	xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
	<defs>
		<!-- pale limestone, lit from the left; the shade band is separate so the
		     cylinder can be shaded without a second fill on every shape -->
		<linearGradient id="cl-stone" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="var(--cl-stone-lit)" />
			<stop offset="0.45" stop-color="var(--cl-stone)" />
			<stop offset="1" stop-color="var(--cl-stone-dark)" />
		</linearGradient>
		<linearGradient id="cl-shade" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="var(--cl-shade)" stop-opacity="0" />
			<stop offset="1" stop-color="var(--cl-shade)" stop-opacity="0.55" />
		</linearGradient>
		<linearGradient id="cl-ledge" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="var(--cl-stone-lit)" />
			<stop offset="1" stop-color="var(--cl-stone-dark)" />
		</linearGradient>
		<linearGradient id="cl-roofpaint" x1="0" y1="0" x2="1" y2="0.3">
			<stop offset="0" stop-color="var(--cl-roof-lit)" />
			<stop offset="0.5" stop-color="var(--cl-roof)" />
			<stop offset="1" stop-color="var(--cl-roof-dark)" />
		</linearGradient>
	</defs>
	${shaft(t)}
	${spiral(t)}
	${openings(t)}
	${door(t)}
	${moss(t)}
	${balcony(t)}
	${roof(t)}
	${dormer(t)}
	${spire(t)}
</svg>`
}
