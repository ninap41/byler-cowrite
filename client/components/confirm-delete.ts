// A confirmation in the site's own shape (.confirm-modal / .confirm-card,
// like the archive's and the dashboard's), mounted once per page, lazily,
// and answered as a promise: true on the confirm button, false on Cancel,
// Escape or the backdrop. confirmDialog() is the general form; the inbox's
// delete is one wording of it, and any list that deletes may use either.
export const CONFIRM_MODAL = `<div class="confirm-modal hidden" id="ibDelModal">
	<div class="confirm-card">
		<h3 id="ibDelTitle">Delete this message?</h3>
		<p class="subtle" style="text-align: left" id="ibDelText">It leaves your inbox for good.</p>
		<div class="row">
			<button class="ghost" id="ibDelCancel">Cancel</button>
			<button class="primary danger" id="ibDelConfirm">Delete</button>
		</div>
	</div>
</div>`
export const INBOX_DEL_MODAL = CONFIRM_MODAL

export interface ConfirmOpts {
	title?: string
	text?: string
	confirmLabel?: string
	danger?: boolean
	doc?: Document
}

const byId = (doc: Document, id: string): HTMLElement => {
	const el = doc.getElementById(id)
	if (!el) throw new Error("confirm modal is missing #" + id)
	return el
}

export function confirmDialog({ title = "Are you sure?", text = "", confirmLabel = "Delete", danger = true, doc = document }: ConfirmOpts = {}): Promise<boolean> {
	if (!doc.getElementById("ibDelModal")) doc.body.insertAdjacentHTML("beforeend", CONFIRM_MODAL)
	const modal = byId(doc, "ibDelModal")
	byId(doc, "ibDelTitle").textContent = title
	byId(doc, "ibDelText").textContent = text
	const ok = byId(doc, "ibDelConfirm")
	const cancel = byId(doc, "ibDelCancel")
	ok.textContent = confirmLabel
	ok.className = danger ? "primary danger" : "primary"
	modal.classList.remove("hidden")
	return new Promise((resolve) => {
		const done = (v: boolean) => {
			modal.classList.add("hidden")
			cancel.onclick = null
			ok.onclick = null
			modal.onclick = null
			doc.removeEventListener("keydown", onKey)
			resolve(v)
		}
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && done(false)
		cancel.onclick = () => done(false)
		ok.onclick = () => done(true)
		modal.onclick = (e) => e.target === modal && done(false)
		doc.addEventListener("keydown", onKey)
	})
}

export interface ConfirmInboxOpts {
	conversation?: boolean
	count?: number
	doc?: Document
}
/** The inbox's wording of confirmDialog: one message, or a whole conversation. */
export const confirmInboxDelete = ({ conversation = false, count = 1, doc = document }: ConfirmInboxOpts = {}): Promise<boolean> =>
	confirmDialog({
		title: conversation ? "Delete this conversation?" : "Delete this message?",
		text: conversation ? `All ${count} messages in it leave your inbox for good, the other person keeps their copy.` : "It leaves your inbox for good.",
		confirmLabel: "Delete",
		doc,
	})
