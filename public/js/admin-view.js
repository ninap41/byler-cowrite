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

export function adminUsersHtml(users, now) {
	if (!users || !users.length) return `<p class="subtle" style="text-align:left">No accounts yet.</p>`
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
	{ path: ["intermediate", "places"], title: "Places", kind: "items" },
	{ path: ["intermediate", "situations"], title: "Situations", kind: "items" },
	{ path: ["intermediate", "relationships"], title: "Relationships", kind: "items" },
	{ path: ["intermediate", "tones"], title: "Tones", kind: "items" },
	{ path: ["intermediate", "tropes"], title: "Tropes", kind: "items", fields: ["group"] },
	{ path: ["intermediate", "explicit", "levels"], title: "Explicit · levels", kind: "items" },
	{ path: ["intermediate", "explicit", "setups"], title: "Explicit · setups", kind: "items", fields: ["who"] },
	{ path: ["intermediate", "explicit", "dynamics"], title: "Explicit · dynamics", kind: "items", fields: ["who", "only"] },
	{ path: ["intermediate", "explicit", "acts"], title: "Explicit · acts", kind: "items" },
	{ path: ["intermediate", "explicit", "kinks"], title: "Explicit · kinks (weighted)", kind: "items" },
	{ path: ["intermediate", "explicit", "registers"], title: "Explicit · registers", kind: "items" },
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
	const list = getIn(doc, pool.path) || []
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

export function promptEditorHtml(doc) {
	const groups = doc.intermediate?.tropeGroups || {}
	return `<div class="pe" id="promptEditor">
	${PROMPT_POOLS.filter((p) => getIn(doc, p.path) !== undefined || p.path[0] === "prompts").map((p) => promptPoolHtml(p, doc)).join("")}
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
		const key = el.dataset.pool
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
	return { doc, errors }
}
