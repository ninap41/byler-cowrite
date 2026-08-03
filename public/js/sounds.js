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
	return {
		sounds,
		play(name) {
			const a = sounds[name]
			if (!a) return
			try {
				a.currentTime = 0
				a.play().catch(() => {}) // blocked until first user gesture — fine
			} catch (e) {}
		},
	}
}

// A chat message chimes only when it's someone else's real message: system
// messages are silent, and so is my own echo (msgs carry the sender's id).
export const shouldChimeChat = (m, myId) => !m?.sys && !!m?.id && m.id !== myId

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
