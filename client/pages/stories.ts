import { api } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import {
	gameCardHtml,
	writeCardHtml,
	archiveMetaText,
	archiveStoryHtml,
	fmtWhen,
} from "/js/archive-view.js"
import { mountViewPicker, applyGrid } from "/js/components/view-picker.js"
import { esc } from "/js/util.js"
import type { ArchiveGame, WriteCard } from "/js/archive-view.js"
import type { ChipUser } from "/js/chrome.js"

/** A row of GET /api/stories: a game or a public solo write, on `kind`. */
type StoryRow = (ArchiveGame & { kind: "game"; id?: string; createdAt?: number; wordCount: number; tags?: string[]; viewable?: boolean }) | (WriteCard & { kind: "write"; id: string; code?: string; createdAt?: number; savedAt?: number; wordCount: number; tags?: string[] })
interface StoriesPage {
	stories: StoryRow[]
	pages: number
	total: number
}
/** GET /api/stories/:code — the read-only story view. */
interface StoryDetail extends ArchiveGame {
	createdAt?: number
	wordCount: number
	tags?: string[]
	story: { name: string; color: string; html?: string }[]
}

mountChrome({ page: "stories" })
const me = await requireAuth<ChipUser>("/")
setUserChip(me)
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const hasGsap =
	typeof window.gsap !== "undefined" &&
	!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)

let page = 1
let pages = 1

// ---- layout ----
// List or N-across, remembered per browser and shared with /archive:
// how you like a shelf laid out is a habit, not a per-library setting.
// Multi-column views also widen the page — four covers can't share an
// 860px reading column.
mountViewPicker($("stViewWrap"), (cols) => {
	applyGrid($("storiesList"), cols)
	document.querySelector(".archive-inner")!.classList.toggle("wide", cols > 1)
})

// ?user=NAME narrows the library to one writer's games (linked from
// their profile) — the heading and a back-to-profile link follow suit
const forUser = new URLSearchParams(location.search).get("user") || ""
if (forUser) {
	$("storiesHeading").textContent = `${forUser}'s stories`
	$("storiesSub").textContent = "Every game this writer hosted or held a seat in."
	const back = $<HTMLAnchorElement>("profileBackLink")
	back.classList.remove("hidden")
	back.href = "/profile?user=" + encodeURIComponent(forUser)
}

async function loadStories() {
	const [sort = "", dir = ""] = $<HTMLSelectElement>("stSort").value.split("-")
	const params = new URLSearchParams({ sort, dir, page: String(page), limit: "12" })
	if (forUser) params.set("user", forUser)
	const q = $<HTMLInputElement>("stQ").value.trim()
	const tag = $<HTMLInputElement>("stTag").value.trim()
	if (q) params.set("q", q)
	if (tag) params.set("tag", tag)
	let d: StoriesPage
	try {
		d = await api<StoriesPage>("/api/stories?" + params, null, "GET")
	} catch (e) {
		$("storiesList").innerHTML = '<p class="archive-empty">Could not load stories.</p>'
		return
	}
	pages = d.pages
	page = Math.min(page, pages)
	const list = $("storiesList")
	list.innerHTML = ""
	if (!d.stories.length) {
		list.innerHTML = '<p class="archive-empty">No stories match.</p>'
	}
	d.stories.forEach((g) => {
		const b = document.createElement("div")
		b.className = "game-card"
		b.style.cursor = "pointer"
		// read-only listing: a big readable date, the card, word count, tags
		b.innerHTML =
			`<span class="gc-date">📅 ${new Date(g.createdAt || g.savedAt || 0).toLocaleDateString([], { dateStyle: "long" })}</span>` +
			(g.kind === "write" ? writeCardHtml(g) : gameCardHtml(g)) +
			`<span class="gc-meta" style="margin-top:6px">` +
			`<span>${g.wordCount.toLocaleString()} word${g.wordCount === 1 ? "" : "s"}</span>` +
			(g.tags?.length ? `<span>🏷 ${esc(g.tags.join(", "))}</span>` : "") +
			`</span>`
		// a public write opens in the editor (read-only for anyone but
		// its author); a game opens in the read-only story view here
		// a private write on someone's ?user= page is listed but locked
		if (g.kind === "write" && g.viewable === false) {
			b.classList.add("locked")
			b.style.cursor = "default"
			b.title = "Private, only its author can open it"
		} else
			b.onclick = () =>
				g.kind === "write" ? (location.href = "/write?id=" + encodeURIComponent(g.id)) : openStory(g.code)
		list.appendChild(b)
		if (window.gsap && hasGsap)
			gsap.from(b, { opacity: 0, y: 18, duration: 0.45, delay: 0.04 * list.children.length, ease: "power2.out" })
	})
	$("stPager").classList.toggle("hidden", pages <= 1)
	$("stPageInfo").textContent = `Page ${page} of ${pages} · ${d.total} stor${d.total === 1 ? "y" : "ies"}`
	$<HTMLButtonElement>("stPrev").disabled = page <= 1
	$<HTMLButtonElement>("stNext").disabled = page >= pages
}

function showList() {
	$("storyDetail").classList.add("hidden")
	;["storiesList", "storiesTools", "storiesSub"].forEach((id) => $(id).classList.remove("hidden"))
	$("stPager").classList.toggle("hidden", pages <= 1)
	history.replaceState(null, "", "/stories" + (forUser ? "?user=" + encodeURIComponent(forUser) : ""))
}

async function openStory(code: string) {
	let g: StoryDetail
	try {
		g = await api<StoryDetail>("/api/stories/" + encodeURIComponent(code), null, "GET")
	} catch (e) {
		return
	}
	$("stPrompt").textContent = g.name || g.prompt || "(no prompt)"
	$("stMeta").textContent =
		archiveMetaText(g) +
		` · ${g.wordCount.toLocaleString()} words · created ${fmtWhen(g.createdAt)}` +
		(g.tags?.length ? ` · 🏷 ${g.tags.join(", ")}` : "")
	// story html was sanitized server-side by sanitizeRich() before being saved
	$("stStory").innerHTML = archiveStoryHtml(g.story)
	// reading ONE story: the toolbar, the pager and the shelf's own subtitle
	// all describe the list, and none of them describes what you opened
	;["storiesList", "storiesTools", "stPager", "storiesSub"].forEach((id) => $(id).classList.add("hidden"))
	const det = $("storyDetail")
	det.classList.remove("hidden")
	history.replaceState(
		null, "",
		"/stories?code=" + encodeURIComponent(g.code) + (forUser ? "&user=" + encodeURIComponent(forUser) : ""),
	)
	if (window.gsap && hasGsap)
		gsap.fromTo(det, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" })
}

$("stListLink").onclick = (e) => {
	e.preventDefault()
	showList()
}
$("stPrev").onclick = () => {
	if (page > 1) {
		page--
		loadStories()
	}
}
$("stNext").onclick = () => {
	if (page < pages) {
		page++
		loadStories()
	}
}
$("stSort").onchange = () => {
	page = 1
	loadStories()
}
// search-as-you-type, lightly debounced (each keystroke is a server read)
let deb: ReturnType<typeof setTimeout> | undefined
for (const id of ["stQ", "stTag"])
	$(id).addEventListener("input", () => {
		clearTimeout(deb)
		deb = setTimeout(() => {
			page = 1
			loadStories()
		}, 300)
	})

$("storiesList").innerHTML = '<p class="archive-empty">Loading…</p>'
await loadStories()
const code = new URLSearchParams(location.search).get("code")
if (code) openStory(code.toUpperCase())
