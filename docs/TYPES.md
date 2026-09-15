# Types: what becomes an interface, a union, or an extension

*Research for the TypeScript migration (`docs/FRONTEND_ASSESSMENT.md`), written 2026-09-14 from a full inventory of the socket contract, the REST and storage records, and the client modules.*

**Status (2026-09-14, `migration` branch):** every module under `public/js` (67 files) now has a TypeScript source in `client/`, emitted file-for-file by `scripts/build.mjs`. The shared layer is `client/shared/` — `brands.ts`, `wire.ts` (Who/RosterWriter/StoryLine/ChatMessage, Ack/SeatAck, the inbox rows, PromptControls/MenuRow/OptionMeta), `themes.ts` (the registry, ThemeGate) and `reactions.ts` — plus `client/components/gimmick-types.ts` (the `Gimmick` base the seven toys extend). **Every inline page script is now a module in `client/pages/<page>.ts`** (loaded as `<script type="module" src="/js/pages/<page>.js">`; the small GSAP entrance/hero scripts stay inline, they import nothing and touch no data): game, ranks, inbox, writes, announcements, stories, archive, admin, profile, settings, index, dashboard and write. The two Socket.IO event maps (§1) are in `wire.ts` — `ServerToClient`/`ClientToServer`, covering the game, the gimmicks, the inbox nudge and the solo editor's `doc-*` events — the pages' sockets are `io<ServerToClient, ClientToServer>()`, and `SocketLike` in `components/gimmick-types.ts` is that same typed socket, so every gimmick handler is checked against the maps too. A page module reads the site name off the meta tag (`siteName()`), never a `{{SITE_NAME}}` token: a static module is not rendered by `renderPage()`. Tests that used to regex a page's inline script read `public/js/pages/<page>.js` (esbuild's spellings: two-space indent, semicolons, redundant parens dropped). **Since 2026-09-15 the server is checked too**: `tsconfig.server.json` runs `checkJs` over `server.js`, `src/` and `lib/` with `io` typed `Server<ClientToServer, ServerToClient>` via JSDoc, so every handler, emit and ack in `src/game.js` is held to `wire.ts` (the first run found seven acks and six handler signatures the contract had wrong — `ready`/`shuffle-options`/`reroll-option`/`remove-prompt`/`set-prompt-mode`/pause/resume/end take an ack; `make-host`, `set-cover`, `cancel-game`, `gimmick-curse`, `spectate-session`, `set-prompt-mode` ack more than `ok`; `SeatAck.phase`/`color` are absent on create). `User`/`Store` are JSDoc typedefs in `src/store.js`, `Session`/`Writer`/`StoryLine` in `src/game.js`; `noImplicitAny` is off there for now — turning it on is the next tightening.

## The three boundaries

Every data shape in the app crosses one of three lines, and the line decides where its type lives:

| Boundary | Examples | Where the type goes |
|---|---|---|
| **Wire** (server ↔ browser) | socket payloads, REST responses, acks | `shared/` — imported by both `src/` and `client/` |
| **Storage** (server ↔ disk/Postgres) | the User record, the Doc, the game snapshot, the content pack | `shared/` too: the snapshot is what the archive reads, the pack is what `/admin` edits and `/api/prompt-options` ships |
| **Browser only** | localStorage blobs, mount options, mount return objects, view-builder inputs | `client/` beside the module that owns it |

