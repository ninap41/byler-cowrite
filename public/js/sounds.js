// Sounds (sounds/*.mp3, served at /sounds/) and the chime decision rules.
export const SOUND_NAMES = ["incomingline", "incomingmessage", "outgoingline", "outgoingmessage"]

export function createSounds(AudioCtor = globalThis.Audio) {
	const sounds = {}
	for (const n of SOUND_NAMES) {
		const a = new AudioCtor("/sounds/" + n + ".mp3")
		a.preload = "auto"
		a.volume = 0.6
		sounds[n] = a
	}
	// The Vecna clock: a LOOPED alarm for the last stretch of your own turn.
	// start() is idempotent (no restart-stutter while already chiming);
	// stop() halts and rewinds so the next turn starts from the first tick.
	const clockAudio = new AudioCtor("/sounds/vecnaclock.mp3")
	clockAudio.preload = "auto"
	clockAudio.volume = 0.5
	clockAudio.loop = true
	let clockOn = false
	const clock = {
		get active() {
			return clockOn
		},
		start() {
			if (clockOn) return
			clockOn = true
			try {
				clockAudio.currentTime = 0
				clockAudio.play().catch(() => {})
			} catch (e) {}
		},
		stop() {
			if (!clockOn) return
			clockOn = false
			try {
				clockAudio.pause()
				clockAudio.currentTime = 0
			} catch (e) {}
		},
	}

	// Account-level per-category mute (the game page feeds in the user's
	// saved prefs): chat pings, story chimes, the Vecna clock and gimmick
	// sounds gate independently. A legacy boolean fans out to all four.
	let prefs = { chat: true, story: true, clock: true, gimmick: true }
	const CATEGORY = {
		incomingmessage: "chat",
		outgoingmessage: "chat",
		incomingline: "story",
		outgoingline: "story",
	}
	const realStart = clock.start.bind(clock)
	clock.start = () => {
		if (prefs.clock) realStart()
	}

	return {
		sounds,
		clock,
		clockAudio,
		setPrefs(p) {
			if (typeof p === "boolean" || p == null) p = { chat: p !== false, story: p !== false, clock: p !== false, gimmick: p !== false }
			prefs = { chat: p.chat !== false, story: p.story !== false, clock: p.clock !== false, gimmick: p.gimmick !== false }
			if (!prefs.clock) clock.stop()
		},
		get prefs() {
			return { ...prefs }
		},
		// `category` overrides the sound's own bucket — the dice gimmick's
		// natural-20 chime is the chat ping played under the gimmick pref.
		play(name, category = CATEGORY[name]) {
			if (!prefs[category]) return
			const a = sounds[name]
			if (!a) return
			try {
				a.currentTime = 0
				a.play().catch(() => {}) // blocked until first user gesture — fine
			} catch (e) {}
		},
	}
}

// The clock chimes only during the final stretch of MY live turn.
export const shouldChime = (v, myTurn, windowSecs = 15) =>
	!!myTurn && !v.paused && v.left <= windowSecs && v.left > 0

// A chat message chimes only when it's someone else's real message: system
// messages are silent, and so is my own echo (msgs carry the sender's id).
// The one exception is a system line that ASKS to ring (`chime: true` — a
// natural 20 from the dice gimmick): everyone hears that, roller included.
export const shouldChimeChat = (m, myId) => (m?.sys ? m.chime === true : !!m?.id && m.id !== myId)

// Story-line chime: ring when the story grew and the just-ended turn wasn't
// mine. seenStoryLen starts null so rejoins don't chime on the replayed story.
export function createLineChime(play) {
	let seenStoryLen = null
	let prevCurrentId = null // who was writing before this broadcast = author of any new line
	return {
		note(story, myId) {
			if (seenStoryLen !== null && story.length > seenStoryLen && prevCurrentId && prevCurrentId !== myId)
				play("incomingline")
			seenStoryLen = story.length
		},
		setPrev(id) {
			prevCurrentId = id
		},
	}
}
