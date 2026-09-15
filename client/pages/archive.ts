import { api } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { gameCardHtml, archiveStoryHtml, fmtWhen, canContinue } from "/js/archive-view.js"
import { mountViewPicker, applyGrid } from "/js/components/view-picker.js"
import { safeColor, oneLinePrompt, promptHtml } from "/js/util.js"
import { buildExports, exportDocument } from "/js/export.js"
import { mountTagEditor } from "/js/components/tag-chips.js"
import type { ArchiveGame } from "/js/archive-view.js"
import type { ChipUser } from "/js/chrome.js"
import type { StoryLine } from "/js/shared/wire.js"

/** A game as GET /api/games lists it for me (gameSummary() + `hosted`). */
interface MyArchiveGame extends ArchiveGame {
	hosted?: boolean
}
/** GET /api/games/:code — the full snapshot the detail view reads. */
interface GameDetail extends ArchiveGame {
	story: StoryLine[]
	tags?: string[]
}
/** The slice of jsPDF the export uses (loaded from the CDN on demand). */
interface JsPdfDoc {
	internal: { pageSize: { getWidth(): number; getHeight(): number } }
	setFont(name: string, style: string): void
	setFontSize(n: number): void
	splitTextToSize(text: string, width: number): string[]
	text(text: string, x: number, y: number, opts?: { align?: string }): void
	addPage(): void
	setDrawColor(n: number): void
	line(x1: number, y1: number, x2: number, y2: number): void
	save(name: string): void
}
interface JsPdfModule {
	jsPDF: new (opts: { unit: string; format: string }) => JsPdfDoc
}
declare global {
	interface Window {
		jspdf?: JsPdfModule
	}
}

mountChrome({ page: "archive" })
const me = await requireAuth<ChipUser>("/")
setUserChip(me)
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const hasGsap =
	typeof window.gsap !== "undefined" &&
	!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)

function showList() {
	$("archiveDetail").classList.add("hidden")
	$("archiveList").classList.remove("hidden")
	history.replaceState(null, "", "/archive")
}

// ---- layout ----
// List or N-across, shared with the all-stories shelf (same picker, same
// stored choice). The two group headings stay OUTSIDE the grids — a
// heading is not a card and must not take a column — so each group gets
// its own container and the grid class lands there.
let cardCols = 1
mountViewPicker(document.getElementById("archViewWrap"), (cols) => {
	cardCols = cols
	document.querySelector(".archive-inner")!.classList.toggle("wide", cols > 1)
	$("archiveList")
		.querySelectorAll<HTMLElement>(".arch-group")
		.forEach((box) => applyGrid(box, cols))
})

function renderGameCards(games: MyArchiveGame[]) {
	const list = $("archiveList")
	if (!games.length) {
		list.innerHTML =
			'<p class="archive-empty">No saved games yet, finish (or pause) a game and it will show up here.</p>'
		return
	}
	list.innerHTML = ""
	// grouped: the games I host first, then the ones I joined
	const groups: [string, MyArchiveGame[]][] = [
		["Hosted games", games.filter((g) => g.hosted)],
		["Joined games", games.filter((g) => !g.hosted)],
	]
	groups.forEach(([title, group]) => {
		if (!group.length) return
		const h = document.createElement("h4")
		h.className = "arch-sub"
		h.textContent = title
		list.appendChild(h)
		const box = document.createElement("div")
		box.className = "arch-group"
		applyGrid(box, cardCols)
		list.appendChild(box)
		group.forEach((g) => appendCard(g, box))
	})
	function appendCard(g: MyArchiveGame, box: HTMLElement) {
		const b = document.createElement("div")
		b.className = "game-card"
		b.style.cursor = "pointer"
		b.innerHTML = gameCardHtml(g)
		// a finished story: anyone in it may "Write more" (reopen its lobby);
		// an unfinished one: the host continues it
		if (g.phase === "over" || canContinue(g, me?.username)) {
			const cont = document.createElement("button")
			cont.className = "primary"
			cont.textContent = g.phase === "over" ? "✒️ Write more" : "Continue →"
			cont.style.cssText = "margin-top:10px;flex:none;min-width:0;padding:8px 14px;font-size:.85rem"
			cont.onclick = (e) => {
				e.stopPropagation()
				if (g.phase === "over") writeMore(g.code)
				else location.href = "/game?code=" + encodeURIComponent(g.code)
			}
			b.appendChild(cont)
		}
		b.onclick = () => openGameDetail(g.code)
		box.appendChild(b)
		if (window.gsap && hasGsap)
			gsap.from(b, { opacity: 0, y: 18, duration: 0.45, delay: 0.05 * box.children.length, ease: "power2.out" })
	}
}

