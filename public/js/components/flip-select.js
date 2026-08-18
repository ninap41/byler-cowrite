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

export function mountFlipSelect(root, { id = "fs", rows = [], value = "", label = "", onChange } = {}) {
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

	function openMenu() {
		open = true
		box.classList.add("open")
		toggle.setAttribute("aria-expanded", "true")
		if (!gsap) return
		gsap.killTweensOf([menu, menu.children])
		gsap.set(menu, { visibility: "visible", transformOrigin: "50% 0" })
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
		if (!gsap) return box.classList.remove("open")
		gsap.killTweensOf([menu, menu.children])
		gsap.to(menu, {
			rotationX: -90,
			opacity: 0,
			duration: 0.28,
			ease: "power2.in",
			onComplete: () => {
				box.classList.remove("open")
				gsap.set(menu, { clearProps: "all" })
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
		if (open && !box.contains(e.target)) closeMenu()
	})
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
	}
}
