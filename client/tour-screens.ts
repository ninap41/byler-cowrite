// The homepage tour: eight chapters, each a claim beside a "screen" — the real
// UI rebuilt as static markup so it recolours with whatever theme the visitor
// wears. Pure string builders (no DOM at top level) so a test can read them.
// Every colour, face and radius is a theme token; the three writer colours are
// PALETTE entries, the same ones a real roster would show.

const K = "#7dd3fc" // kip
const R = "#ff9ecb" // rose
const Q = "#a78bfa" // charlie

const dot = (on: boolean): string => `<span class="ts-dot${on ? " on" : ""}"></span>`
const who = (name: string, color: string, on = true): string => `<span class="ts-who">${dot(on)}<span class="ts-name" style="color:${color}">${name}</span></span>`
const caret = (): string => `<span class="ts-caret"></span>`
const btn = (label: string, cls = ""): string => `<span class="ts-btn ${cls}">${label}</span>`
const tb = (label: string, cls = ""): string => `<span class="ts-tb ${cls}">${label}</span>`

export function screenGame(): string {
	return `<div class="ts ts-game">
	<div class="ts-sess">
		<span class="ts-title">The Snowball Dance</span><span class="ts-mono ts-muted">host: kip</span>
		<span class="ts-sess-acts">${tb("M6DH ⎘", "ts-code")}${btn("⏸ Pause", "ghost")}${btn("End game &amp; reveal", "primary")}</span>
	</div>
	<div class="ts-game-cols">
		<div class="ts-main">
			<div class="ts-prompt">Rain is falling on Hawkins Middle School as Mike looks around the room.</div>
			<div class="ts-story">
				<div class="ts-line">${who("kip", K)}<p>The gym smelled like pine cleaner, perfume, and cologne, and Lucas was counting the streamers sipping his punch.</p></div>
				<div class="ts-line">${who("rose", R)}<span class="ts-pill">edited</span><p>Mike came over with two cups he did not want and said, <em>"Stop fiddling. You're making me nervous."</em> which was rich, coming from him.</p></div>
				<div class="ts-line">${who("charlie", Q, false)}<p>"I'm not," Lucas said. "I'm waiting."</p></div>
			</div>
			<div class="ts-live"><span class="ts-name" style="color:${R}">rose</span> "Waiting for <b>what</b>," Mike said, and the song changed${caret()}</div>
			<div class="ts-turn"><b>rose is writing…</b><span class="ts-clock">0:14</span></div>
			<div class="ts-toolbar">${tb("B", "b")}${tb("I", "i")}${tb("U", "u")}${tb("p ▾", "ts-muted")}${tb("HR")}</div>
			<div class="ts-editor ts-muted">Add the next line…</div>
			<div class="ts-mono ts-muted ts-hint">Ctrl/⌘+Enter to submit · auto-submits when the timer ends</div>
			<div class="ts-mono ts-muted ts-hint ts-center">Round 3 of 8 · 24 lines · 1,930 words</div>
		</div>
		<aside class="ts-side">
			<h4 class="ts-h">Writers &amp; spectators</h4>
			<div class="ts-seat"><span class="ts-av" style="background:${K}">K</span>kip<span class="ts-mono ts-muted ts-r">host</span></div>
			<div class="ts-seat is-writing"><span class="ts-av" style="background:${R}">R</span>rose<span class="ts-r">✒</span></div>
			<div class="ts-seat"><span class="ts-av" style="background:${Q}">C</span>charlie</div>
			<p class="ts-mono ts-muted ts-hint">+ 4 watching</p>
			<h4 class="ts-h">Turn order</h4>
			<div class="ts-mono ts-muted ts-order"><div>1 · kip</div><div class="ts-acc2">2 · rose ←</div><div>3 · charlie</div></div>
		</aside>
	</div>
	<div class="ts-chatdock">💬 Chat <span class="ts-badge">3</span><i class="ts-r ts-muted">▾</i></div>
</div>`
}

