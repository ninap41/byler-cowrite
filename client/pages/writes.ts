import { api } from "/js/api.js"
import { mountChrome, setUserChip } from "/js/chrome.js"
import { requireAuth } from "/js/auth-guard.js"
import { docShelfHtml } from "/js/write-view.js"
import type { DocSummary } from "/js/write-view.js"
import type { ChipUser } from "/js/chrome.js"

mountChrome({ page: "writes" })
const me = await requireAuth<ChipUser>("/")
setUserChip(me)
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

let docs: DocSummary[] = []
let pendingDelete: string | null = null

async function load() {
	try {
		docs = (await api<{ docs?: DocSummary[] }>("/api/docs", null, "GET")).docs || []
		$("docList").innerHTML = docShelfHtml(docs)
	} catch (e) {
		$("writesErr").textContent = (e as Error).message
	}
}

$("newDocBtn").addEventListener("click", async () => {
	$("writesErr").textContent = ""
	try {
		const { doc } = await api<{ doc: { id: string } }>("/api/docs", { title: "Untitled" })
		location.href = "/write?id=" + encodeURIComponent(doc.id)
	} catch (e) {
		$("writesErr").textContent = (e as Error).message
	}
})

$("docList").addEventListener("click", (e) => {
	const del = (e.target as HTMLElement).closest(".doc-del")
	if (!del) return
	const card = del.closest<HTMLElement>(".doc-card")
	pendingDelete = card?.dataset.id ?? null
	const d = docs.find((x) => x.id === pendingDelete)
	$("docDelName").textContent = d ? d.title ?? "" : "this document"
	$("docDelErr").textContent = ""
	$("docDelModal").classList.remove("hidden")
})

const closeDel = () => {
	$("docDelModal").classList.add("hidden")
	pendingDelete = null
}
$("docDelCancel").addEventListener("click", closeDel)
$("docDelModal").addEventListener("click", (e) => {
	if (e.target === $("docDelModal")) closeDel()
})
$("docDelConfirm").addEventListener("click", async () => {
	if (!pendingDelete) return
	try {
		await api("/api/docs/" + encodeURIComponent(pendingDelete), null, "DELETE")
		closeDel()
		load()
	} catch (e) {
		$("docDelErr").textContent = (e as Error).message
	}
})

if (me) load()