`shared/` is a new top-level folder of `.ts` files holding **types and the handful of pure modules the server already imports from `public/js`** (`reactions.js`, `theme.js`'s registry). It is compiled by the same esbuild step into `public/js/shared/` for the browser; the server imports the emitted JS (types erase, so `src/` stays JavaScript until it is converted).

## 1. Interfaces: the wire

### The seat, three ways

The same person appears as three different objects depending on where they are, and the migration should make that explicit rather than reuse one loose shape:

```ts
interface Who {                    // what every byline/avatar/chip needs
  name: string
  color: HexColor
  avatar?: string
  avatarFit?: AvatarFit
  host?: boolean
}
interface RosterWriter extends Who {   // roster.writers[] and game-state.writers[]  (src/game.js roster())
  id: string                       // socket id, or "ghost:<token>"
  userId: string | null
  badge: string | null
  isHost: boolean
  connected: boolean
  words: number
}
interface Seat extends RosterWriter {  // server-only: session.writers values
  token: string
  approved: boolean
  ghostTimer: NodeJS.Timeout | null
}
interface SnapshotSeat extends Who {   // saves/<CODE>.json writers[] — keyed by token, no socket id
  token: string
  userId: string | null
  badge: string | null
}
```

`Who` is the base for everything the client renders a person from: `StoryLine`, `ChatMessage`, `ScoreRow`, `CommentRow`, the inbox `from`/`to` idents, `/api/users` rows. `util.js`'s `whoMarks(o)` and `miniAvatar(o)` take exactly `Who` (with `miniAvatar` also accepting `username` — see §4).

### Story and chat

```ts
interface StoryLine extends Who {
  html: RichHtml                  // sanitizeRich() output, injected as-is
  userId: string | null
  edited?: true
}
interface ChatBase { text: string; ts: number }
interface WriterChat extends ChatBase, Who {          // a seated writer spoke
  id: string; mid: string; badge: string | null; reactions?: Reactions
}
interface SpectatorChat extends ChatBase { id: string; mid: string; name: string; color: HexColor; spec: true; reactions?: Reactions }
interface SystemChat extends ChatBase { name: string; color: HexColor; sys: true; chime?: true }  // no mid → cannot be reacted to
type ChatMessage = WriterChat | SpectatorChat | SystemChat
type Reactions = Record<Reaction, { key: string; name: string; color?: HexColor }[]>
```

A discriminated union, not one shape with optional flags: `sys` and `spec` are the discriminants the client already branches on, and "a system line has no `mid`" becomes a compile-time fact instead of a comment.

### `game-state`, phase by phase

The broadcast is one object today, with `options`/`tally`/`ballots`/`ready` empty outside `choosing` and `turnOrder` empty outside `writing`/`over`. Two honest ways to type it; the second is recommended:

1. One `GameState` with everything optional — matches the wire byte for byte, teaches the compiler nothing.
2. A base plus per-phase extensions, discriminated on `phase`:

```ts
interface GameStateBase {
  code: string; name: string; cover: string
  phase: Phase
  prompt: string; story: StoryLine[]
  writers: RosterWriter[]; players: (string | undefined)[]
  hostId: string | null; hostName: string | null; hostUserId: string | null
  friendly: boolean; spectators: number; total: number
  tableGimmicks: GimmickId[]
  promptMode: PromptMode; promptControls: PromptControls
  turnSeconds: number; turnCount: number; maxTurns: number | null
  paused: boolean; remaining: number | null; deadline: number
  currentId: string | null; currentName: string | null; currentColor: HexColor | null; nextId: string | null
  turnOrder: string[]
}
interface ChoosingState extends GameStateBase {
  phase: "choosing"
  options: string[]; optionMeta: (OptionMeta | null)[]
  tally: number[]; voted: number; ballots: Record<string, number[]>
  ready: string[]; allReady: boolean
}
interface WritingState extends GameStateBase { phase: "writing" | "over" }
interface WaitingState extends GameStateBase { phase: "waiting" }
type GameState = WaitingState | ChoosingState | WritingState
```

`broadcastGame()` keeps emitting the empty arrays for the non-choosing phases (the wire does not change), and the base carries them as `options: string[]` etc. if a strict-wire match is wanted. The value is on the client: `renderChoosing(st: ChoosingState)` can no longer be handed a writing state.

`OptionMeta` is its own union: `null` (curated), `{ seed; selections: Selections; labels: Labels }` (guided), `{ custom: true; by: string | null }` (hand-written).

### Acks

Every ack is `{ ok: false; error?: string }` or `{ ok: true } & payload`. One generic:

```ts
type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error?: string }
interface SeatAck { code: string; hostId: string; name: string; color: HexColor; phase: Phase; token: string }
// join-session / rejoin-session: Ack<SeatAck> | Ack<{ pending: true }>
// vote: Ack<{ on: boolean; votes: string[] }>;  gimmick-roll: Ack<{ value: number; kind: RollKind; stole: boolean }>
```

`SeatAck` is also the body of the `join-approved` event: one interface, three emit sites.

### The event maps

Socket.IO's typed API takes two maps. They are the single most valuable thing the migration produces, because they type both ends of every event at once:

```ts
interface ServerToClient {
  "game-state": (st: GameState) => void
  roster: (r: Roster) => void
  "game-over": (p: GameOverPayload) => void
  chat: (m: ChatMessage) => void
  "chat-history": (ms: ChatMessage[]) => void
  "chat-react": (p: { mid: string; reactions: Reactions }) => void
  "live-typing": (p: { html: RichHtml }) => void
  "badge-earned": (p: BadgeEarned) => void
  "gimmick-die": (p: DieState | GimmickOff) => void
  // … one line per event in the inventory
}
interface ClientToServer {
  "join-session": (p: { code: GameCode; auth: string }, ack: (r: Ack<SeatAck> | Ack<{ pending: true }>) => void) => void
  vote: (p: { prompt: string; on?: boolean }, ack: (r: Ack<{ on: boolean; votes: string[] }>) => void) => void
  typing: (p: { text: string }) => void
  // …
}
```

The server side is `new Server<ClientToServer, ServerToClient>(…)` — done via a JSDoc `@type` on `io` in `server.js` and `@param {IO}` on `createGame`, no conversion needed — so both ends of every event are checked against the same map.

### Gimmicks share one wire shape

Every live-state event is `{ userId, name, color, …state, on: true } | { userId, on: false }`, and its plural bulk event is the same object minus `on`, in an array:

```ts
interface GimmickOwner { userId: string; name: string; color: HexColor }
type GimmickOff = { userId: string; on: false }
type Live<S> = (GimmickOwner & S & { on: true }) | GimmickOff
type Bulk<S> = (GimmickOwner & S)[]

interface DieState  { x: Frac; y: Frac }
interface ShipState { x: Frac; score: number; shots: [Frac, Frac][]; bees: Bee[] }
interface CupState  { x: Frac; y: Frac; rot: number; level: number }
interface BallState { x: Frac; y: Frac }
interface GunState  { x: Frac; y: Frac; angle: number }
// gimmick-die: Live<DieState>, gimmick-dice: Bulk<DieState>, and so on for ship/cup/ball/gun
```

Two generics replace ten hand-written shapes, and adding a gimmick means adding one `State` interface. The art room's `gimmick-stroke` (cursor / stroke / wipe / put-away in one event) and the curse (`{ byName, byColor, targetUserId, targetName, duration } | { targetUserId, lift: true }`) are unions of their own.

## 2. Interfaces: storage and REST

### Records

| Record | Interface | Notes |
|---|---|---|
| `users/users` blob | `UserStore { users: User[]; sessions: Record<Token, UserId>; resets: Record<Token, Reset>; waitlist: Waitlist[] }` | `getJson()` in `src/storage.js` is the one untyped parse; it returns `unknown` and each kind gets a narrowing reader |
| a user | `User` — 30-odd fields; `passHash` never leaves the server | `PublicUser = Pick<User, …> & { themes; gimmicks; wordBadges; usageBadges; openBadges; badgeDescs; nextBadge }` is what `publicUser()` returns; `Profile` is the narrower `profileOf()` shape (no email, no id) |
| inbox message | `Msg { id; type: MsgKind; fromId; text; read; ts; threadId?; mine?; code?; toId?; unlocks? }` | the wire row `InboxRow` swaps `fromId`/`toId` for `from`/`to: Who & { username }` |
| a solo write | `Doc { id; ownerId; title; chapters: Chapter[]; betaReaders: UserId[]; visibility: Visibility; comments: Comment[]; sprints; sprintWords; createdAt; updatedAt }` | `html` and `wordCount` are DERIVED and never persisted — the type says so by leaving them off `Doc` and putting them on `DocPayload` |
| chapter | `Chapter { id: ChapterId; title; html: DocHtml; wordCount }` | the draft cache's chapter is `Pick<Chapter, "title" \| "html"> & { id: ChapterId \| null }` — a new chapter has no id until saved |
| comment | `Comment { id; cid: Cid; quote; userId; text; suggestion: string \| null; ts; resolved; accepted }` | `CommentRow extends Omit<Comment, "userId">, Who { orphaned; chapterId: ChapterId \| null; isAuthor }` is the wire form |
| game snapshot | `Snapshot` | the inventory lists exactly which live-session fields it drops; `Session` is server-only and extends nothing (it holds Maps and timers) |
| announcement | `Post { id; title; markdown; html: RichHtml; images: HttpUrl[]; at; byId; byName; editedAt?; editedBy? }` | the dashboard's summary rows read `{ at; html; title }` only: `Pick<Post, …>` |
| content pack | `PromptData { prompts: string[]; intermediate: IntermediateData }`, `AchievementsDoc`, `SiteJson`, `TitlesJson` | see §3 for the row shape |

### Summaries, and what extends what

The clearest extension chain in the app is the game card. Five builders read five supersets of one object:

```ts
interface GameRef   { code: GameCode; cover?: string }                       // coverStyle()
interface GameCard extends GameRef { name; phase: Phase; hostName: string | null; savedAt: number; words: number }
interface ArchiveGame extends GameCard { prompt; createdAt; tags: string[]; lines: number; writers: { name; color; isHost }[] }  // gameSummary()
interface MyGame extends GameCard { myTurn: boolean; paused: boolean; currentName: string | null; players: RosterWriter[] }
interface LiveGame extends GameRef { name; phase; paused; hostName; players: { name; connected }[] }   // /api/dashboard liveGames
interface AdminGameRow { code; name; phase; players: number; lines: number; hostName; createdAt }      // players is a COUNT — deliberately not in the chain
```

`/api/stories` rows are a union on `kind`: `(ArchiveGame & { kind: "game"; wordCount }) | WriteRow` where `WriteRow { kind: "write"; id; name; lines; wordCount; visibility; viewable; … }`.

Solo-write summaries: `DocSummary` (from `docSummary()`) with `DocListRow extends DocSummary { mine; viewable }` and `DocPayload extends DocListRow { html; chapters: Chapter[]; readerRows: UserRef[]; comments: CommentRow[] }`.

### `/api/prompt-options` rows

```ts
interface MenuRow { id: string; label: string; tags?: string[]; requires?: string[]; excludes?: string[]; ageGroups?: AgeGroup[]; canon?: string[]; adultOnly?: boolean }
interface SeasonRow extends MenuRow { ageGroup: AgeGroup }
interface LevelRow extends MenuRow { adultOnly: boolean }
```

These are the SHORT names. The pack rows the admin editor reads use the long ones (`requiresTags`, `incompatibleTags`, `compatibleAgeGroups`, `compatibleCanon`). That mismatch is real today and undocumented; the types name both (`PromptOption` on the pack, `MenuRow` on the wire) and `rules()` in `src/routes.js` is the one function that maps between them.

## 3. Unions and branded types

### String unions from `as const` registries

Each of these is an array or object today whose members are the only legal values. Marking the registry `as const` and deriving the union means a typo in a theme id or a badge id is a compile error, and the registry stays the single source (nothing is written twice):

| Union | Derived from |
|---|---|
| `Phase` | `["waiting", "choosing", "writing", "over"] as const` |
| `ThemeId` | `THEMES` in `theme.js` (moves to `shared/`) — and `THEME_LABELS: Record<ThemeId, string>` then cannot miss one |
| `GimmickId` | keys of `GIMMICKS` in `lib/gimmicks.js`; `GIMMICKS[id].theme: ThemeId` |
| `WordTierId` | `content/achievements.json` is data, so this stays `string` at the type level and `validateAchievements` remains the guard; `themeUnlocks: Record<ThemeId, string>` |
| `Reaction` | keys of `EMOJI_WORDS` |
| `SoundName`, `SoundCategory` | `SOUND_NAMES`, the `CATEGORY` map |
| `Visibility` | `VISIBILITIES` |
| `MsgKind`, `InboxFilter` | `MSG_KINDS` keys, `INBOX_FILTERS` keys — and `MSG_KINDS[k].filter: InboxFilter` is then checked |
| `PromptMode`, `ExplicitLevel`, `AgeGroup` | `MODES`, `EXPLICIT_LEVELS`, the two age groups in `lib/prompt-gen.js` |
| `AvatarFit`, `Paper`, `StoryView`, `FriendState`, `StoryKind`, `RollKind`, `GalagaKind`, `StorageKind`, `StorageMode` | the literals already in code |
| `ControlKey`, `OffKey` | `GUIDED_FIELDS[].key`, `OFF_KEYS`; `PromptControls` is then `Record<IdKey, string> & Record<OffKey, boolean> & { kinkCount: 1 \| 2 \| 3 }` |

### Branded strings

The app has many `string`s that are not interchangeable, and it already has a validator for each. A brand makes "this string has passed `cleanColor`" a type:

```ts
type Brand<T, B extends string> = T & { readonly __brand: B }
type HexColor  = Brand<string, "HexColor">    // isHex / cleanColor / safeColor
type GameCode  = Brand<string, "GameCode">    // CODE_RE /^[A-Z0-9]{4}$/
type Cid       = Brand<string, "Cid">         // CID_RE, 12 hex
type ChapterId = Brand<string, "ChapterId">   // CH_ID_RE, 12 hex
type DocId     = Brand<string, "DocId">       // ID_RE (uuid)
type HttpUrl   = Brand<string, "HttpUrl">     // httpUrl()
type Email     = Brand<string, "Email">       // EMAIL_RE
type Slug      = Brand<string, "Slug">        // /^[a-z0-9-]+$/ — option ids, badge ids
type RichHtml  = Brand<string, "RichHtml">    // sanitizeRich() output — safe to inject
type DocHtml   = Brand<string, "DocHtml">     // sanitizeDoc() output
type Frac      = number                       // 0..1 screen fraction; a brand is optional here
```

The payoff is on `innerHTML`: a function that renders `RichHtml` cannot be handed a raw string, which is the CLAUDE.md rule "never render user-supplied html without `sanitizeRich()`" enforced by the compiler. `esc()` returns `RichHtml` too (escaped text is safe). Existing cleaners become type predicates or constructors:

| Today | Becomes |
|---|---|
| `isHex(c)` | `(c: unknown): c is HexColor` |
| `cleanColor(c)` | `(c: unknown): HexColor` |
| `cleanVisibility(v)` | `(v: unknown): Visibility` |
| `cleanGimmickId(id)` | `(id: unknown): GimmickId \| null` |
| `cleanReaction(e)` | `(e: unknown): Reaction \| null` |
| `cleanPromptControls(c)` / `cleanPromptMode(m)` | `(c: unknown): PromptControls` / `PromptMode` |
| `validateIntermediateData(d)` / `validateAchievements(d)` | `(d: unknown): string[]`, with a wrapper `asIntermediate(d): IntermediateData` that throws on errors |
| `canEdit/canView/canComment` | keep as predicates over `(doc: Doc, user: User \| null)` |

## 4. Interfaces: the browser

### Mounts: a `Gimmick` base and seven extensions

All seven gimmick components take the same core options and return the same core object. `game.html` already treats them as a list when it calls `gimmicksOff()` on every one:

```ts
interface GimmickMountOpts {
  socket: Socket<ServerToClient, ClientToServer>
  document?: Document
  getMyUserId?(): string | null
  getMyColor?(): HexColor
  getMyName?(): string
}
interface DiceOpts  extends GimmickMountOpts { isSeated(): boolean; isFriendly(): boolean; onRoll?(): void; launchers: Partial<Record<GimmickId, () => void>>; getTableColors?(): HexColor[] }
interface DiscoOpts extends GimmickMountOpts { getTableColors(): HexColor[] }
interface CurseOpts extends GimmickMountOpts { getTable(): RosterWriter[]; playChime(): void }

interface Gimmick {
  start(): void
  exit(): void
  gimmicksOff(): boolean
  readonly open: boolean
  readonly others: string[]
}
interface GalagaGimmick    extends Gimmick { shoot(): void; readonly score: number; finishNow(): void }
interface MilkshakeGimmick extends Gimmick { pour(): void; readonly level: number; readonly puddleCount: number }
interface DiscoGimmick     extends Gimmick { spin(): void; readonly spotCount: number }
interface ArtRoomGimmick   extends Gimmick { wipe(): void; readonly strokeCount: number; readonly color: HexColor; readonly size: number; readonly erase: boolean }
interface SoakerGimmick    extends Gimmick { fire(): void; readonly dropCount: number }
interface CurseGimmick     extends Omit<Gimmick, "others"> { readonly cursedUserId: string | null; readonly typed: number }
interface DiceMenu         extends Omit<Gimmick, "start"> { enter(): void; roll(): void; setGate(g: GimmickGate): void; setSeated(on: boolean): void; readonly position: { x: Frac; y: Frac } }
```

Two inconsistencies the types surface, to fix during conversion rather than encode: the dice mount says `enter` where every other says `start`, and the curse has no `others`. Naming the base makes the odd ones out visible.

### Other mount families

- `Destroyable { destroy(): void }` — rich-toolbar, slash-palette, tendril-border, d20-die.
- `InboxMount { reload(): Promise<void>; readonly messages: InboxRow[] }` with `InboxPageMount extends InboxMount { open(id: string): void; close(): void }`; opts likewise `InboxPageOpts extends InboxPanelOpts { filters; pane; bulk }`.
- `GimmickGate { catalogue: GimmickDef[]; unlocked: GimmickId[]; locks: Record<GimmickId, Lock>; admin: boolean }` — the `/api/gimmicks` response, `gimmick-dice`'s gate state, AND `ranks-view`'s `gimmickListHtml` argument: one interface, three consumers. `DiceMenuGate extends GimmickGate { friendly; seated; table: GimmickId[] }`. `Lock = { tier: string; name: string; min: number } | string` — the bare-string form exists for fandom packs and must stay in the union.
- `SidePrefs { open: boolean; width: number }` — `side-drawer.js`'s stored blob, and the `sideOpen`/`sideWidth` pair inside `EditorPrefs`; the 240/560/300 clamp constants are duplicated between the two files today and become one export.
- `ConfirmOpts` with `confirmInboxDelete(opts: ConfirmInboxOpts)` a preset over it.
- `side-drawer.js`'s degraded stub returns `{ set, open }` where the real mount returns `{ setOpen, setWidth, open, width }` — a bug the type will refuse.

### View-builder inputs

- `Who` (§1) is the base for `StoryLine`, `ChatMessage`, `UserRef { username; color; avatar; avatarFit }`, and the inbox idents. `miniAvatar()` accepts `Who | UserRef` because every caller carries `username` and it falls back to it today.
- `WriterRow extends UserRef { me?: boolean; friend?: boolean; requested?: boolean; badge?: string; wordCount; online }` for the directory; `InviteRow extends UserRef { friend: boolean; requested?: boolean }` for the beta-reader picker.
- `MeStats { wordCount; badges: string[]; badgeDescs?: Record<string, string \| null>; nextBadge?: { name; min } \| null }` — what `statsText`, `badgeProgress`, `achievementsHtml`, both `ladderHtml`s and `usageListHtml` read of the signed-in user; it is a `Pick<PublicUser, …>`.
- `InboxThread { id; messages: InboxRow[]; head: InboxRow; ts; unread: boolean; replyTo: InboxRow \| null }` — produced once by `threadInbox()`, consumed by six builders.
- `LadderRow extends WordTier { themes: { id: ThemeId; label; gimmick: GimmickDef \| null }[]; gimmicks: GimmickDef[] }` — `buildLadder()` spreads the tier, which is `extends` in code already.
- `AnnouncementPost` base with the two page-specific extensions (`markdown`/`images` on the announcements page, `title` on the dashboard rows).
- `DocSummary` for every shelf row (`docShelfHtml`, `soloListHtml`, `betaReadingHtml`), `SoloRowDoc extends DocSummary { viewable?; sprintWords? }`.

### localStorage

Each key gets an interface and a typed reader that returns the interface or a default, never `any`: `RejoinBlob { code: GameCode; token: string }`, `EditorPrefs`, `DraftCache`, `SidePrefs`, and the scalar ones (`ThemeId`, font key, `"0" | "1"` for the steal opt-out, `StoryView`). The steal key is exported from two files today (`gimmick-dice.js` and `galaga-game.js`); it becomes one constant in `shared/`.

### Globals

`window.gsap` is optional everywhere and null-guarded, so it is declared `interface Window { gsap?: typeof import("gsap") }` in a `client/globals.d.ts` and the guards stay. `io` is a script-tag global on four pages: declared as `declare const io: typeof import("socket.io-client").io` in the same file. There are no other window globals.

## 5. Where this pays off first

In the order the assessment set (shared contracts → pure builders → kernel → pages), the first three items to write are:

1. **`shared/wire.ts`**: `Who`, `RosterWriter`, `StoryLine`, `ChatMessage`, `GameState` (the phase union), `Ack`, `SeatAck`, the gimmick `Live`/`Bulk` generics, and the two Socket.IO event maps. This alone types every `socket.on` in `game.html` when that script is extracted.
2. **`shared/brands.ts`**: the branded strings and the predicate signatures for the existing cleaners. `RichHtml` on every `innerHTML` sink is the security rule as a type.
3. **`shared/registries.ts`**: `THEMES`/`THEME_LABELS`, `GIMMICKS`, `EMOJI_WORDS`, `SOUND_NAMES`, `VISIBILITIES`, `MSG_KINDS` as `as const`, with their unions exported beside them. `lib/achievements.js` and `src/game.js` switch their imports from `public/js` to the emitted `public/js/shared/*.js` with no behaviour change.

Everything in §4 follows module by module as each file moves into `client/`.