export function screenLive(): string {
	return `<div class="ts ts-livecard">
	<div class="ts-toolbar">${tb("B", "b on")}${tb("I", "i")}${tb("U", "u")}${tb("h2 ▾", "ts-muted")}${tb("⇤ ↔ ⇥", "ts-muted")}${tb("HR")}</div>
	<div class="ts-live big">${who("rose", R)} Mike said it <b>suspiciously</b>${caret()}</div>
	<div class="ts-turn"><span class="ts-mono ts-muted">everyone at the table sees this as it is typed</span><span class="ts-clock">0:09</span></div>
	<div class="ts-notice">🔔 <span>Time's up: the line was committed as typed, and play advanced to <b>charlie</b>.</span></div>
</div>`
}

const commentCards = (full: boolean): string => `
	<p class="ts-quote">"It's good," he said finally…</p>
	<div class="ts-cmt is-active">
		<div class="ts-cmt-head">${dot(true)}<b style="color:${R}">rose</b><span class="ts-r ts-muted">2h</span></div>
		<p>Beat before "Is it about us?", build some tension dude</p>
		<div class="ts-cmt-acts ts-acc2"><span>Reply</span><span>Resolve</span></div>
	</div>
	<div class="ts-cmt">
		<div class="ts-cmt-head"><b style="color:${Q}">charlie</b><span class="ts-r ts-muted">yesterday</span></div>
		<p class="ts-mono ts-muted">${full ? "Suggestion" : "suggestion · author decides"}</p>
		<div class="ts-diff"><div class="del">taking it seriously</div><div class="add">→ taking it personally</div></div>
		<div class="ts-cmt-acts"><span class="ts-good">Accept</span><span class="ts-muted">Reject</span>${full ? '<span class="ts-r ts-bad">Delete</span>' : ""}</div>
	</div>
	<div class="ts-cmt is-resolved">
		<div class="ts-cmt-head"><b>kip</b><span class="ts-r ts-muted">3d</span></div>
		<p><s>Cut the second "snow".</s></p>
		${full ? "" : '<p class="ts-mono ts-muted ts-hint">resolved · underline dropped</p>'}
	</div>`

export function screenWrite(): string {
	return `<div class="ts ts-write">
	<header class="ts-write-head">
		<span class="ts-mono ts-muted">← All writes</span>
		<div class="ts-write-title">
			<div class="ts-title">You Took My Turn, I Was Typing</div>
			<div class="ts-meta ts-mono ts-muted"><span class="ts-good">Saved</span><span>·</span><span>4,182 words</span><span>·</span><span class="ts-chip">🔒 Private</span><span class="ts-chip">👥 Readers · 2</span><span class="ts-chip">⏱ Sprint</span><span class="ts-chip on">💬 Comment</span><span class="ts-avs"><i style="background:${R}"></i><i style="background:${Q}"></i></span></div>
		</div>
		${btn("Save", "primary")}
	</header>
	<div class="ts-toolbar dim">${tb("↺")}${tb("↻")}${tb("p ▾")}${tb("B", "b")}${tb("I", "i")}${tb("U", "u")}${tb("− 16 +")}${tb("🔗")}${tb("🖼")}<span class="ts-r ts-modes"><span class="ts-chip">Rich text</span><span class="ts-muted">HTML</span><span class="ts-muted">Comment</span></span></div>
	<div class="ts-write-cols">
		<div class="ts-doc">
			<h2>The garage, December</h2>
			<p>The heater in the garage stayed off and futile in the winter air. The kids were in their coats, body's aching for more warmth.</p>
			<p>Mike read the page again. He always went quiet in moments like this. <span class="ts-mark">Will knew that meant he was taking it seriously.</span></p>
			<p><span class="ts-mark hot">"It's good," he said finally. "It's really good. Is it about us?"</span></p>
			<p>Will took the page back and did not answer, and outside the snow kept falling slowly onto the snow-weighted roofs and buried cars outside.</p>
		</div>
		<aside class="ts-cmts">
			<div class="ts-cmts-head"><h3>💬 Comments</h3><span class="ts-r ts-mono ts-muted">2 open</span></div>
			${commentCards(true)}
		</aside>
	</div>
</div>`
}

