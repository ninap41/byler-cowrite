// Sounds (sounds/*.mp3, served at /sounds/) and the chime decision rules.
export const SOUND_NAMES = ["incomingline", "incomingmessage", "outgoingline", "outgoingmessage", "dierolling"] as const
export type SoundName = (typeof SOUND_NAMES)[number]
export type SoundCategory = "chat" | "story" | "clock" | "gimmick"
export type SoundPrefs = Record<SoundCategory, boolean>

/** The subset of HTMLAudioElement the module drives — injectable for tests. */
export interface AudioLike {
	preload: string
	volume: number
	loop: boolean
	currentTime: number
	play(): Promise<void>
	pause(): void
}
type AudioCtor = new (src: string) => AudioLike

const CATEGORY: Record<SoundName, SoundCategory> = {
	incomingmessage: "chat",
	outgoingmessage: "chat",
	incomingline: "story",
	outgoingline: "story",
	dierolling: "gimmick", // the tumble itself, when any die is thrown
}

export interface Clock {
	readonly active: boolean
	start(): void
	stop(): void
}
export interface Sounds {
	sounds: Record<SoundName, AudioLike>
	clock: Clock
	clockAudio: AudioLike
	setPrefs(p: Partial<SoundPrefs> | boolean | null | undefined): void
	readonly prefs: SoundPrefs
	play(name: SoundName, category?: SoundCategory): void
}

export function createSounds(AudioC: AudioCtor = globalThis.Audio as unknown as AudioCtor): Sounds {
	const sounds = {} as Record<SoundName, AudioLike>
	for (const n of SOUND_NAMES) {
		const a = new AudioC("/sounds/" + n + ".mp3")
		a.preload = "auto"
		a.volume = 0.6
		sounds[n] = a
	}
	// The Vecna clock: a LOOPED alarm for the last stretch of your own turn.
	// start() is idempotent (no restart-stutter while already chiming);
	// stop() halts and rewinds so the next turn starts from the first tick.
	const clockAudio = new AudioC("/sounds/vecnaclock.mp3")
	clockAudio.preload = "auto"
	clockAudio.volume = 0.5
	clockAudio.loop = true
	let clockOn = false
	// Account-level per-category mute (the game page feeds in the user's
	// saved prefs): chat pings, story chimes, the Vecna clock and gimmick
	// sounds gate independently. A legacy boolean fans out to all four.
	let prefs: SoundPrefs = { chat: true, story: true, clock: true, gimmick: true }
	const clock: Clock = {
		get active() {
			return clockOn
		},
		start() {
			if (!prefs.clock || clockOn) return
			clockOn = true
			try {
				clockAudio.currentTime = 0
				clockAudio.play().catch(() => {})
			} catch {}
		},
		stop() {
			if (!clockOn) return
			clockOn = false
			try {
				clockAudio.pause()
				clockAudio.currentTime = 0
			} catch {}
		},
	}

	return {
		sounds,
		clock,
		clockAudio,
		setPrefs(p) {
			const q: Partial<SoundPrefs> =
				typeof p === "boolean" || p == null ? { chat: p !== false, story: p !== false, clock: p !== false, gimmick: p !== false } : p
			prefs = { chat: q.chat !== false, story: q.story !== false, clock: q.clock !== false, gimmick: q.gimmick !== false }
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
			} catch {}
		},
	}
}

// The clock chimes only during the final stretch of MY live turn.
export const shouldChime = (v: { paused: boolean; left: number }, myTurn: boolean, windowSecs = 15): boolean =>
	!!myTurn && !v.paused && v.left <= windowSecs && v.left > 0

// A chat message chimes only when it's someone else's real message: system
// messages are silent, and so is my own echo (msgs carry the sender's id).
// The one exception is a system line that ASKS to ring (`chime: true` — a
// natural 20 from the dice gimmick): everyone hears that, roller included.
export const shouldChimeChat = (m: { sys?: boolean; chime?: boolean; id?: string } | null | undefined, myId: string | null): boolean =>
	m?.sys ? m.chime === true : !!m?.id && m.id !== myId

// Story-line chime: ring when the story grew and the just-ended turn wasn't
// mine. seenStoryLen starts null so rejoins don't chime on the replayed story.
export function createLineChime(play: (name: SoundName) => void) {
	let seenStoryLen: number | null = null
	let prevCurrentId: string | null = null // who was writing before this broadcast = author of any new line
	return {
		note(story: unknown[], myId: string | null): void {
			if (seenStoryLen !== null && story.length > seenStoryLen && prevCurrentId && prevCurrentId !== myId) play("incomingline")
			seenStoryLen = story.length
		},
		setPrev(id: string | null): void {
			prevCurrentId = id
		},
	}
}
