// A navigation rail whose parent rows open a SIDE-FLYOUT submenu. On a desktop
// the submenu flies out to the right of its row (a fixed panel placed from the
// row's screen rect, clamped to the viewport); under the phone breakpoint the
// same panel folds open in-flow under the row instead, so the rail that stacks
// above the column on a phone never grows a popover it can't fit.
//
// Markup builders and the wiring live together so the two can't drift: the
// dashboard writes the rail by hand in exactly the shape navFlyoutHtml() emits
// (server-rendered, no flash) and a test proves they match. Emoji are plain
// text inside .dnav-ico so the theme gradient dresses them (base.css) and
// watchEmojis() never needs to know the menu exists.
//
// One submenu open at a time. Click toggles; keyboard opens (Enter / Space /
// ArrowRight / ArrowDown) and walks the items; hover opens after a short delay
// on a fine pointer only, and a hover-opened panel closes when the pointer
// leaves — a click-opened one stays until you say so. GSAP animates when it
// is loaded; without it (jsdom, a blocked CDN, reduced motion) the class flip
// alone does the job, synchronously.
import { esc } from "../util.js"

export type FlyoutTag = "soon" | "new"

/** One row of the rail, or one item of a submenu. `href` makes an <a>; otherwise a <button data-action>. */
export interface FlyoutItem {
	label: string
	emoji: string
	id?: string
	href?: string
	action?: string
	tag?: FlyoutTag
	/** rendered hidden with data-admin; setAdmin(true) reveals it */
	admin?: boolean
	/** target=_blank rel=noopener */
	external?: boolean
	/** the accent-2 pulse (.dnav-glow) */
	glow?: boolean
	/** a hidden count pill with this id (the inbox unread badge) */
	badgeId?: string
}
/** A parent row: its items fly out (desktop) or fold open (phone). */
export interface FlyoutGroup {
	id: string
	label: string
	emoji: string
	items: FlyoutItem[]
}
export type FlyoutRow = FlyoutItem | FlyoutGroup
export const isGroup = (r: FlyoutRow): r is FlyoutGroup => "items" in r

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
/** Element ids a group's button and panel wear: `cowrite` → railCowrite / railCowriteMenu. */
export const groupIds = (id: string): { button: string; menu: string } => ({ button: "rail" + cap(id), menu: "rail" + cap(id) + "Menu" })

function tagHtml(tag: FlyoutTag | undefined): string {
	if (tag === "soon") return `<span class="dnav-tag">soon</span>`
	if (tag === "new") return `<span class="dnav-new">New</span>`
	return ""
}

export function flyoutItemHtml(item: FlyoutItem, { menuitem = false }: { menuitem?: boolean } = {}): string {
	const cls = ["dnav", item.glow ? "dnav-glow" : "", item.admin ? "hidden" : ""].filter(Boolean).join(" ")
	const idAttr = item.id ? ` id="${esc(item.id)}"` : ""
	const role = menuitem ? ` role="menuitem"` : ""
	const admin = item.admin ? " data-admin" : ""
	const inner =
		`<span class="dnav-ico" aria-hidden="true">${esc(item.emoji)}</span><span class="dnav-label"${item.id === "inviteBtn" ? ' id="inviteLabel"' : ""}>${esc(item.label)}</span>` +
		tagHtml(item.tag) +
		(item.badgeId ? `<span class="dnav-badge hidden" id="${esc(item.badgeId)}"></span>` : "")
	if (item.href) {
		const ext = item.external ? ` target="_blank" rel="noopener"` : ""
		return `<a class="${cls}"${idAttr}${role} href="${esc(item.href)}"${ext}${admin}>${inner}</a>`
	}
	const act = item.action ? ` data-action="${esc(item.action)}"` : ""
	return `<button type="button" class="${cls}"${idAttr}${role}${act}${admin}>${inner}</button>`
}

export function flyoutGroupHtml(g: FlyoutGroup): string {
	const ids = groupIds(g.id)
	return (
		`<div class="dnav-wrap" data-flyout="${esc(g.id)}">` +
		`<button type="button" class="dnav dnav-parent" id="${ids.button}" aria-haspopup="menu" aria-expanded="false" aria-controls="${ids.menu}">` +
		`<span class="dnav-ico" aria-hidden="true">${esc(g.emoji)}</span><span class="dnav-label">${esc(g.label)}</span><span class="dnav-chev" aria-hidden="true">&#9656;</span>` +
		`</button>` +
		`<div class="dnav-sub hidden" id="${ids.menu}" role="menu" aria-label="${esc(g.label)}">` +
		g.items.map((it) => flyoutItemHtml(it, { menuitem: true })).join("") +
		`</div></div>`
	)
}

