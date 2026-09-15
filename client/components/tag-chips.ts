// Tumblr-style tag editor: a labeled row of compact "#tag" pills with an
// inline add field. Enter adds (trimmed, #-stripped, no empties, no dupes
// case-insensitively), Backspace on an empty field removes the newest tag,
// Escape clears the field (or blurs it when already empty), ✕ removes one
// tag. Every change calls onSave(tags) with the plain (un-#-prefixed) list.
export interface TagEditorOpts {
	tags?: string[]
	onSave: (tags: string[]) => void
}
export interface TagEditor {
	set(tags: string[]): void
}

export function mountTagEditor(root: HTMLElement, { tags = [], onSave }: TagEditorOpts): TagEditor {
	root.innerHTML = ""
	root.classList.add("tag-field")

	const label = document.createElement("p")
	label.className = "tag-label"
	label.textContent = "Tags"

	const help = document.createElement("p")
	help.className = "tag-help"
	help.textContent = "Add tags to help players discover your game (press Enter to add)"

	const row = document.createElement("div")
	row.className = "tag-chips"

	// the add field sits on its own row below the chips
	const add = document.createElement("label")
	add.className = "tag-add"
	add.innerHTML = `<span class="tag-plus" aria-hidden="true">＋</span>`
	const input = document.createElement("input")
	input.placeholder = "Add tag…"
	input.maxLength = 31
	input.setAttribute("aria-label", "Add tag")
	add.appendChild(input)

	// duplicate/invalid feedback — a quiet status line, no alerts
	const msg = document.createElement("p")
	msg.className = "tag-msg"
	msg.setAttribute("role", "status")
	msg.setAttribute("aria-live", "polite")
	let msgTimer: ReturnType<typeof setTimeout> | null = null
	const say = (text: string) => {
		msg.textContent = text
		if (msgTimer) clearTimeout(msgTimer)
		if (text) msgTimer = setTimeout(() => (msg.textContent = ""), 2500)
	}

	root.append(label, help, row, add, msg)

	let cur = [...tags]
	const render = () => {
		row.innerHTML = ""
		row.classList.toggle("hidden", !cur.length)
		cur.forEach((t, i) => {
			const chip = document.createElement("span")
			chip.className = "tag-chip"
			chip.textContent = "#" + t
			const x = document.createElement("button")
			x.type = "button"
			x.textContent = "✕"
			x.setAttribute("aria-label", "Remove " + t)
			x.onclick = () => {
				cur.splice(i, 1)
				render()
				onSave([...cur])
			}
			chip.appendChild(x)
			row.appendChild(chip)
		})
	}

	input.addEventListener("keydown", (e) => {
		if (e.key === "Backspace" && !input.value && cur.length) {
			e.preventDefault()
			say("Removed #" + cur[cur.length - 1])
			cur.pop()
			render()
			onSave([...cur])
			return
		}
		if (e.key === "Escape") {
			if (input.value) input.value = ""
			else input.blur()
			say("")
			return
		}
		if (e.key !== "Enter") return
		e.preventDefault()
		const t = input.value.replace(/^#+/, "").trim().slice(0, 30)
		input.value = ""
		if (!t) return
		if (cur.some((c) => c.toLowerCase() === t.toLowerCase())) return say("Already tagged: #" + t)
		cur.push(t)
		render()
		onSave([...cur])
	})
	input.addEventListener("input", () => say(""))

	render()
	return {
		set: (t) => {
			cur = [...t]
			render()
		},
	}
}
