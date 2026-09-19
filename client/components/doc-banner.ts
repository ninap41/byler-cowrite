// The solo editor's banners — the strip that stands in the sticky shell under
// the toolbar and says something the writer must decide about before going
// on: unsaved work from a previous session, an autosave refused because
// another tab saved first. One shape, one place, so scrolling a long chapter
// never hides the fact that a decision is waiting, and no page hand-writes a
// second copy of the markup. `bannerHtml` is pure (a string) and
// `mountDocBanners` owns the DOM: register a banner once, then show/hide it
// by id; every change calls `onChange` so the page can remeasure the shell.
import { esc } from "../util.js"

export interface BannerAction {
	id: string
	label: string
	/** the safe choice wears the ghost button; the other is a text link */
	primary?: boolean
	onClick: () => void
}
export interface BannerSpec {
	id: string
	/** `note` (the chip tone) or `warn` (tinted with the accent, role=alert) */
	kind?: "note" | "warn"
	/** already-safe html for the message (a `<b>` lead is fine); never user text */
	html: string
	actions: BannerAction[]
}

export const bannerHtml = (b: BannerSpec): string =>
	`<div class="doc-banner${b.kind === "warn" ? " warn" : ""} hidden" id="${esc(b.id)}"${b.kind === "warn" ? ' role="alert"' : ""}>` +
	`<span>${b.html}</span>` +
	b.actions
		.map((a) => `<button class="${a.primary ? "ghost" : "linky"}" id="${esc(a.id)}" type="button">${esc(a.label)}</button>`)
		.join("") +
	`</div>`

export interface DocBanners {
	add(spec: BannerSpec): void
	show(id: string): void
	hide(id: string): void
	shown(id: string): boolean
}

export function mountDocBanners(host: HTMLElement, { onChange = () => {} }: { onChange?: () => void } = {}): DocBanners {
	const doc = host.ownerDocument
	const el = (id: string) => doc.getElementById(id)
	return {
		add(spec) {
			host.insertAdjacentHTML("beforeend", bannerHtml(spec))
			for (const a of spec.actions) el(a.id)?.addEventListener("click", a.onClick)
		},
		show(id) {
			const b = el(id)
			if (!b || !b.classList.contains("hidden")) return
			b.classList.remove("hidden")
			onChange()
		},
		hide(id) {
			const b = el(id)
			if (!b || b.classList.contains("hidden")) return
			b.classList.add("hidden")
			onChange()
		},
		shown: (id) => !!el(id) && !el(id)!.classList.contains("hidden"),
	}
}
