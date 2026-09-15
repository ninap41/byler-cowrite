// Instant, theme-aware tooltips. One floating .tip-pop element serves the
// whole page; its colors ride the theme CSS vars (--panel/--ink/--panel-brd)
// so every theme restyles it for free — same glass-panel language as the
// theme menu and toasts. Triggers: any element with data-tip, plus the badge
// selectors. A native title attribute on a trigger is migrated to data-tip on
// first hover so the browser's delayed tooltip never competes with ours.
const SEL = ".badge-chip, .ach, .tier, [data-tip]"

export interface Tips {
	show(el: HTMLElement, text: string | undefined): void
	hide(): void
}

export function initTooltips(doc: Document = document): Tips {
	const pop = doc.createElement("div")
	pop.className = "tip-pop"
	pop.setAttribute("role", "tooltip")
	doc.body.appendChild(pop)
	let anchor: HTMLElement | null = null

	const place = (el: HTMLElement) => {
		const r = el.getBoundingClientRect()
		const pw = pop.offsetWidth,
			ph = pop.offsetHeight
		const x = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), innerWidth - pw - 8)
		let y = r.top - ph - 10
		pop.classList.toggle("below", y < 8)
		if (y < 8) y = r.bottom + 10
		pop.style.left = x + "px"
		pop.style.top = y + "px"
	}
	const show = (el: HTMLElement, text: string | undefined) => {
		if (!text) return
		anchor = el
		pop.textContent = text
		pop.classList.add("show")
		place(el)
	}
	const hide = () => {
		anchor = null
		pop.classList.remove("show")
	}

	doc.addEventListener("mouseover", (e) => {
		const el = (e.target as Element | null)?.closest?.<HTMLElement>(SEL)
		if (!el) return anchor && hide()
		if (el.title) {
			el.dataset.tip = el.title
			el.removeAttribute("title")
		}
		if (el.dataset.tip) show(el, el.dataset.tip)
	})
	doc.addEventListener(
		"mouseout",
		(e) => {
			if (anchor && !(e.relatedTarget && anchor.contains(e.relatedTarget as Node))) hide()
		},
		true,
	)
	doc.addEventListener("scroll", () => anchor && place(anchor), true)
	return { show, hide }
}
