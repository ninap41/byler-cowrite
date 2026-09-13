// Emoji reactions on chat messages — the Discord shape: a row of counted
// chips under a message, one tap toggles yours. Pure (no DOM, no imports):
// the server (src/game.js) uses REACTIONS + toggleReaction to keep the
// reactions ON the message (`msg.reactions = { emoji: [{key, name}] }`) and
// the client renders them with reactionsHtml. Only PERSON messages react —
// system lines (gimmick calls, joins, badges) carry no `mid` and refuse it.
// Eight to a row, so the picker lays out as a neat grid (see .react-pick).
// Every emoji carries the words a search matches on (`searchReactions`).
export const EMOJI_WORDS = {
	"😀": "grin smile happy", "😂": "joy laugh tears lol", "🤣": "rofl laugh rolling", "😊": "blush smile happy",
	"😍": "heart eyes love", "🥰": "hearts love adore", "😘": "kiss blow love", "😏": "smirk sly",
	"😭": "sob cry loud", "🥺": "pleading puppy eyes beg", "😢": "cry tear sad", "😱": "scream fear shock",
	"😳": "flushed embarrassed blush", "🙄": "eye roll ugh", "😤": "huff triumph steam", "😡": "angry rage mad",
	"🤔": "thinking hmm", "🤨": "raised eyebrow suspicious", "😬": "grimace awkward", "🫠": "melting",
	"🥹": "holding back tears touched", "🤭": "giggle hand over mouth", "🫣": "peeking", "😴": "sleep zzz tired",
	"❤️": "red heart love", "🧡": "orange heart", "💛": "yellow heart", "💚": "green heart",
	"💙": "blue heart", "💜": "purple heart", "🖤": "black heart", "💔": "broken heart",
	"🔥": "fire lit hot", "✨": "sparkles magic", "💀": "skull dead", "👀": "eyes look",
	"💯": "hundred perfect", "🎉": "party tada celebrate", "👑": "crown king queen host", "🌈": "rainbow pride",
	"👍": "thumbs up yes", "👎": "thumbs down no", "👏": "clap applause", "🙌": "raised hands hooray",
	"🤝": "handshake deal", "🫶": "heart hands love", "✍️": "writing hand write", "🙏": "pray please thanks",
	"🚲": "bike bicycle", "📼": "tape vhs mixtape", "🧇": "waffle eggo eleven", "🎲": "dice d20 roll",
	"🕯️": "candle light", "🧭": "compass will", "🌲": "pine tree woods", "🚨": "siren alarm police",
}
export const REACTIONS = Object.keys(EMOJI_WORDS)

// The emoji whose words start with the query's words (every word must hit);
// an empty query is the whole list.
export function searchReactions(q) {
	const words = String(q ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean)
	if (!words.length) return REACTIONS
	return REACTIONS.filter((e) => {
		const have = EMOJI_WORDS[e].split(" ")
		return words.every((w) => have.some((h) => h.startsWith(w)))
	})
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

export const cleanReaction = (e) => (REACTIONS.includes(e) ? e : null)

// Toggle `key`'s reaction `emoji` on the message. Returns true when the
// message changed (a refused emoji, or a system line, changes nothing).
export function toggleReaction(msg, key, name, emoji) {
	if (!msg || msg.sys || !msg.mid || !key) return false
	const e = cleanReaction(emoji)
	if (!e) return false
	msg.reactions ??= {}
	const list = msg.reactions[e] || []
	const i = list.findIndex((r) => r.key === key)
	if (i >= 0) list.splice(i, 1)
	else list.push({ key, name: String(name ?? "") })
	if (list.length) msg.reactions[e] = list
	else delete msg.reactions[e]
	if (!Object.keys(msg.reactions).length) delete msg.reactions
	return true
}

// The chip row: one `.react` per emoji with its count, `.mine` when `myKey`
// is among the reactors, a title naming who reacted. Empty string when none.
export function reactionsHtml(reactions, myKey) {
	const out = []
	for (const e of REACTIONS) {
		const list = reactions?.[e]
		if (!list?.length) continue
		const mine = list.some((r) => r.key === myKey)
		const who = list.map((r) => r.name).filter(Boolean).join(", ")
		out.push(
			`<button type="button" class="react${mine ? " mine" : ""}" data-react="${e}" title="${esc(who)}" aria-pressed="${mine}">` +
				`<span class="react-e">${e}</span><span class="react-n">${list.length}</span></button>`,
		)
	}
	return out.join("")
}

// The picker: every emoji as a button, `.on` for the ones I've already given.
// The picker's grid: every emoji matching `q` (all of them when empty) as a
// button, `.on` for the ones I've already given; a no-match note otherwise.
export const reactionGridHtml = (reactions, myKey, q = "") => {
	const list = searchReactions(q)
	if (!list.length) return `<span class="react-none">No emoji match “${esc(q)}”</span>`
	return list
		.map((e) => {
			const on = (reactions?.[e] || []).some((r) => r.key === myKey)
			return `<button type="button" class="react-opt${on ? " on" : ""}" data-react="${e}" title="${esc(EMOJI_WORDS[e])}" aria-pressed="${on}">${e}</button>`
		})
		.join("")
}
// The whole picker: a search box over the grid.
export const reactionPickerHtml = (reactions, myKey) =>
	`<input type="search" class="react-search" placeholder="Search emoji" aria-label="Search emoji" autocomplete="off">` +
	`<div class="react-grid">${reactionGridHtml(reactions, myKey)}</div>`
