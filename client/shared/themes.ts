// The theme registry — shared by the client (theme.js, chrome.js, the ranks
// page) AND the server (lib/achievements.js names a rank's unlocked themes
// from THEME_LABELS). Listed in UNLOCK order — free themes first, then the
// ladder rung by rung (achievements.json's themeUnlocks; test/themes.test.mjs
// pins the order) — so the menu reads as the reward track it is.
export const THEMES = [
	"neon", "aurora", "upside", // free
	"ink", "wall", // outloud (0)
	"rink", "snowball", // puppymike (5k)
	"starcourt", // practice (10k)
	"arcade", // explorer (15k)
	"hellfire", // sorcerer (20k)
	"hawkinslab", "bunker", // soldiers (25k)
	"castlebyers", // innate (30k)
	"vecna", // clouds (35k)
	"void", // artist (50k)
	"cerebro", "video", // notmyfault (75k)
	"cleradin", // bestfriend (100k)
	"clouds", // crazytogether (150k)
] as const

export type ThemeId = (typeof THEMES)[number]

export const THEME_LABELS: Record<ThemeId, string> = {
	neon: "Neon Dusk",
	aurora: "Aurora",
	upside: "Upside Down",
	ink: "Inkwell",
	wall: "The Wall",
	rink: "Rink-O-Mania",
	snowball: "Snow Ball",
	starcourt: "Starcourt",
	arcade: "Palace Arcade",
	hellfire: "Hellfire Club",
	hawkinslab: "Hawkins Lab",
	bunker: "Russian Bunker",
	castlebyers: "Castle Byers",
	vecna: "Vecna's Clock",
	void: "The Void",
	cerebro: "Cerebro",
	video: "Family Video",
	cleradin: "Cleradin",
	clouds: "I Miss the Clouds",
}

// The theme every page is born wearing: the `data-theme` on <html>, the
// `:root` token block in base.css and this constant must agree.
export const DEFAULT_THEME: ThemeId = "upside"

export const isThemeId = (id: unknown): id is ThemeId => typeof id === "string" && (THEMES as readonly string[]).includes(id)
