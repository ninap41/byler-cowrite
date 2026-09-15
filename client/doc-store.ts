// Local crash-cache for the solo editor. This is NOT the save path — the
// server copy is authoritative. We keep the in-progress draft in localStorage
// (every 30s and on a debounce while typing) purely so a crash, a closed tab,
// or a mis-clicked link can't lose work. On load the editor compares savedAt
// against the server's updatedAt and OFFERS to restore rather than silently
// overwriting either side.
// `storage` is injectable so tests don't need a real localStorage.
import type { StorageLike } from "./spectator-names.js"
const KEY = "cowriteDocDraft"

/** A chapter as the draft holds it: no id until the server has minted one. */
export interface DraftChapter {
	id: string | null
	title: string
	html: string
}
export interface Draft {
	docId: string
	title: string
	savedAt: number
	chapters: DraftChapter[]
}
/** What draftIsNewer compares against: the document as the server sent it. */
export interface DraftDoc {
	updatedAt?: number
	html?: string
	chapters?: { id?: string | null; title?: string; html?: string }[]
}

// The draft is the whole chapter list — a rename or a reorder alone is a
// restorable change. A draft written before chapters existed ({html}) is
// read as one untitled chapter with a null id, so nobody loses unsaved work
// across the deploy; the restore maps that null onto the document's first
// chapter.
const chapterList = (v: unknown): DraftChapter[] | null => {
	const o = v as { chapters?: unknown; html?: unknown } | null
	if (Array.isArray(o?.chapters))
		return (o.chapters as Partial<DraftChapter>[]).map((c) => ({ id: c?.id ?? null, title: String(c?.title ?? ""), html: String(c?.html ?? "") }))
	return typeof o?.html === "string" ? [{ id: null, title: "", html: o.html }] : null
}

export function loadDraft(docId: string, storage: StorageLike = localStorage): Draft | null {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null") as Partial<Draft> | null
		if (!v || v.docId !== docId) return null
		const chapters = chapterList(v)
		return chapters ? { docId, title: String(v.title ?? ""), savedAt: Number(v.savedAt ?? 0), chapters } : null
	} catch {
		return null
	}
}

export function saveDraft(docId: string, chapters: Partial<DraftChapter>[] | string | null | undefined, title: string, storage: StorageLike = localStorage): boolean {
	try {
		const list = (Array.isArray(chapters) ? chapters : [{ id: null, title: "", html: String(chapters ?? "") }]).map(
			({ id = null, title = "", html = "" }) => ({ id, title, html }),
		)
		storage.setItem(KEY, JSON.stringify({ docId, chapters: list, title, savedAt: Date.now() }))
		return true
	} catch {
		return false // quota or private mode — the server save still works
	}
}

export function clearDraft(docId: string | null | undefined, storage: StorageLike = localStorage): void {
	try {
		const v = JSON.parse(storage.getItem(KEY) || "null") as { docId?: string } | null
		// only drop the cache if it belongs to this doc
		if (!v || !docId || v.docId === docId) storage.removeItem(KEY)
	} catch {}
}

// The comparable shape of a chapter list: a draft chapter with no id yet
// (never saved, or from a pre-chapter draft) compares by position.
const shape = (chapters: Partial<DraftChapter>[] | null | undefined, doc: DraftDoc | null | undefined): string =>
	JSON.stringify(
		(chapters || []).map((c, i) => ({
			id: c.id ?? doc?.chapters?.[i]?.id ?? null,
			title: c.title || doc?.chapters?.[i]?.title || "",
			html: c.html || "",
		})),
	)

// A draft is worth offering only if it's newer than what the server has AND
// actually differs from it.
export const draftIsNewer = (draft: Partial<Draft> | null | undefined, doc: DraftDoc | null | undefined): boolean => {
	if (!draft || !doc || !((draft.savedAt ?? 0) > (doc.updatedAt || 0))) return false
	const mine = draft.chapters || chapterList(draft)
	const theirs = Array.isArray(doc.chapters) && doc.chapters.length ? doc.chapters : [{ id: null, title: "", html: doc.html || "" }]
	return shape(mine, { chapters: theirs }) !== shape(theirs, { chapters: theirs })
}