/** The whole rail body — every row in order. */
export const navFlyoutHtml = (rows: FlyoutRow[]): string => rows.map((r) => (isGroup(r) ? flyoutGroupHtml(r) : flyoutItemHtml(r))).join("")

export interface NavFlyoutOpts {
	onAction?: (action: string, el: HTMLElement) => void
	/** open on hover too (fine pointers, desktop only); default true */
	hoverOpen?: boolean
	hoverDelay?: number
	/** the breakpoint under which a submenu folds in-flow instead of flying out */
	phoneQuery?: string
	/** reveal the [data-admin] rows now */
	admin?: boolean
}
export interface NavFlyout {
	open(id: string, opts?: { focus?: "first" | "last" | "none" }): void
	close(opts?: { refocus?: boolean }): void
	readonly openId: string | null
	isPhone(): boolean
	setAdmin(on: boolean): void
	destroy(): void
}

const GAP = 8
const EDGE = 8
const ITEM_SEL = '[role="menuitem"]:not(.hidden)'

export function mountNavFlyout(root: HTMLElement, { onAction, hoverOpen = true, hoverDelay = 120, phoneQuery = "(max-width: 900px)", admin = false }: NavFlyoutOpts = {}): NavFlyout {
	const mq = (q: string): boolean => (typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false)
	const isPhone = () => mq(phoneQuery)
	const reduce = mq("(prefers-reduced-motion: reduce)")
	const gsap = !reduce ? window.gsap : undefined
	const canHover = hoverOpen && mq("(hover: hover) and (pointer: fine)")

	interface Group {
		id: string
		wrap: HTMLElement
		button: HTMLElement
		panel: HTMLElement
	}
	const groups: Group[] = []
	root.querySelectorAll<HTMLElement>(".dnav-wrap[data-flyout]").forEach((wrap) => {
		const button = wrap.querySelector<HTMLElement>(".dnav-parent")
		const panel = wrap.querySelector<HTMLElement>(".dnav-sub")
		if (!button || !panel) return
		if (gsap) panel.style.transition = "none" // the CSS keyframe is the fallback only
		groups.push({ id: wrap.dataset.flyout || "", wrap, button, panel })
	})

	let openId: string | null = null
	let openedBy: "click" | "hover" | "key" | null = null
	let wasPhone = isPhone()
	let hoverTimer: ReturnType<typeof setTimeout> | null = null
	const byId = (id: string) => groups.find((g) => g.id === id)
	const items = (g: Group) => [...g.panel.querySelectorAll<HTMLElement>(ITEM_SEL)]

	// the desktop placement: beside the row, on its right; flipped to the
	// left when the viewport ends first; never off the top or bottom
	function place(g: Group) {
		const r = g.button.getBoundingClientRect()
		const vw = window.innerWidth
		const vh = window.innerHeight
		g.panel.style.position = "fixed"
		g.panel.style.left = r.right + GAP + "px"
		g.panel.style.top = r.top + "px"
		const w = g.panel.offsetWidth
		const h = g.panel.offsetHeight
		if (r.right + GAP + w > vw - EDGE) g.panel.style.left = Math.max(EDGE, r.left - GAP - w) + "px"
		g.panel.style.top = Math.max(EDGE, Math.min(r.top, vh - h - EDGE)) + "px"
	}
	function unplace(g: Group) {
		g.panel.style.position = g.panel.style.left = g.panel.style.top = ""
	}

	function open(id: string, { focus = "none" }: { focus?: "first" | "last" | "none" } = {}) {
		const g = byId(id)
		if (!g) return
		if (openId && openId !== id) close({ refocus: false })
		if (openId === id) return
		openId = id
		const phone = isPhone()
		g.panel.classList.remove("hidden")
		g.panel.classList.toggle("is-fold", phone)
		g.wrap.classList.toggle("is-fold", phone)
		g.button.setAttribute("aria-expanded", "true")
		g.button.classList.add("on")
		if (phone) unplace(g)
		else place(g)
		if (gsap) {
			gsap.killTweensOf([g.panel, g.panel.children])
			gsap.set(g.panel, { visibility: "visible" })
			if (phone) gsap.fromTo(g.panel, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.25, ease: "power2.out", clearProps: "height" })
			else gsap.fromTo(g.panel, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.22, ease: "power2.out" })
			gsap.fromTo(g.panel.children, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.2, stagger: 0.04, delay: 0.05, ease: "power2.out", clearProps: "transform" })
		} else g.panel.classList.add("open")
		if (focus === "first") items(g)[0]?.focus()
		else if (focus === "last") items(g).at(-1)?.focus()
	}
	function close({ refocus = false }: { refocus?: boolean } = {}) {
		if (!openId) return
		const g = byId(openId)
		openId = null
		openedBy = null
		if (hoverTimer) clearTimeout(hoverTimer)
		hoverTimer = null
		if (!g) return
		g.button.setAttribute("aria-expanded", "false")
		g.button.classList.remove("on")
		const settle = () => {
			g.panel.classList.add("hidden")
			g.panel.classList.remove("open", "is-fold")
			g.wrap.classList.remove("is-fold")
			unplace(g)
		}
		if (gsap) {
			gsap.killTweensOf([g.panel, g.panel.children])
			gsap.to(g.panel, {
				opacity: 0,
				x: -8,
				duration: 0.16,
				ease: "power2.in",
				onComplete: () => {
					settle()
					// only what the tweens touched — "all" would also take the
					// inline transition:none and every later open would fight the CSS
					gsap.set(g.panel, { clearProps: "transform,opacity,visibility,height" })
				},
			})
		} else settle()
		if (refocus) g.button.focus()
	}

	// ---- wiring ----
	for (const g of groups) {
		g.button.addEventListener("click", () => {
			if (openId === g.id) close()
			else {
				open(g.id)
				openedBy = "click"
			}
		})
		g.button.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "ArrowDown") {
				e.preventDefault()
				open(g.id, { focus: "first" })
				openedBy = "key"
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				open(g.id, { focus: "last" })
				openedBy = "key"
			}
		})
		g.panel.addEventListener("keydown", (e) => {
			const list = items(g)
			const i = list.indexOf(document.activeElement as HTMLElement)
			if (e.key === "ArrowDown") {
				e.preventDefault()
				list[(i + 1) % list.length]?.focus()
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				list[(i - 1 + list.length) % list.length]?.focus()
			} else if (e.key === "Home") {
				e.preventDefault()
				list[0]?.focus()
			} else if (e.key === "End") {
				e.preventDefault()
				list.at(-1)?.focus()
			} else if (e.key === "ArrowLeft" || e.key === "Escape") {
				e.preventDefault()
				e.stopPropagation()
				close({ refocus: true })
			} else if (e.key === "Tab") close()
		})
		g.panel.addEventListener("click", (e) => {
			const el = (e.target as Element | null)?.closest<HTMLElement>('[role="menuitem"]')
			if (!el) return
			const act = el.dataset.action
			if (act) onAction?.(act, el)
			close()
		})
		if (canHover) {
			const enter = () => {
				if (isPhone()) return
				if (hoverTimer) clearTimeout(hoverTimer)
				if (openId === g.id) return
				hoverTimer = setTimeout(() => {
					open(g.id)
					openedBy = "hover"
				}, hoverDelay)
			}
			const leave = () => {
				if (hoverTimer) clearTimeout(hoverTimer)
				hoverTimer = null
				if (openId !== g.id || openedBy !== "hover") return
				hoverTimer = setTimeout(() => openId === g.id && openedBy === "hover" && close(), 250)
			}
			// the fixed panel sits outside the wrap's box, so both listen
			for (const el of [g.wrap, g.panel]) {
				el.addEventListener("mouseenter", enter)
				el.addEventListener("mouseleave", leave)
			}
		}
	}
	const onDocClick = (e: MouseEvent) => {
		const t = e.target as Node | null
		if (openId && t && !root.contains(t)) close()
	}
	const onDocKey = (e: KeyboardEvent) => {
		if (e.key === "Escape" && openId) close({ refocus: true })
	}
	const onFocusOut = (e: FocusEvent) => {
		const to = e.relatedTarget as Node | null
		if (openId && to && !root.contains(to) && !isPhone()) close()
	}
	const onViewport = () => {
		if (!openId) return
		const g = byId(openId)
		if (!g) return
		const phone = isPhone()
		if (phone !== wasPhone) {
			wasPhone = phone
			return close()
		}
		if (!phone) place(g)
	}
	document.addEventListener("click", onDocClick)
	document.addEventListener("keydown", onDocKey)
	root.addEventListener("focusout", onFocusOut)
	window.addEventListener("resize", onViewport)
	window.addEventListener("scroll", onViewport, true)

	function setAdmin(on: boolean) {
		root.querySelectorAll<HTMLElement>("[data-admin]").forEach((el) => el.classList.toggle("hidden", !on))
	}
	if (admin) setAdmin(true)

	return {
		open,
		close,
		get openId() {
			return openId
		},
		isPhone,
		setAdmin,
		destroy() {
			close()
			document.removeEventListener("click", onDocClick)
			document.removeEventListener("keydown", onDocKey)
			root.removeEventListener("focusout", onFocusOut)
			window.removeEventListener("resize", onViewport)
			window.removeEventListener("scroll", onViewport, true)
		},
	}
}
