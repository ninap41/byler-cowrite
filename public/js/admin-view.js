// Row builders for the admin page. Pure string functions, like the other
// *-view modules: everything user-supplied is esc()'d, and the buttons carry
// their action in data-* so one delegated listener can drive the whole page.
import { esc } from "./util.js"

const DAY = 86_400_000

// "3 days ago" is what a moderator is actually judging inactivity on, so lead
// with the gap and keep the exact date as the tooltip.
export function agoLabel(ts, now) {
	if (!ts) return "never signed in"
	const d = Math.floor((now - ts) / DAY)
	if (d <= 0) return "today"
	if (d === 1) return "yesterday"
	if (d < 30) return `${d} days ago`
	const m = Math.floor(d / 30)
	return m < 12 ? `${m} month${m === 1 ? "" : "s"} ago` : `${Math.floor(d / 365)}y ago`
}

const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unknown")

export function adminGamesHtml(games) {
	const live = (games || []).filter((g) => g.phase !== "over")
	if (!live.length) return `<p class="subtle" style="text-align:left">No games are running right now.</p>`
	return live
		.map(
			(g) =>
				`<div class="row" style="justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">` +
				`<span><strong>${esc(g.name) || esc(g.code)}</strong> ` +
				`<span class="gc-meta" style="display:inline">${esc(g.code)} · ${esc(g.phase)} · ` +
				`${g.players} writer${g.players === 1 ? "" : "s"} · ${g.lines} line${g.lines === 1 ? "" : "s"}` +
				(g.hostName ? ` · host ${esc(g.hostName)}` : "") +
				`</span></span>` +
				`<span class="row" style="gap:8px;flex:none">` +
				`<a class="ghost" style="text-decoration:none;padding:8px 12px;border-radius:10px" href="/game?code=${encodeURIComponent(g.code)}">Join</a>` +
				`<button class="ghost" data-admin-act="end" data-admin-target="${esc(g.code)}">End</button>` +
				`<button class="ghost danger" data-admin-act="delete-game" data-admin-target="${esc(g.code)}">Delete</button>` +
				`</span></div>`,
		)
		.join("")
}

// The accounts search: username or email, case-insensitive substring. Pure,
// so the page can re-filter the last fetch on every keystroke.
export function filterAdminUsers(users, query) {
	const q = String(query || "").trim().toLowerCase()
	if (!q) return users || []
	return (users || []).filter((u) => String(u.username || "").toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q))
}

// "12 of 40 accounts" while a search narrows the list, "40 accounts" otherwise.
export function adminUserCount(shown, total) {
	const n = `${total} account${total === 1 ? "" : "s"}`
	return shown === total ? n : `${shown} of ${n}`
}

export function adminUsersHtml(users, now) {
	if (!users || !users.length) return `<p class="subtle" style="text-align:left">No accounts match.</p>`
	return users
		.map(
			(u) =>
				`<div class="row" style="justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">` +
				`<span><strong>${esc(u.username)}</strong>${u.admin ? ' <span class="host-tag">admin</span>' : ""}` +
				(u.online ? ' <span class="host-tag">online</span>' : "") +
				`<br /><span class="gc-meta" style="display:inline" data-tip="${esc(when(u.lastSeen))}">${esc(u.email)} · ` +
				`${esc(agoLabel(u.lastSeen, now))} · ${u.wordCount} words · ${u.games} game${u.games === 1 ? "" : "s"}</span></span>` +
				(u.admin
					? `<span class="gc-meta" style="flex:none">protected</span>`
					: `<button class="ghost danger" style="flex:none" data-admin-act="delete-user" data-admin-target="${esc(u.username)}">Remove</button>`) +
				`</div>`,
		)
		.join("")
}

// ---- The prompt library editor ------------------------------------------
// Every pool of content/prompts.json as an editable table, and the reverse:
// read the tables back into the document the server validates as one piece.
// Pure string builders + one DOM reader, so jsdom can round-trip them.

