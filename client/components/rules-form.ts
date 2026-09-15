// Shared game-rules form: one markup + behavior source for the lobby start
// controls, the in-game Host controls panel, and the game-over continue panel.
//
// Row 1: story-mode dropdown + a description of friendly vs non-friendly.
// Row 2: four inline inputs — ♾ infinite checkbox, rounds number,
//        ⏱ no-timer checkbox, seconds number.
//
// Checking infinite sets rounds to 0 and disables the input (the round limit
// is off for that game) rather than hiding it; no-timer likewise disables the
// seconds input. Callers pass their own element ids so labels, the live
// game-state sync, and the continue-locked selector all keep working.

// Each sentence is tagged with its mode so the CSS can spotlight the one the
// dropdown currently selects (the form carries data-mode="friendly|hostile").
const MODE_DESC =
	'<span class="rmode-desc" data-desc="friendly"><b>Friendly mode</b> disables gimmicks.</span><br> ' +
	'<span class="rmode-desc" data-desc="hostile"><b>Non-friendly mode</b> allows other writers to distract players with their gimmicks.</span>'

export interface RulesIds {
	mode: string
	endless: string
	rounds: string
	noTimer: string
	secs: string
}
export interface RulesFormOpts {
	ids: RulesIds
	seconds?: number
	rounds?: number
	roundsLabel?: string
	roundsMin?: number
	roundsMax?: number
	roundsPlaceholder?: string
}
/** The payload every socket rules event wants (numbers still as the inputs' strings). */
export interface RulesValues {
	turnSeconds: number | string
	rounds: number | string
	friendly: boolean
}
export interface RulesForm {
	el: { mode: HTMLSelectElement; endless: HTMLInputElement; rounds: HTMLInputElement; noTimer: HTMLInputElement; secs: HTMLInputElement }
	sync(): void
	infinite(): boolean
	values(): RulesValues
	set(v?: { turnSeconds?: number; friendly?: boolean }): void
}

export function mountRulesForm(container: HTMLElement, opts: RulesFormOpts): RulesForm {
	const { ids, seconds = 60, rounds = 3, roundsLabel = "Rounds", roundsMin = 0, roundsMax = 50, roundsPlaceholder = "" } = opts

	container.classList.add("rules-form")
	container.innerHTML = `<div class="rules-mode-row">
			<div class="rules-mode-pick">
				<label for="${ids.mode}">Story mode</label>
				<select id="${ids.mode}">
					<option value="1" selected>💛 Friendly</option>
					<option value="0">🌶 Non-friendly</option>
				</select>
			</div>
			<p class="rules-mode-desc">${MODE_DESC}</p>
		</div>
		<div class="rules-inline-row">
			<label class="checkline"><input type="checkbox" id="${ids.endless}" /> ♾ Infinite</label>
			<div class="rules-num">
				<label for="${ids.rounds}">${roundsLabel}</label>
				<input id="${ids.rounds}" type="number" min="${roundsMin}" max="${roundsMax}"
					${roundsPlaceholder ? `placeholder="${roundsPlaceholder}"` : `value="${rounds}"`} />
			</div>
			<label class="checkline"><input type="checkbox" id="${ids.noTimer}" /> ⏱ No timer</label>
			<div class="rules-num">
				<label for="${ids.secs}">Seconds</label>
				<input id="${ids.secs}" type="number" min="10" max="600" value="${seconds}" />
			</div>
		</div>`

	const q = <T extends HTMLElement>(id: string): T => container.querySelector<T>("#" + id)!
	const el: RulesForm["el"] = {
		mode: q<HTMLSelectElement>(ids.mode),
		endless: q<HTMLInputElement>(ids.endless),
		rounds: q<HTMLInputElement>(ids.rounds),
		noTimer: q<HTMLInputElement>(ids.noTimer),
		secs: q<HTMLInputElement>(ids.secs),
	}

	// The panel wears the chosen mode: keyline + description emphasis re-theme.
	const reflectMode = () => {
		container.dataset.mode = el.mode.value === "1" ? "friendly" : "hostile"
	}
	el.mode.addEventListener("change", reflectMode)
	reflectMode()

	let stashedRounds = String(rounds)
	// Re-apply the checkbox-driven disabled states (also used after a bulk
	// enable, e.g. the continue panel unlocking for the host).
	const sync = () => {
		el.rounds.disabled = el.endless.checked
		el.secs.disabled = el.noTimer.checked
	}
	el.endless.onchange = () => {
		if (el.endless.checked) {
			if (el.rounds.value !== "0") stashedRounds = el.rounds.value
			el.rounds.value = "0"
		} else {
			el.rounds.value = stashedRounds
		}
		sync()
	}
	el.noTimer.onchange = sync

	return {
		el,
		sync,
		infinite: () => el.endless.checked,
		values: () => ({
			turnSeconds: el.noTimer.checked ? 0 : el.secs.value,
			rounds: el.endless.checked ? 0 : el.rounds.value,
			friendly: el.mode.value === "1",
		}),
		// Live sync from game-state; leaves anything the host is editing alone.
		set: ({ turnSeconds, friendly } = {}) => {
			const a = document.activeElement
			if (turnSeconds !== undefined && a !== el.secs) el.secs.value = turnSeconds ? String(turnSeconds) : ""
			if (friendly !== undefined && a !== el.mode) {
				el.mode.value = friendly === false ? "0" : "1"
				reflectMode()
			}
		},
	}
}
