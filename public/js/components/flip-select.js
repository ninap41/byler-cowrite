// A dropdown that folds open the way the theme switcher does — the same 3D
// flip, the same rows — for the one place a native <select> genuinely can't do
// the job: the typeface menu.
//
// A native option list can carry a `font-family`, but the browser draws that
// list itself, over the page, in its own colours and with no promise about
// blending: on a translucent panel the faces are unreadable, which defeats the
// whole point of previewing a letterform. This menu is OUR markup, so it is
// opaque by rule (`--flip-bg` in base.css), and each row is set in the face it
// offers.
//
// GSAP animates it when GSAP is there; without it (or under reduced motion) the
// `.open` class and a CSS transition do the same job. Markup and wiring live
// together here so the two can't drift.
import { esc } from "../util.js"

// rows: [{ value, label, style? }] — `style` is inline CSS for the row, which
// is how the typeface menu previews each face in itself.
export function flipSelectHtml(id, rows = [], value = "", { label = "" } = {}) {
	const cur = rows.find((r) => r.value === value) || rows[0] || { label: "" }
	return (
		`<div class="flip-select" id="${esc(id)}">` +
		`<button type="button" class="flip-toggle" id="${esc(id)}Toggle" aria-haspopup="listbox"` +
		` aria-expanded="false"${label ? ` aria-label="${esc(label)}"` : ""}>` +
		`<span class="flip-cur" id="${esc(id)}Cur"${cur.style ? ` style="${esc(cur.style)}"` : ""}>${esc(
			cur.label,
		)}</span><i class="chev">&#9662;</i></button>` +
		`<div class="flip-menu" id="${esc(id)}Menu" role="listbox"${label ? ` aria-label="${esc(label)}"` : ""}>` +
		rows
			.map(
				(r) =>
					`<button type="button" role="option" data-val="${esc(r.value)}"` +
					`${r.value === value ? ' class="active" aria-selected="true"' : ' aria-selected="false"'}` +
					`${r.style ? ` style="${esc(r.style)}"` : ""}>${esc(r.label)}</button>`,
			)
			.join("") +
		`</div></div>`
	)
}

// `portal: true` lifts the list out of its parent while open — appended to
// <body>, fixed at the toggle's screen position — so a menu inside a box that
// clips or scrolls (the theme menu) can still fold out past its edge and be
// scrolled through when the list is long. It goes back home on close, so
// outside-click checks and the DOM stay simple.
export function mountFlipSelect(root, { id = "fs", rows = [], value = "", label = "", onChange, portal = false } = {}) {
	root.innerHTML = flipSelectHtml(id, rows, value, { label })
	const box = root.querySelector(".flip-select")
	const toggle = box.querySelector(".flip-toggle")
	const menu = box.querySelector(".flip-menu")
	const cur = box.querySelector(".flip-cur")
	const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	const gsap = typeof window.gsap !== "undefined" && !reduce ? window.gsap : null
	let open = false
	let current = value

	if (gsap) menu.style.transition = "none" // the CSS transition is the fallback only

	// portal: move the list to <body> at the toggle's spot; home again on close
	function lift() {
		if (!portal) return
		const r = toggle.getBoundingClientRect()
		document.body.appendChild(menu)
		menu.classList.add("flip-portal")
		const vw = window.innerWidth,
			vh = window.innerHeight
		const width = Math.max(200, r.width)
		const left = Math.max(8, Math.min(r.left, vw - width - 8))
		const below = vh - r.bottom - 16
		const above = r.top - 16
		const down = below >= 220 || below >= above
		menu.style.left = left + "px"
		menu.style.minWidth = width + "px"
		if (down) {
			menu.style.top = r.bottom + 6 + "px"
			menu.style.bottom = ""
			menu.style.maxHeight = Math.min(420, Math.max(120, below)) + "px"
			menu.style.transformOrigin = "50% 0"
		} else {
			menu.style.top = ""
			menu.style.bottom = vh - r.top + 6 + "px"
			menu.style.maxHeight = Math.min(420, Math.max(120, above)) + "px"
			menu.style.transformOrigin = "50% 100%"
		}
	}
	function land() {
		if (!portal || menu.parentNode === box) return
		menu.classList.remove("flip-portal")
		menu.style.left = menu.style.top = menu.style.bottom = menu.style.minWidth = menu.style.maxHeight = menu.style.transformOrigin = ""
		box.appendChild(menu)
	}

	function openMenu() {
		open = true
		lift()
		box.classList.add("open")
		menu.classList.toggle("open", portal) // portaled: the box's .open can't reach it
		toggle.setAttribute("aria-expanded", "true")
		// bring the current choice into view in a long list
		menu.querySelector(".active")?.scrollIntoView?.({ block: "nearest" })
		if (!gsap) return
		gsap.killTweensOf([menu, menu.children])
		gsap.set(menu, { visibility: "visible", transformOrigin: menu.style.transformOrigin || "50% 0" })
		gsap.fromTo(menu, { rotationX: -90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.42, ease: "power2.out" })
		gsap.fromTo(
			menu.children,
			{ opacity: 0, y: -8 },
			{ opacity: 1, y: 0, duration: 0.28, stagger: 0.05, delay: 0.1, ease: "power2.out", clearProps: "transform" },
		)
	}
	function closeMenu() {
		open = false
		toggle.setAttribute("aria-expanded", "false")
		if (!gsap) {
			box.classList.remove("open")
			menu.classList.remove("open")
			land()
			return
		}
		gsap.killTweensOf([menu, menu.children])
		gsap.to(menu, {
			rotationX: -90,
			opacity: 0,
			duration: 0.28,
			ease: "power2.in",
			onComplete: () => {
				box.classList.remove("open")
				menu.classList.remove("open")
				gsap.set(menu, { clearProps: "all" })
				land()
			},
		})
	}
	function paint(val) {
		current = val
		const row = rows.find((r) => r.value === val)
		if (!row) return
		cur.textContent = row.label
		cur.setAttribute("style", row.style || "")
		menu.querySelectorAll("[data-val]").forEach((b) => {
			const on = b.dataset.val === val
			b.classList.toggle("active", on)
			b.setAttribute("aria-selected", String(on))
		})
	}

	toggle.addEventListener("click", (e) => {
		e.stopPropagation()
		open ? closeMenu() : openMenu()
	})
	menu.addEventListener("click", (e) => {
		const b = e.target.closest("[data-val]")
		if (!b) return
		paint(b.dataset.val)
		closeMenu()
		onChange?.(b.dataset.val)
	})
	document.addEventListener("click", (e) => {
		if (open && !box.contains(e.target) && !menu.contains(e.target)) closeMenu()
	})
	// a portaled list must not sit still while the page under it scrolls or resizes
	if (portal) {
		const follow = () => open && lift()
		window.addEventListener("resize", follow)
		window.addEventListener("scroll", follow, true)
	}
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && open) closeMenu()
	})

	return {
		set: (v) => (paint(v), undefined),
		get value() {
			return current
		},
		close: closeMenu,
		el: box,
		menu, // exposed so a host (the theme switch) can treat clicks in it as its own
	}
}
