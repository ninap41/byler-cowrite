// Local crash-cache for the solo editor. This is NOT the save path — the
// server copy is authoritative. The in-progress draft goes to localStorage on
// every autosave tick that didn't end in a confirmed save, whenever a save
// fails, and when the tab is hidden or closed — purely so a crash, a closed
// tab, a dead connection or a mis-clicked link can't lose work. A confirmed
// save clears it. On load the editor OFFERS to restore a draft that differs
// from the server's copy rather than silently overwriting either side.
// `storage` is injectable so tests don't need a real localStorage.
import type { StorageLike } from "./spectator-names.js"
// One draft PER STORY (`cowriteDocDraft:<docId>`). It used to be a single slot
// for every story, so typing in a second story overwrote the first one's
// unsaved draft. LEGACY is that old slot: still read (nobody loses a draft
// across the deploy), never written again.
const LEGACY = "cowriteDocDraft"
const keyFor = (docId: string) => `${LEGACY}:${docId}`
// Which stories have a draft, newest first — so the oldest can be dropped
// before localStorage fills up (a storage we can't enumerate through StorageLike).
const INDEX = "cowriteDocDrafts"
export const MAX_DRAFTS = 6

/** A chapter as the draft holds it: no id until the server has minted one. */
export interface DraftChapter {
	id: string | null
	title: string
	html: string
	/** false = the drafting page never edited this chapter, so a restore takes the server's copy of it; absent on older drafts */
	touched?: boolean
}
export interface Draft {
	docId: string
	title: string
	savedAt: number
	/** the save (`doc.rev`) the editor was working from; absent on a draft from before this was recorded */
	baseRev?: number
	chapters: DraftChapter[]
}
/** What draftIsNewer compares against: the document as the server sent it. */
export interface DraftDoc {
	updatedAt?: number
	rev?: number
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
		return (o.chapters as Partial<DraftChapter>[]).map((c) => ({
			id: c?.id ?? null,
			title: String(c?.title ?? ""),
			html: String(c?.html ?? ""),
			...(typeof c?.touched === "boolean" ? { touched: c.touched } : {}),
		}))
	return typeof o?.html === "string" ? [{ id: null, title: "", html: o.html }] : null
}

const readIndex = (storage: StorageLike): string[] => {
	try {
		const v = JSON.parse(storage.getItem(INDEX) || "[]") as unknown
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
	} catch {
		return []
	}
}

export function loadDraft(docId: string, storage: StorageLike = localStorage): Draft | null {
	for (const key of [keyFor(docId), LEGACY]) {
		try {
			const v = JSON.parse(storage.getItem(key) || "null") as Partial<Draft> | null
			if (!v || v.docId !== docId) continue
			const chapters = chapterList(v)
			if (!chapters) continue
			return { docId, title: String(v.title ?? ""), savedAt: Number(v.savedAt ?? 0), ...(typeof v.baseRev === "number" ? { baseRev: v.baseRev } : {}), chapters }
		} catch {
			// unreadable: try the next place, then give up quietly
		}
	}
	return null
}

export function saveDraft(
	docId: string,
	chapters: Partial<DraftChapter>[] | string | null | undefined,
	title: string,
	storage: StorageLike = localStorage,
	baseRev?: number,
): boolean {
	try {
		const list = (Array.isArray(chapters) ? chapters : [{ id: null, title: "", html: String(chapters ?? "") }]).map(
			({ id = null, title = "", html = "", touched }) => ({ id, title, html, ...(typeof touched === "boolean" ? { touched } : {}) }),
		)
		// newest first; whatever falls off the end is the story you drafted longest ago
		const index = [docId, ...readIndex(storage).filter((id) => id !== docId)]
		for (const old of index.slice(MAX_DRAFTS)) storage.removeItem(keyFor(old))
		storage.setItem(INDEX, JSON.stringify(index.slice(0, MAX_DRAFTS)))
		storage.setItem(keyFor(docId), JSON.stringify({ docId, chapters: list, title, savedAt: Date.now(), ...(typeof baseRev === "number" ? { baseRev } : {}) }))
		return true
	} catch {
		return false // quota or private mode — the server save still works
	}
}

export function clearDraft(docId: string | null | undefined, storage: StorageLike = localStorage): void {
	try {
		if (docId) {
			storage.removeItem(keyFor(docId))
			storage.setItem(INDEX, JSON.stringify(readIndex(storage).filter((id) => id !== docId)))
		}
		const v = JSON.parse(storage.getItem(LEGACY) || "null") as { docId?: string } | null
		// the old single slot goes only if it belongs to this doc (or to nothing)
		if (!v || !docId || v.docId === docId) storage.removeItem(LEGACY)
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

// A draft is worth offering only if it actually differs from what the server
// has. A successful save CLEARS the draft, so one that is still here holds
// words the server never confirmed — that is the whole test for a draft that
// recorded its `baseRev`. It must NOT be compared with `doc.updatedAt`:
// comments, sprints and invitations all stamp that, so a beta reader's note
// arriving after a crash used to make a good draft look old, and it was never
// offered. Only a draft from before `baseRev` existed still uses the clock.
export const draftIsNewer = (draft: Partial<Draft> | null | undefined, doc: DraftDoc | null | undefined): boolean => {
	if (!draft || !doc) return false
	if (typeof draft.baseRev !== "number" && !((draft.savedAt ?? 0) > (doc.updatedAt || 0))) return false
	// a chapter this page never edited isn't a difference: the restore takes the server's copy of it
	const byId = new Map((doc.chapters || []).map((c) => [c.id, c]))
	const mine = (draft.chapters || chapterList(draft) || []).map((c) => (c.touched === false && c.id && byId.has(c.id) ? { ...c, html: byId.get(c.id)!.html || "" } : c))
	const theirs = Array.isArray(doc.chapters) && doc.chapters.length ? doc.chapters : [{ id: null, title: "", html: doc.html || "" }]
	return shape(mine, { chapters: theirs }) !== shape(theirs, { chapters: theirs })
}