export function screenComment(): string {
	return `<div class="ts ts-comment">
	<div>
		<div class="ts-mono ts-muted ts-modebar"><span class="ts-chip on">💬 Comment mode</span><span>beta reader · read and comment.</span></div>
		<div class="ts-doc boxed">
			<p>The heater in the garage had two settings and both of them were off, so they wrote in their coats.</p>
			<p>Mike read the page again. He always went quiet in moments like this. <span class="ts-mark">Will knew that meant he was taking it seriously.</span></p>
			<p><span class="ts-mark hot">"It's good," he said finally. "It's really good. Is it about us?"</span></p>
		</div>
	</div>
	<div>${commentCards(false)}</div>
</div>`
}

const rung = (label: string, words: string, pct: number, state: string): string =>
	`<div class="ts-rung ${state}"><span class="ts-rung-name">${label}</span><span class="ts-mono ts-muted">${words}</span><span class="ts-bar"><i style="width:${pct}%"></i></span><span class="ts-mono ts-rung-state">${state === "earned" ? "earned" : state === "current" ? "current" : pct + "%"}</span></div>`

export function screenRanks(): string {
	return `<div class="ts ts-ranks">
	<h3 class="ts-h">The word ladder</h3>
	<p class="ts-muted">Every committed line matters. Fourteen of twenty-six earned.</p>
	${rung("🪄 Practice", "10,000", 100, "earned")}
	${rung("🧙 Sorcerer", "20,000", 100, "earned")}
	${rung("🧭 Artist", "50,000", 100, "current")}
	${rung("😤 It's not my fault you don't like girls!", "65,000", 68, "next")}
	${rung("🌀 Crazy Together", "150,000", 35, "next")}
	<h3 class="ts-h ts-rule">Collected badges</h3>
	<div class="ts-badges"><span class="ts-chip">🔫 There. Out Loud.</span><span class="ts-chip">🐶 Puppy Mike</span><span class="ts-chip">🫶 You have explored</span><span class="ts-chip">⚡ Innate Powers</span><span class="ts-chip">☁️ I miss clouds I miss you</span><span class="ts-chip">🪖 Like the soldiers</span><span class="ts-chip secret">🔒 secret badge</span><span class="ts-chip secret">🔒 secret badge</span></div>
	<div class="ts-notice">🏆 <span>Unlocked mid-line: <b>charlie</b> earned <b>🪄 Practice</b>, announced to the lobby.</span></div>
</div>`
}

export function screenGimmick(): string {
	return `<div class="ts ts-gimmick">
	<div class="ts-story"><div class="ts-line"><span class="ts-name" style="color:${Q}">charlie</span><p>Mike put his hand flat on the table like he was about to say something serious, and then the die landed under the generator.</p></div></div>
	<img class="ts-d20 a" src="/img/d20.png" alt="" /><img class="ts-d20 b" src="/img/d20.png" alt="" />
	<div class="ts-notice">🎲 <span><b>rose</b> rolled a <b class="ts-acc">natural 20</b>, the turn is stolen.</span></div>
	<div class="ts-badges"><span class="ts-chip">🎲 Play gimmick</span><span class="ts-chip">🔥 Hellfire d20</span><span class="ts-chip locked">🥤 Milkshake · locked</span><span class="ts-chip locked">🪩 Disco ball · locked</span></div>
</div>`
}