// What each pool is, in the order the editor shows them. `path` walks the
// document; `kind` decides the row shape: "strings" is one per line in a
// textarea, "items" is a table of {id,label,weight,…}.
export const PROMPT_POOLS = [
	{ path: ["prompts"], title: "Curated scenarios (Simple mode)", kind: "strings", hint: "One scenario per line, dealt untouched." },
	{ path: ["intermediate", "characters"], title: "Characters", kind: "strings", hint: "Who a role can land on (\"power bottom (Will)\")." },
	{ path: ["intermediate", "seasons"], title: "Seasons", kind: "items", fields: ["ageGroup"] },
	{ path: ["intermediate", "canon"], title: "Canon", kind: "items" },
	{ path: ["intermediate", "places"], title: "Places (canon)", kind: "items" },
	{ path: ["intermediate", "situations"], title: "Situations", kind: "items" },
	{ path: ["intermediate", "relationships"], title: "Relationships", kind: "items" },
	{ path: ["intermediate", "tones"], title: "Tones", kind: "items" },
	{ path: ["intermediate", "tropes"], title: "Tropes", kind: "items", fields: ["group"], hint: "Every trope but the AU worlds — those have their own section below, with their places." },
	{ path: ["intermediate", "explicit", "levels"], title: "Explicit · levels", kind: "items" },
	{ path: ["intermediate", "explicit", "setups"], title: "Explicit · setups", kind: "items", fields: ["who"] },
	{ path: ["intermediate", "explicit", "dynamics"], title: "Explicit · dynamics", kind: "items", fields: ["who", "only"] },
	{ path: ["intermediate", "explicit", "acts"], title: "Explicit · acts", kind: "items" },
	{ path: ["intermediate", "explicit", "kinks"], title: "Explicit · kinks (weighted)", kind: "items" },
	{ path: ["intermediate", "explicit", "registers"], title: "Explicit · registers", kind: "items" },
	{ path: ["intermediate", "explicit", "twists"], title: "Explicit · ridiculous twists (one in five)", kind: "items" },
]
// The columns every item row carries; everything else an entry holds
// (tags, compatibleAgeGroups, compatibleCanon, requiresTags…) is edited as
// a JSON "rules" cell so no rule is lost for want of a column.
const ROW_KEYS = ["id", "label", "text", "weight"]
const poolKey = (pool) => pool.path.join(".")
const getIn = (doc, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), doc)
const setIn = (doc, path, v) => {
	let o = doc
	for (const k of path.slice(0, -1)) o = o[k] ??= {}
	o[path.at(-1)] = v
}