// "Write more": reopen a finished story as a lobby under its own code.
async function writeMore(code: string) {
	try {
		await api("/api/games/" + encodeURIComponent(code) + "/reopen", {})
		location.href = "/game?code=" + encodeURIComponent(code)
	} catch (e) {
		alert((e as Error).message)
	}
}
let curG: GameDetail | null = null
async function openGameDetail(code: string) {
	let g: GameDetail
	try {
		g = await api<GameDetail>("/api/games/" + encodeURIComponent(code), null, "GET")
	} catch (e) {
		// not my story (no seat, no line, not the host, not an admin): the
		// archive is for stories I can export or continue — read it instead
		if ((e as { status?: number }).status === 403) location.replace("/stories?code=" + encodeURIComponent(code))
		return
	}
	curG = g
	$("archTitle").textContent = g.name || oneLinePrompt(g.prompt) || g.code
	// every writer, linked to their profile (host first, crown kept)
	const authors = $("archAuthors")
	authors.textContent = ""
	;[...g.writers].sort((a, b) => Number(!!b.isHost) - Number(!!a.isHost)).forEach((w, i) => {
		if (i) authors.append(", ")
		const a = document.createElement("a")
		a.className = "linky"
		a.href = "/profile?user=" + encodeURIComponent(w.name)
		a.style.color = safeColor(w.color)
		a.textContent = (w.isHost ? "👑 " : "") + w.name
		authors.appendChild(a)
	})
	$("archMeta").textContent =
		`code: ${g.code} · ${g.writers.length} writer${g.writers.length === 1 ? "" : "s"} · ${Number(g.words || 0).toLocaleString()} words · last played ${fmtWhen(g.savedAt)}`
	$("archPrompt").innerHTML = promptHtml(g.prompt || "(no prompt)")
	// tags: shown as read-only chips above the prompt; everyone with a
	// seat here may edit them in the modal, where each change saves itself
	const paintTags = (tags: string[]) => {
		const list = $("archTagList")
		list.innerHTML = ""
		if (!tags.length) {
			const e = document.createElement("span")
			e.className = "subtle"
			e.textContent = "No tags yet"
			list.appendChild(e)
		}
		tags.forEach((t) => {
			const c = document.createElement("span")
			c.className = "tag-chip"
			c.textContent = "#" + t
			list.appendChild(c)
		})
	}
	paintTags(g.tags || [])
	mountTagEditor($("archTags"), {
		tags: g.tags || [],
		onSave: async (tags) => {
			try {
				await api("/api/games/" + encodeURIComponent(g.code) + "/tags", { tags })
				$("archTagsErr").textContent = ""
				g.tags = tags
				paintTags(tags)
			} catch (e) {
				$("archTagsErr").textContent = (e as Error).message
			}
		},
	})
	$("archTagEdit").onclick = () => {
		$("tagModal").classList.remove("hidden")
		$("archTags").querySelector<HTMLInputElement>("input")?.focus()
	}
	// story html was sanitized server-side by sanitizeRich() before being saved
	$("archStory").innerHTML = archiveStoryHtml(g.story)
	const over = g.phase === "over"
	const mayContinue = over || canContinue(g, me?.username)
	$("archContinue").classList.toggle("hidden", !mayContinue)
	$("archContinue").textContent = over ? "✒️ Write more" : "Continue this story →"
	$("archContinue").onclick = () => (over ? writeMore(g.code) : (location.href = "/game?code=" + encodeURIComponent(g.code)))
	$("archDelete").classList.toggle("hidden", g.hostName !== me?.username)
	$("archiveList").classList.add("hidden")
	const det = $("archiveDetail")
	det.classList.remove("hidden")
	history.replaceState(null, "", "/archive?code=" + encodeURIComponent(g.code))
	if (window.gsap && hasGsap)
		gsap.fromTo(det, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" })
}

$("archListLink").onclick = (e) => {
	e.preventDefault()
	showList()
}

// ---- export: copy as rich text (falls back to plain), .html, .pdf ----
const exportDoc = () => exportDocument(buildExports(curG?.prompt || "", curG?.story || []).html)
$("archCopy").onclick = async () => {
	const btn = $("archCopy")
	const ex = buildExports(curG?.prompt || "", curG?.story || [])
	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/html": new Blob([ex.html], { type: "text/html" }),
				"text/plain": new Blob([ex.plain], { type: "text/plain" }),
			}),
		])
		btn.textContent = "Copied: paste into Docs/Word"
	} catch (e) {
		try {
			await navigator.clipboard.writeText(ex.plain)
			btn.textContent = "Copied (plain text)"
		} catch (_) {
			btn.textContent = "Copy failed"
		}
	}
	setTimeout(() => (btn.textContent = "📋 Copy (formatted)"), 2200)
}
// ---- delete flow ----
$("archDelete").onclick = () => {
	$("delName").textContent = curG?.name || oneLinePrompt(curG?.prompt) || curG?.code || ""
	$("delErr").textContent = ""
	$("delModal").classList.remove("hidden")
}
$("delCancel").onclick = () => $("delModal").classList.add("hidden")
$("tagDone").onclick = () => $("tagModal").classList.add("hidden")
$("tagModal").onclick = (e) => {
	if (e.target === $("tagModal")) $("tagModal").classList.add("hidden")
}
$("delModal").addEventListener("click", (e) => {
	if (e.target === $("delModal")) $("delModal").classList.add("hidden")
})
$("archHtml").onclick = () => {
	const blob = new Blob([exportDoc()], { type: "text/html" })
	const a = document.createElement("a")
	a.href = URL.createObjectURL(blob)
	a.download = "byler-cowrite-" + curG?.code + ".html"
	a.click()
	URL.revokeObjectURL(a.href)
}
// Lazy-load jsPDF only when someone actually asks for a PDF.
let jsPdfPromise: Promise<JsPdfModule> | null = null
const loadJsPdf = (): Promise<JsPdfModule> =>
	(jsPdfPromise ??= new Promise<JsPdfModule>((res, rej) => {
		if (window.jspdf) return res(window.jspdf)
		const s = document.createElement("script")
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
		s.onload = () => res(window.jspdf!)
		s.onerror = () => {
			jsPdfPromise = null
			rej(new Error("Could not load the PDF library."))
		}
		document.head.appendChild(s)
	}))