export function screenDash(): string {
	return `<div class="ts ts-dash">
	<div class="ts-dash-main">
		<div class="ts-me">
			<span class="ts-av big" style="background:${K}">K</span>
			<div>
				<div class="ts-me-row"><b style="color:${K}">kip</b><span class="ts-chip">🧭 Artist</span><span class="ts-r ts-acts">${btn("View profile", "ghost")}${btn("Log out", "ghost")}</span></div>
				<p class="ts-muted">Welcome back! Ready to keep the story going?</p>
				<p class="ts-muted ts-i">“I'm not.” Lucas said. “I'm waiting.”<span class="ts-acc2">▎</span></p>
			</div>
		</div>
		<div class="ts-stats">
			<div><b class="ts-acc">52,140</b><span>words written</span></div>
			<div><b>14</b><span>badges earned</span></div>
			<div class="ts-streak"><svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="29" class="ring-bg"></circle><circle cx="35" cy="35" r="29" class="ring"></circle><text x="35" y="33" class="fire">🔥</text><text x="35" y="48" class="n">9</text></svg><div class="ts-muted"><b>9 days</b> current streak<br />Best: 21 days</div></div>
		</div>
		<div><span class="ts-muted ts-hint">🧭 Artist · 12,860 words to 😤 It's not my fault you don't like girls!</span><div class="ts-bar wide"><i style="width:68%"></i></div></div>
		<div class="ts-rule">
			<h3 class="ts-h">Games in progress</h3>
			<div class="ts-games">
				<div class="ts-gcard"><div class="ts-cover grad"><span class="ts-ago">2m ago</span><span class="ts-cover-code">M6</span></div><div class="ts-gbody"><div class="ts-gtitle"><span>Supersucker</span><span class="ts-mono ts-muted">M6DH</span></div><p class="ts-good">Your turn · 0:14 left</p><div class="ts-dots"><i style="background:${K}"></i><i style="background:${R}"></i><i style="background:${Q};opacity:.35"></i><span class="ts-muted">3 writers</span></div></div>${btn("Resume: your turn", "primary")}</div>
				<div class="ts-gcard"><div class="ts-cover alt"><span class="ts-cover-code">ZD</span></div><div class="ts-gbody"><div class="ts-gtitle"><span>Rain Check</span><span class="ts-mono ts-muted">ZDU4</span></div><p class="ts-acc">Paused by host · asleep</p><div class="ts-dots"><i style="background:${R};opacity:.35"></i><i style="background:#37e0a0;opacity:.35"></i><span class="ts-muted">2 writers</span></div></div>${btn("Wake it up", "ghost")}</div>
				<div class="ts-gcard empty"><span>✨</span><span>Open slot: start a new story or invite friends.</span></div>
			</div>
		</div>
	</div>
	<div class="ts-dash-rail">
		<nav class="ts-nav"><div class="on"><span>📬</span><span>Inbox</span><span class="ts-badge">2</span></div><div><span>✨</span><span>Start a game</span><span class="ts-muted">→</span></div><div><span>🔑</span><span>Join a game</span><span class="ts-muted">▾</span></div><div><span>✒️</span><span>New solo write</span></div><div><span>📚</span><span>My solo writes</span></div></nav>
		<div>
			<h3 class="ts-h">Friends</h3>
			<div class="ts-seat">${dot(true)}<b style="color:${R}">rose</b><span class="ts-r ts-mono ts-muted">writing</span></div>
			<div class="ts-seat">${dot(true)}<b style="color:${Q}">charlie</b><span class="ts-r ts-mono ts-muted">online</span></div>
			<div class="ts-seat off">${dot(false)}<b>mixtape</b><span class="ts-r ts-mono ts-muted">2d</span></div>
		</div>
		<div class="ts-quotecard"><span class="ts-acc ts-bigq">“</span>I dump your ass.<span class="ts-acc">”</span></div>
	</div>
</div>`
}

// The themes shown as screenshots in the tour (public/img/themes/<id>.jpg).
// Whatever the visitor is wearing is marked "on" at mount time (data-theme).
export const TOUR_THEMES: readonly (readonly [string, string])[] = [
	["neon", "Neon Dusk"], ["aurora", "Aurora"], ["ink", "Inkwell"], ["hellfire", "Hellfire Club"],
	["upside", "Upside Down"], ["starcourt", "Starcourt"], ["castlebyers", "Castle Byers"], ["vecna", "Vecna's Clock"],
	["snowball", "Snow Ball"], ["rink", "Rink-O-Mania"], ["cerebro", "Cerebro"],
]
export function screenThemes(total = 19): string {
	const more = total - TOUR_THEMES.length
	return `<div class="ts-themes">${TOUR_THEMES.map(
		([id, label]) => `<div class="ts-theme" data-theme-id="${id}"><img src="/img/themes/${id}.jpg" alt="${label}" loading="lazy" /><span class="ts-theme-name">${label}</span><span class="ts-theme-on">on</span></div>`,
	).join("")}<div class="ts-theme more">+ ${more} more<br />themes</div></div>`
}