// "Power bottom" -> "power-bottom": a new row's id, from its label.
export function slugId(label) {
	return String(label || "")
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function rulesOf(item, pool) {
	const skip = new Set([...ROW_KEYS, ...(pool.fields || [])])
	const rest = Object.fromEntries(Object.entries(item).filter(([k]) => !skip.has(k)))
	return Object.keys(rest).length ? JSON.stringify(rest) : ""
}

export function promptRowHtml(item, pool, groups = {}) {
	const extra = (pool.fields || [])
		.map((f) => {
			if (f === "group")
				return `<td><select data-field="group">${Object.entries(groups)
					.map(([id, label]) => `<option value="${esc(id)}"${id === item.group ? " selected" : ""}>${esc(label)}</option>`)
					.join("")}</select></td>`
			if (f === "ageGroup")
				return `<td><select data-field="ageGroup">${["minor", "adult"]
					.map((g) => `<option value="${g}"${g === item.ageGroup ? " selected" : ""}>${g}</option>`)
					.join("")}</select></td>`
			if (f === "only")
				return `<td><input data-field="only" value="${esc(item.only ?? "")}" placeholder="either" size="6" /></td>`
			return `<td><input data-field="${esc(f)}" value="${esc(item[f] ?? "")}" placeholder="{name} is…" /></td>`
		})
		.join("")
	return `<tr class="pe-row" data-id="${esc(item.id || "")}">
	<td><input data-field="label" value="${esc(item.label ?? "")}" required /></td>
	<td><input data-field="weight" type="number" min="0.05" step="0.5" value="${esc(item.weight ?? "")}" placeholder="1" /></td>
	${extra}
	<td><input data-field="rules" class="pe-rules" value="${esc(rulesOf(item, pool))}" placeholder='{"tags":[…]}' /></td>
	<td><button type="button" class="ghost pe-del" title="Remove">✕</button></td>
</tr>`
}

export function promptPoolHtml(pool, doc) {
	const key = poolKey(pool)
	let list = getIn(doc, pool.path) || []
	if (key === "intermediate.tropes") list = list.filter((t) => t.group !== "setting-au")
	if (pool.kind === "strings")
		return `<details class="pe-pool" data-pool="${esc(key)}"><summary>${esc(pool.title)} <span class="subtle">(${list.length})</span></summary>
	<p class="subtle">${esc(pool.hint || "")}</p>
	<textarea class="pe-lines" rows="${Math.min(14, Math.max(3, list.length + 1))}">${esc(list.join("\n"))}</textarea>
</details>`
	const groups = doc.intermediate?.tropeGroups || {}
	const heads = ["Label", "Weight", ...(pool.fields || []).map((f) => ({ group: "Group", ageGroup: "Age", who: "Role (who)", only: "Always" })[f] || f), "Rules (JSON)", ""]
	return `<details class="pe-pool" data-pool="${esc(key)}"><summary>${esc(pool.title)} <span class="subtle">(${list.length})</span></summary>
	<p class="subtle">${esc(pool.hint || "Label is what the menus and prompt show; weight biases the draw (blank = 1); rules is the entry's other fields as JSON — tags, compatibleAgeGroups, compatibleCanon, requiresTags, incompatibleTags, adultOnly.")}</p>
	<table class="pe-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
	<tbody>${list.map((it) => promptRowHtml(it, pool, groups)).join("")}</tbody></table>
	<button type="button" class="ghost pe-add">+ Add</button>
</details>`
}

// The tags the GENERATOR itself puts into play (they're not authored on an
// entry; the draw adds them as it goes), with what each one means.
export const BUILTIN_TAGS = {
	explicit: "added when the rating came out explicit — a tone that lists it in incompatibleTags (fluff, crack) steps aside",
	"no-explicit": "a tone that carries it forces an explicit request down to suggestive",
}

// Every tag the library actually uses, with the entries that carry it, so
// the rules cell is written against a real vocabulary rather than guessed.
export function tagIndex(doc) {
	const idx = new Map()
	const add = (tag, where) => idx.set(tag, [...(idx.get(tag) || []), where])
	const walk = (list, name) => {
		for (const it of list || []) for (const t of it.tags || []) add(t, `${name}: ${it.label}`)
	}
	const im = doc.intermediate || {}
	for (const k of ["seasons", "canon", "places", "situations", "relationships", "tones", "tropes"]) walk(im[k], k)
	for (const k of ["levels", "setups", "dynamics", "acts", "kinks", "registers"]) walk(im.explicit?.[k], "explicit " + k)
	return [...idx.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// The rules reference at the head of the editor: what a row's fields mean,
// how the draw runs, and the tag vocabulary this library uses.
export function promptRulesHtml(doc) {
	const row = (k, v) => `<tr><td><code>${esc(k)}</code></td><td>${v}</td></tr>`
	const tags = tagIndex(doc)
	return `<details class="pe-pool pe-doc" data-doc="1"><summary>📖 How the rules work — fields, tags, and the order of the draw</summary>
	<h4>Every row</h4>
	<table class="pe-doc-table">
	${row("Label", "what the menus, chips and prompt show. The clause text is the label lowercased (an existing row keeps a custom clause if you don't change its label).")}
	${row("Weight", "how often it's drawn — 1 is normal, 5 is five times as likely, blank is 1. Ids dealt earlier on the same ballot are damped (÷3), not banned.")}
	${row("Rules (JSON)", "the entry's other fields, as one JSON object. Example: <code>{&quot;tags&quot;:[&quot;fantasy&quot;],&quot;compatibleAgeGroups&quot;:[&quot;adult&quot;]}</code>")}
	</table>
	<h4>What Rules can hold</h4>
	<table class="pe-doc-table">
	${row("tags", "strings this entry <em>puts into play</em> once drawn. Later draws check their rules against everything in play so far.")}
	${row("requiresTags", "draw this only if <em>every</em> listed tag is already in play (Cleradin's tropes: <code>[&quot;cleradin&quot;]</code>; domestic bliss: <code>[&quot;together&quot;]</code>).")}
	${row("incompatibleTags", "never draw this if <em>any</em> listed tag is in play (a phone call in a fantasy world: <code>[&quot;fantasy&quot;]</code>; a first kiss on a couple: <code>[&quot;together&quot;]</code>).")}
	${row("compatibleAgeGroups", "<code>[&quot;minor&quot;]</code> or <code>[&quot;adult&quot;]</code> — the season's age group must match. Age comes from the season, nowhere else.")}
	${row("adultOnly", "<code>true</code> — never on a minor season, whatever else says. The explicit level carries it.")}
	${row("compatibleCanon", "which canon ids admit this — every world is <code>[&quot;au&quot;]</code>, fix-it is <code>[&quot;canon-divergent&quot;]</code>.")}
	${row("who", "explicit dynamics/setups only — names the role: <code>&quot;{name} is the brat&quot;</code> renders <em>brat taming (Will is the brat)</em>. Has its own column.")}
	${row("only", "explicit dynamics only — the one character the role always lands on (service top: <code>Mike</code>). The <em>Always</em> column.")}
	${row("group", "tropes only — must be one of the Trope groups below. <code>setting-au</code> entries are worlds: an AU draws one onto the Canon line and skips the Place.")}
	${row("ageGroup", "seasons only — <code>minor</code> or <code>adult</code>. Only an adult season can be explicit.")}
	</table>
	<h4>The order of the draw</h4>
	<ol class="pe-doc-list">
	<li><b>Season</b> — fixes the age. Explicit on a Random season narrows to adult seasons; a chosen minor season is kept and the rating drops to suggestive.</li>
	<li><b>Canon</b> — in an AU, one world from <code>setting-au</code> (its tags go into play — <code>fantasy</code>, <code>cleradin</code>…); Place is then skipped.</li>
	<li><b>Relationship</b>, <b>Situation</b>, <b>Tone</b> — each checked against the tags in play (<code>explicit</code> is in play by now if the rating is explicit).</li>
	<li><b>Trope</b> — exactly one, from every group but the worlds.</li>
	<li><b>Place</b> — only when no world was drawn.</li>
	<li><b>Explicit layer</b> — adult season and rating explicit only: setup · dynamic · 1–2 acts · 1–2 kinks · register on one Kinks line, roles naming a character.</li>
	</ol>
	<h4>Tags in this library</h4>
	<p class="subtle">Authored on entries (with who carries them), plus the two the generator adds itself. Any new string is a valid tag — it only means something once another entry requires or excludes it.</p>
	<table class="pe-doc-table">
	${Object.entries(BUILTIN_TAGS).map(([t, d]) => row(t, `<em>generator</em> — ${esc(d)}`)).join("")}
	${tags.map(([t, where]) => row(t, esc(where.length > 6 ? where.slice(0, 6).join(", ") + ` … (${where.length})` : where.join(", ")))).join("")}
	</table>
</details>`
}

export function promptEditorHtml(doc) {
	const groups = doc.intermediate?.tropeGroups || {}
	return `<div class="pe" id="promptEditor">
	${promptRulesHtml(doc)}
	${PROMPT_POOLS.filter((p) => getIn(doc, p.path) !== undefined || p.path[0] === "prompts").map((p) => promptPoolHtml(p, doc)).join("")}
	${auWorldsHtml(doc)}
	<details class="pe-pool" data-pool="intermediate.tropeGroups"><summary>Trope groups <span class="subtle">(${Object.keys(groups).length})</span></summary>
	<p class="subtle">id = name, one per line. A trope's group must be named here; the "setting-au" group is the worlds an AU draws from.</p>
	<textarea class="pe-lines" rows="${Object.keys(groups).length + 1}">${esc(Object.entries(groups).map(([k, v]) => `${k} = ${v}`).join("\n"))}</textarea>
</details>
	<div class="pe-foot"><button type="button" class="primary" id="promptSave">Save library</button><span class="subtle" id="promptStatus"></span></div>
</div>`
}

// Read the editor back into a document. `base` is the document the editor
// was built from: pools the editor doesn't show (nothing, today) carry over,
// and an existing row keeps its id so nothing that references it breaks.
export function readPromptEditor(root, base) {
	const doc = JSON.parse(JSON.stringify(base || {}))
	const errors = []
	for (const el of root.querySelectorAll(".pe-pool")) {
		if (el.dataset.doc) continue // the rules reference holds no data
		const key = el.dataset.pool
		if (key === "au-worlds" || el.closest(".au-world")) continue // read below, as one piece
		const path = key.split(".")
		const ta = el.querySelector(".pe-lines")
		if (key === "intermediate.tropeGroups") {
			const groups = {}
			for (const line of ta.value.split("\n")) {
				const m = line.match(/^\s*([a-z0-9-]+)\s*=\s*(.+?)\s*$/)
				if (m) groups[m[1]] = m[2]
				else if (line.trim()) errors.push(`trope groups: "${line.trim()}" isn't "id = Name"`)
			}
			setIn(doc, path, groups)
			continue
		}
		if (ta) {
			setIn(doc, path, ta.value.split("\n").map((l) => l.trim()).filter(Boolean))
			continue
		}
		const pool = PROMPT_POOLS.find((p) => poolKey(p) === key)
		const items = []
		for (const tr of el.querySelectorAll(".pe-row")) {
			const val = (f) => tr.querySelector(`[data-field="${f}"]`)?.value ?? ""
			const label = val("label").trim()
			if (!label) continue
			// an existing row whose label didn't change keeps its own clause text
			// (a few entries phrase it differently from the label); otherwise the
			// clause is the label, lowercased
			const prev = tr.dataset.id ? (getIn(base, path) || []).find((x) => x.id === tr.dataset.id) : null
			const item = { id: tr.dataset.id || slugId(label), label, text: prev && prev.label === label && prev.text ? prev.text : label.toLowerCase() }
			const w = Number(val("weight"))
			if (val("weight").trim() && w > 0) item.weight = w
			for (const f of pool?.fields || []) if (val(f).trim()) item[f] = val(f).trim()
			const rules = val("rules").trim()
			if (rules) {
				try {
					const parsed = JSON.parse(rules)
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
					for (const k of ROW_KEYS) delete parsed[k]
					Object.assign(item, parsed)
				} catch {
					errors.push(`${key} / ${label}: rules must be a JSON object`)
				}
			}
			items.push(item)
		}
		setIn(doc, path, items)
	}
	// AU worlds ride the trope bank (group setting-au) and own auPlaces
	const au = readAuWorlds(root, base)
	errors.push(...au.errors)
	doc.intermediate ??= {}
	// keep the bank's original order: worlds go back where they were, new
	// rows (from either section) follow in their own order
	const table = (doc.intermediate.tropes || []).filter((t) => t.group !== "setting-au")
	const byId = new Map([...table, ...au.worlds].map((t) => [t.id, t]))
	const ordered = []
	for (const t of base?.intermediate?.tropes || []) if (byId.has(t.id)) { ordered.push(byId.get(t.id)); byId.delete(t.id) }
	for (const t of [...table, ...au.worlds]) if (byId.has(t.id)) { ordered.push(t); byId.delete(t.id) }
	doc.intermediate.tropes = ordered
	doc.intermediate.auPlaces = au.places
	return { doc, errors }
}

// ---- AU worlds ----
// One block per world: its label/weight/rules, and its places as two
// textareas — everyday rooms, and rooms only an explicit ballot deals. Each
// place becomes an auPlaces entry keyed by the world's own au-<id> tag; the
// explicit ones also require "explicit" and are adultOnly.
export const worldTag = (id) => "au-" + id
const worldPlaces = (doc, id) => {
	const plain = [], explicit = []
	for (const p of doc.intermediate?.auPlaces || []) {
		if (!(p.requiresTags || []).includes(worldTag(id))) continue
		;((p.requiresTags || []).includes("explicit") ? explicit : plain).push(p.text || p.label)
	}
	return { plain, explicit }
}
export function auWorldHtml(world, doc) {
	const { plain, explicit } = worldPlaces(doc, world.id)
	const rules = Object.fromEntries(Object.entries(world).filter(([k]) => !["id", "label", "text", "weight", "group", "tags"].includes(k)))
	const tags = (world.tags || []).filter((t) => t !== worldTag(world.id))
	if (tags.length) rules.tags = tags
	return `<details class="pe-pool au-world" data-id="${esc(world.id)}"><summary>${esc(world.label)} <span class="subtle">(${plain.length} places · ${explicit.length} explicit)</span></summary>
	<div class="au-head">
		<label>Label <input data-field="label" value="${esc(world.label)}" required /></label>
		<label>Weight <input data-field="weight" type="number" min="0.05" step="0.5" value="${esc(world.weight ?? "")}" placeholder="1" /></label>
		<label>Rules (JSON) <input data-field="rules" class="pe-rules" value="${esc(Object.keys(rules).length ? JSON.stringify(rules) : "")}" placeholder='{"tags":["fantasy"]}' /></label>
		<button type="button" class="ghost au-del" title="Remove this world and its places">✕ Remove world</button>
	</div>
	<label class="au-lbl">Places</label>
	<textarea class="pe-lines au-plain" rows="${Math.min(12, Math.max(3, plain.length + 1))}">${esc(plain.join("\n"))}</textarea>
	<label class="au-lbl">Explicit places</label>
	<textarea class="pe-lines au-explicit" rows="${Math.min(12, Math.max(3, explicit.length + 1))}">${esc(explicit.join("\n"))}</textarea>
</details>`
}
export function auWorldsHtml(doc) {
	const worlds = (doc.intermediate?.tropes || []).filter((t) => t.group === "setting-au")
	return `<details class="pe-pool" data-pool="au-worlds"><summary>AU worlds <span class="subtle">(${worlds.length})</span></summary>
	<p class="subtle">The worlds an Alternate-universe ballot draws from, each with its own places. A world's tag (au-&lt;id&gt;) is added for you; put other tags (fantasy, no explicit → {"incompatibleTags":["explicit"]}) in Rules.</p>
	<div class="au-list">${worlds.map((w) => auWorldHtml(w, doc)).join("")}</div>
	<div class="re-addrow"><input class="au-newlabel" placeholder="New world, e.g. Pirate ship" maxlength="60" /><button type="button" class="ghost au-add">+ Add world</button></div>
</details>`
}
const placeId = (wid, text, explicit) =>
	("au-" + wid + "-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).slice(0, 70) + (explicit ? "-x" : "")
export function readAuWorlds(root, base) {
	const worlds = [], places = [], errors = [], ids = new Set()
	const prevWorlds = (base?.intermediate?.tropes || []).filter((t) => t.group === "setting-au")
	for (const el of root.querySelectorAll(".au-world")) {
		const val = (f) => el.querySelector(`[data-field="${f}"]`)?.value ?? ""
		const label = val("label").trim()
		if (!label) continue
		const id = el.dataset.id || slugId(label)
		const prev = prevWorlds.find((w) => w.id === id)
		const world = { id, label, text: prev && prev.label === label && prev.text ? prev.text : label.toLowerCase(), group: "setting-au", compatibleCanon: ["au"] }
		const w = Number(val("weight"))
		if (val("weight").trim() && w > 0) world.weight = w
		const rules = val("rules").trim()
		if (rules) {
			try {
				const parsed = JSON.parse(rules)
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
				for (const k of ["id", "label", "text", "weight", "group"]) delete parsed[k]
				Object.assign(world, parsed)
			} catch {
				errors.push(`AU world ${label}: rules must be a JSON object`)
			}
		}
		world.tags = [...new Set([...(world.tags || []), worldTag(id)])]
		worlds.push(world)
		const lines = (cls) => el.querySelector(cls).value.split("\n").map((l) => l.trim()).filter(Boolean)
		const push = (list, explicit) => {
			for (const text of list) {
				let pid = placeId(id, text, explicit), n = 2
				while (ids.has(pid)) pid = placeId(id, text, explicit) + "-" + n++
				ids.add(pid)
				const p = { id: pid, label: text, text, requiresTags: explicit ? [worldTag(id), "explicit"] : [worldTag(id)] }
				if (explicit) p.adultOnly = true
				places.push(p)
			}
		}
		push(lines(".au-plain"), false)
		push(lines(".au-explicit"), true)
	}
	return { worlds, places, errors }
}

// ---- Writers' reference editor ----
// The "/" palette's word bank, one <details> per group (dialogue tags, action
// verbs…) with one textarea per CATEGORY, a word per line. A category emptied
// is a category removed; the "+ Add category" row names a new one. Each
// group saves on its own — they're separate files, and a slip in one
// shouldn't hold the others hostage.
export const refKey = (s) =>
	String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 60)

export function refCategoryHtml(cat) {
	const words = cat.words || []
	return `<div class="re-cat" data-key="${esc(cat.key)}">
	<label class="re-cat-head"><b>${esc(cat.label || cat.key)}</b> <code class="subtle">${esc(cat.key)}</code> <span class="subtle re-count">(${words.length})</span>
	<button type="button" class="ghost re-del" title="Remove this category">✕</button></label>
	<textarea class="pe-lines re-words" rows="${Math.min(10, Math.max(3, words.length + 1))}">${esc(words.join("\n"))}</textarea>
</div>`
}

export function refGroupHtml(g) {
	const n = (g.categories || []).reduce((a, c) => a + (c.words || []).length, 0)
	return `<details class="pe-pool re-group" data-slug="${esc(g.slug)}"><summary>${esc(g.label)} <code class="subtle">${esc(g.prefix)}</code> <span class="subtle">(${(g.categories || []).length} categories · ${n} words)</span></summary>
	<p class="subtle">${esc(g.desc || "")}</p>
	<div class="re-cats">${(g.categories || []).map(refCategoryHtml).join("")}</div>
	<div class="re-addrow"><input class="re-newkey" placeholder="New category, e.g. Nervous habits" maxlength="60"><button type="button" class="ghost re-add">+ Add category</button></div>
	<div class="pe-foot"><button type="button" class="primary re-save">Save ${esc(g.label)}</button><span class="subtle re-status"></span></div>
</details>`
}

export const refEditorHtml = (bundle) =>
	`<div class="pe" id="refEditor">${(bundle?.groups || []).length ? bundle.groups.map(refGroupHtml).join("") : `<p class="subtle">No reference groups are loaded.</p>`}</div>`

// Read one group's editor back: [{key, words}], empties dropped so an emptied
// textarea deletes its category on save.
export function readRefGroup(groupEl) {
	const categories = []
	const errors = []
	for (const cat of groupEl.querySelectorAll(".re-cat")) {
		const key = cat.dataset.key
		if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key)) errors.push(`"${key}" isn't a valid category key.`)
		const words = cat.querySelector(".re-words").value.split("\n").map((w) => w.trim()).filter(Boolean)
		if (words.length) categories.push({ key, words })
	}
	if (!categories.length) errors.push("A group needs at least one category with words.")
	return { categories, errors }
}
