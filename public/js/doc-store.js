// Local crash-cache for the solo editor. This is NOT the save path — the
// server copy is authoritative. We keep the in-progress draft in localStorage
// (every 30s and on a debounce while typing) purely so a crash, a closed tab,
// or a mis-clicked link can't lose work. On load the editor compares savedAt
// against the server's updatedAt and OFFERS to restore rather than silently
// overwriting either side.
// `storage` is injectable so tests don't need a real localStorage.
const KEY = "cowriteDocDraft"

export function loadDraft(docId, storage = localStorage) {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null")
		return v && v.docId === docId && typeof v.html === "string" ? v : null
	} catch (e) {
		return null
	}
}

export function saveDraft(docId, html, title, storage = localStorage) {
	try {
		storage.setItem(KEY, JSON.stringify({ docId, html, title, savedAt: Date.now() }))
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

// A draft is worth offering only if it's newer than what the server has AND
// actually differs from it.
export const draftIsNewer = (draft, doc) =>
	!!draft && !!doc && draft.savedAt > (doc.updatedAt || 0) && draft.html !== (doc.html || "")
