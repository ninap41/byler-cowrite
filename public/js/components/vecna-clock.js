// Vecna's clock, as the thing it actually is in the show: a grandfather clock
// standing in a room it has no business being in.
//
// Built the same way as the Cleradin tower — from numbers, in labelled groups,
// pure (a string, no DOM) — so the case can be re-proportioned without anyone
// re-plotting a path:
//   #vc-case     the long case: plinth, waist, hood, cornice
//   #vc-glass    the waist door, and the pendulum swinging behind it
//   #vc-dial     the face: chapter ring, roman numerals, hands
//   #vc-vines    the Upside Down getting in at the joints
//
// The pendulum is the only moving part and it is deliberately a CSS animation
// on one group (`#vc-pend`), hinged at its pivot: a clock that has stopped is
// a prop, and this one has not stopped — it is counting down to something.

export const CLOCK = {
	w: 320,
	h: 900,
	cx: 160,
	hoodTopY: 40, // under the cornice's finials
	hoodBottomY: 300,
	waistBottomY: 720,
	baseBottomY: 858,
	hoodHalf: 118, // half-width of the hood
	waistHalf: 86,
	baseHalf: 112,
	dialY: 176, // centre of the face
	dialR: 82,
	pivotY: 330, // where the pendulum hangs from
	bobY: 612, // high enough that the bob swings clear of the door's bottom rail
	bobR: 40,
}

const r1 = (n) => Number(n.toFixed(1))

// ---- #vc-case ---------------------------------------------------------------
// Four stacked boxes, each narrower than the one below it, with a moulding line
// where they meet. That stepping is the whole silhouette of a long-case clock.
function caseHtml(c) {
	const box = (y0, y1, half, cls) =>
		`<rect x="${r1(c.cx - half)}" y="${y0}" width="${r1(half * 2)}" height="${r1(y1 - y0)}" class="${cls}" />`
	const moulding = (y, half, h = 14) =>
		`<rect x="${r1(c.cx - half - 8)}" y="${y}" width="${r1((half + 8) * 2)}" height="${h}" rx="3" class="vc-mould" />`
	return `<g id="vc-case">
		<!-- cornice: a broken pediment with three finials, which is what makes a
		     clock look like a small cathedral rather than a cupboard -->
		<path d="M ${c.cx - c.hoodHalf - 10} ${c.hoodTopY + 26}
			q ${c.hoodHalf * 0.55} -34 ${c.hoodHalf - 8} -6
			M ${c.cx + c.hoodHalf + 10} ${c.hoodTopY + 26}
			q ${-c.hoodHalf * 0.55} -34 ${-(c.hoodHalf - 8)} -6" class="vc-pediment" />
		<circle cx="${c.cx}" cy="${c.hoodTopY - 6}" r="9" class="vc-finial" />
		<circle cx="${c.cx - c.hoodHalf - 10}" cy="${c.hoodTopY + 22}" r="6" class="vc-finial" />
		<circle cx="${c.cx + c.hoodHalf + 10}" cy="${c.hoodTopY + 22}" r="6" class="vc-finial" />
		${box(c.hoodTopY + 26, c.hoodBottomY, c.hoodHalf, "vc-wood")}
		${moulding(c.hoodBottomY - 12, c.hoodHalf)}
		${box(c.hoodBottomY, c.waistBottomY, c.waistHalf, "vc-wood")}
		${moulding(c.waistBottomY - 12, c.waistHalf)}
		${box(c.waistBottomY, c.baseBottomY, c.baseHalf, "vc-wood")}
		${moulding(c.baseBottomY - 20, c.baseHalf, 20)}
		<!-- the lit left edge; the case is otherwise a silhouette -->
		<rect x="${r1(c.cx - c.hoodHalf)}" y="${c.hoodTopY + 26}" width="7" height="${r1(c.hoodBottomY - c.hoodTopY - 26)}" class="vc-edge" />
		<rect x="${r1(c.cx - c.waistHalf)}" y="${c.hoodBottomY}" width="7" height="${r1(c.waistBottomY - c.hoodBottomY)}" class="vc-edge" />
	</g>`
}

