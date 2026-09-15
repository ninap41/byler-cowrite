// Spectator identity: a random Stranger Things-flavored name + number, minted
// once per browser and kept in localStorage. Purely client-side — the server
// strips/limits whatever arrives and spectator chat is never persisted.
export const SPECTATOR_NAMES = [
	"Demodog", "Demogorgon", "Mind Flayer", "Vecna", "Barb", "Dart", "Mews", "Eggo Waffle", "Slicer", "Mirkwood Biker",
	"Hellfire Club", "Scoops Ahoy", "Surfer Boy Pizza", "Palace Arcade", "Hawkins AV Club", "Russian Guard", "Code Red",
	"The Gate", "Wrist Rocket", "D'Artagnan", "Cerebro", "Rift Below Hawkins",
] as const

const KEY = "cowriteSpecName"

/** The two localStorage calls the module needs — injectable for tests. */
export interface StorageLike {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export function getSpectatorName(storage: StorageLike = localStorage): string {
	const existing = storage.getItem(KEY)
	if (existing) return existing
	const name = SPECTATOR_NAMES[Math.floor(Math.random() * SPECTATOR_NAMES.length)] + " #" + (1 + Math.floor(Math.random() * 99))
	storage.setItem(KEY, name)
	return name
}