function storyToPdf(jspdf: JsPdfModule, prompt: string, story: StoryLine[], code: string) {
	const doc = new jspdf.jsPDF({ unit: "pt", format: "a4" })
	const M = 64,
		W = doc.internal.pageSize.getWidth() - M * 2,
		BOTTOM = doc.internal.pageSize.getHeight() - M
	let y = M
	const tmp = document.createElement("div")
	const put = (text: string, size: number, style: string, align?: string) => {
		doc.setFont("times", style)
		doc.setFontSize(size)
		const lh = size * 1.55
		for (const ln of doc.splitTextToSize(text, W)) {
			if (y + lh > BOTTOM) {
				doc.addPage()
				y = M
			}
			const x = align === "center" ? M + W / 2 : align === "right" ? M + W : M
			doc.text(ln, x, y, { align: align || "left" })
			y += lh
		}
	}
	if (prompt) {
		put(prompt, 13, "italic")
		y += 10
	}
	for (const l of story) {
		const html = l.html || ""
		const m = /^<(h1|h2|h3|p|hr)( class="(al-c|al-r)")?[ >]/.exec(html)
		const tag = m?.[1] || "p"
		const align = m?.[3] === "al-c" ? "center" : m?.[3] === "al-r" ? "right" : "left"
		if (tag === "hr") {
			if (y + 20 > BOTTOM) {
				doc.addPage()
				y = M
			}
			doc.setDrawColor(180)
			doc.line(M, y, M + W, y)
			y += 20
			continue
		}
		tmp.innerHTML = html.replace(/<br\s*\/?>/g, "\n")
		const text = (tmp.textContent || "").trim()
		if (!text) continue
		const size = tag === "h1" ? 22 : tag === "h2" ? 18 : tag === "h3" ? 15 : 12
		put(text, size, tag === "p" ? "normal" : "bold", align)
		y += 8
	}
	doc.save("byler-cowrite-" + code + ".pdf")
}
$("archPdf").onclick = async () => {
	$("delErr").textContent = ""
	try {
		storyToPdf(await loadJsPdf(), curG?.prompt || "", curG?.story || [], curG?.code || "")
	} catch (e) {
		// offline / CDN blocked: fall back to the browser's print-to-PDF
		const w = window.open("", "_blank")
		if (!w) return ($("delErr").textContent = (e as Error).message)
		w.document.write(exportDoc())
		w.document.close()
		w.focus()
		w.print()
	}
}
$("delConfirm").onclick = async () => {
	try {
		const title = curG?.name || oneLinePrompt(curG?.prompt) || curG?.code
		await api("/api/games/" + encodeURIComponent(curG?.code || ""), null, "DELETE")
		$("delModal").classList.add("hidden")
		showList()
		// refresh the list without the deleted story + confirm it's gone
		try {
			renderGameCards(await api<MyArchiveGame[]>("/api/games", null, "GET"))
		} catch (e) {}
		const note = $("archNotice")
		note.textContent = `🗑 “${title}” was deleted.`
		note.classList.remove("hidden")
		setTimeout(() => note.classList.add("hidden"), 6000)
		// and an unmissable centered confirmation
		const pop = document.createElement("div")
		pop.className = "badge-pop show"
		const b = document.createElement("b")
		b.textContent = "🗑 Story deleted"
		const s = document.createElement("span")
		s.textContent = `“${title}” is gone: for everyone, forever.`
		pop.append(b, s)
		document.body.appendChild(pop)
		setTimeout(() => pop.classList.add("gone"), 3600)
		setTimeout(() => pop.remove(), 4300)
	} catch (e) {
		$("delErr").textContent = (e as Error).message
	}
}

if (me) {
	$("archiveList").innerHTML = '<p class="archive-empty">Loading…</p>'
	try {
		const games = await api<MyArchiveGame[]>("/api/games", null, "GET")
		renderGameCards(games)
		const code = new URLSearchParams(location.search).get("code")
		if (code) openGameDetail(code.toUpperCase())
	} catch (e) {
		$("archiveList").innerHTML = '<p class="archive-empty">Could not load saved games.</p>'
	}
}