export interface TourChapter {
	id: string
	kicker: string
	title: string
	body: string
	screen: () => string
}
export const TOUR: readonly TourChapter[] = [
	{ id: "game", kicker: "Round-robin writing", title: "One line per turn, under a per-turn countdown.", body: "The server owns the clock: when time runs out, whatever the writer had typed is committed and play advances.", screen: screenGame },
	{ id: "live", kicker: "Live typing &amp; rich text", title: "The room watches the line appear.", body: "Rich text, headings, alignment, and horizontal rules, with live typing visible to the whole lobby.", screen: screenLive },
	{ id: "write", kicker: "Solo writes", title: "A full document editor outside the game.", body: "Autosaving drafts, headings/lists/quotes/links/images, a font-size ladder, a <b class=\"ts-mono\">/</b> palette of action verbs and dialogue tags, per-browser line spacing, real undo/redo, and a Rich text / HTML / Comment switch.", screen: screenWrite },
	{ id: "comment", kicker: "Comment mode &amp; beta readers", title: "Comments pinned to the exact words they're about.", body: "The commented text is underlined, clicking either the underline or the comment card jumps to the other, and resolved comments drop their underline.<br /><br />Beta readers read and comment, never edit: a rewrite they type becomes a suggestion (old → new) that only the author can Accept or Reject.", screen: screenComment },
	{ id: "badges", kicker: "Badges", title: "A word-count ladder, and the secret ones.", body: "From 🐶 Puppy Mike (5,000 words) to 🌀 Crazy Together (150,000), plus secret badges earned by writing… the right thing (some need the right <i>combination</i> of words in one line). Unlocks announce to the whole session.", screen: screenRanks },
	{ id: "gimmicks", kicker: "Gimmicks", title: "Rank rewards you play to distract the table.", body: "\"🎲 Play gimmick\" hands you a d20 in your own colour to throw around the screen, over the story, over the editor, over everyone's screen, the writer's included. Every landing is called in the chat, and a natural 20 steals the turn.", screen: screenGimmick },
	{ id: "dash", kicker: "Dashboard, friends &amp; inbox", title: "Who's online, and where you left off.", body: "Games in progress with Join buttons, and your recent stories. Send friend requests from any profile, accept or decline them in your inbox, and see which friends are online right from the dashboard.", screen: screenDash },
	{ id: "themes", kicker: "Nineteen themes", title: "Nineteen skins, always fun.", body: "Neon Dusk, Aurora, Inkwell, The Wall, Snow Ball, Upside Down, Starcourt, Palace Arcade, Cerebro, Hawkins Lab, Castle Byers, Vecna's Clock, The Void, Family Video, Hellfire Club, Rink-O-Mania, Camp Know Where, Russian Bunker, and The Pollywog, with GSAP-animated everything.", screen: screenThemes },
]

export function tourPanelHtml(ch: TourChapter, i: number): string {
	return `<section class="tour-panel" id="tour-${ch.id}" data-chapter="${i}">
	<div class="tour-claim">
		<p class="tour-kicker">${ch.kicker.toUpperCase()}</p>
		<h3>${ch.title}</h3>
		<p class="tour-body">${ch.body}</p>
	</div>
	<div class="tour-screen">${ch.screen()}</div>
</section>`
}

export function tourHtml(): string {
	return TOUR.map(tourPanelHtml).join("\n")
}

export function tourDotsHtml(): string {
	return TOUR.map((ch, i) => `<a class="tour-dot${i === 0 ? " on" : ""}" href="#tour-${ch.id}" title="${ch.kicker.replace(/&amp;/g, "&")}" aria-label="${ch.kicker.replace(/&amp;/g, "&")}"></a>`).join("")
}