// ---- #vc-glass --------------------------------------------------------------
// The waist door, and what is behind it. The pendulum is drawn INSIDE the door
// opening and clipped to it, so the bob passes out of sight at the extremes the
// way it does behind a real case.
function glassHtml(c) {
	const x = c.cx - c.waistHalf + 16
	const y = c.hoodBottomY + 40
	const w = (c.waistHalf - 16) * 2
	const h = c.waistBottomY - y - 40
	return `<g id="vc-glass">
		<clipPath id="vc-door"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" /></clipPath>
		<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="vc-pane" />
		<g clip-path="url(#vc-door)">
			<g id="vc-pend">
				<line x1="${c.cx}" y1="${c.pivotY}" x2="${c.cx}" y2="${c.bobY}" class="vc-rod" />
				<circle cx="${c.cx}" cy="${c.bobY}" r="${c.bobR}" class="vc-bob" />
				<circle cx="${c.cx}" cy="${c.bobY}" r="${r1(c.bobR * 0.62)}" class="vc-bob-in" />
			</g>
		</g>
		<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="vc-frame" />
	</g>`
}

// ---- #vc-dial ---------------------------------------------------------------
// The face: chapter ring, twelve numerals, and hands stopped where they matter.
function dialHtml(c) {
	const nums = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
	const marks = nums
		.map((n, i) => {
			const a = ((i * 30 - 90) * Math.PI) / 180
			const rr = c.dialR - 20
			return `<text x="${r1(c.cx + Math.cos(a) * rr)}" y="${r1(c.dialY + Math.sin(a) * rr + 4)}" class="vc-num">${n}</text>`
		})
		.join("")
	const ticks = Array.from({ length: 60 }, (_, i) => {
		const a = ((i * 6 - 90) * Math.PI) / 180
		const r0 = c.dialR - 6
		const r2 = c.dialR - (i % 5 ? 3 : 0)
		return `<line x1="${r1(c.cx + Math.cos(a) * r0)}" y1="${r1(c.dialY + Math.sin(a) * r0)}"
			x2="${r1(c.cx + Math.cos(a) * r2)}" y2="${r1(c.dialY + Math.sin(a) * r2)}" class="vc-tick" />`
	}).join("")
	// four minutes past four: not a symmetric pose, so the face reads as a
	// moment rather than a logo
	const hand = (angle, len, cls) => {
		const a = ((angle - 90) * Math.PI) / 180
		return `<line x1="${c.cx}" y1="${c.dialY}" x2="${r1(c.cx + Math.cos(a) * len)}" y2="${r1(
			c.dialY + Math.sin(a) * len,
		)}" class="${cls}" />`
	}
	return `<g id="vc-dial">
		<circle cx="${c.cx}" cy="${c.dialY}" r="${c.dialR}" class="vc-face" />
		<circle cx="${c.cx}" cy="${c.dialY}" r="${c.dialR}" class="vc-chapter" />
		${ticks}
		${marks}
		${hand(122, c.dialR - 34, "vc-hour")}
		${hand(24, c.dialR - 18, "vc-min")}
		<circle cx="${c.cx}" cy="${c.dialY}" r="5" class="vc-cap" />
	</g>`
}

// ---- #vc-vines --------------------------------------------------------------
// The other side getting in: tendrils along the mouldings and up one flank.
// Sparse on purpose — the horror is that the clock is otherwise ordinary.
function vinesHtml(c) {
	return `<g id="vc-vines">
		<path d="M ${c.cx - c.hoodHalf - 6} ${c.hoodBottomY - 4}
			q -26 30 -8 62 q 18 30 -6 58 q -20 24 2 52" class="vc-vine" />
		<path d="M ${c.cx + c.waistHalf} ${c.waistBottomY - 40}
			q 30 -34 12 -74 q -16 -36 10 -66" class="vc-vine" />
		<path d="M ${c.cx + c.hoodHalf - 10} ${c.hoodTopY + 40} q 22 26 6 54" class="vc-vine" />
		<path d="M ${c.cx - c.baseHalf} ${c.baseBottomY - 26} q 40 -18 84 -4" class="vc-vine vc-vine-thin" />
	</g>`
}

export function clockSvg(c = CLOCK) {
	return `<svg class="vc-clock-svg" viewBox="0 0 ${c.w} ${c.h}" fill="none"
	xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
	<defs>
		<linearGradient id="vc-grain" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0" stop-color="var(--vc-wood-lit)" />
			<stop offset="0.42" stop-color="var(--vc-wood)" />
			<stop offset="1" stop-color="var(--vc-wood-dark)" />
		</linearGradient>
		<radialGradient id="vc-facepaint" cx="0.42" cy="0.36" r="0.8">
			<stop offset="0" stop-color="var(--vc-face-lit)" />
			<stop offset="1" stop-color="var(--vc-face)" />
		</radialGradient>
	</defs>
	${caseHtml(c)}
	${glassHtml(c)}
	${dialHtml(c)}
	${vinesHtml(c)}
</svg>`
}
