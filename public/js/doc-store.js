// Local crash-cache for the solo editor. This is NOT the save path — the
// server copy is authoritative. We keep the in-progress draft in localStorage
// (every 30s and on a debounce while typing) purely so a crash, a closed tab,
// or a mis-clicked link can't lose work. On load the editor compares savedAt
// against the server's updatedAt and OFFERS to restore rather than silently
// overwriting either side.
// `storage` is injectable so tests don't need a real localStorage.
const KEY = "cowriteDocDraft"

// The draft is the whole chapter list — a rename or a reorder alone is a
// restorable change. A draft written before chapters existed ({html}) is
// read as one untitled chapter with a null id, so nobody loses unsaved work
// across the deploy; the restore maps that null onto the document's first
// chapter.
const chapterList = (v) =>
	Array.isArray(v?.chapters)
		? v.chapters.map((c) => ({ id: c?.id ?? null, title: String(c?.title ?? ""), html: String(c?.html ?? "") }))
		: typeof v?.html === "string"
			? [{ id: null, title: "", html: v.html }]
			: null

export function loadDraft(docId, storage = localStorage) {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null")
		if (!v || v.docId !== docId) return null
		const chapters = chapterList(v)
		return chapters ? { docId, title: v.title, savedAt: v.savedAt, chapters } : null
	} catch (e) {
		return null
	}
}

export function saveDraft(docId, chapters, title, storage = localStorage) {
	try {
		const list = (Array.isArray(chapters) ? chapters : [{ id: null, title: "", html: String(chapters ?? "") }])
			.map(({ id = null, title = "", html = "" }) => ({ id, title, html }))
		storage.setItem(KEY, JSON.stringify({ docId, chapters: list, title, savedAt: Date.now() }))
		return true
	} catch (e) {
		return false // quota or private mode — the server save still works
	}
}

export function clearDraft(docId, storage = localStorage) {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null")
		// only drop the cache if it belongs to this doc
		if (!v || !docId || v.docId === docId) storage.removeItem(KEY)
	} catch (e) {}
}

// The comparable shape of a chapter list: a draft chapter with no id yet
// (never saved, or from a pre-chapter draft) compares by position.
const shape = (chapters, doc) =>
	JSON.stringify(
		(chapters || []).map((c, i) => ({
			id: c.id ?? doc?.chapters?.[i]?.id ?? null,
			title: c.title || doc?.chapters?.[i]?.title || "",
			html: c.html || "",
		})),
	)

// A draft is worth offering only if it's newer than what the server has AND
// actually differs from it.
export const draftIsNewer = (draft, doc) => {
	if (!draft || !doc || !(draft.savedAt > (doc.updatedAt || 0))) return false
	const mine = draft.chapters || chapterList(draft)
	const theirs = Array.isArray(doc.chapters) && doc.chapters.length ? doc.chapters : [{ id: null, title: "", html: doc.html || "" }]
	return shape(mine, { chapters: theirs }) !== shape(theirs, { chapters: theirs })
}
