// Branded strings: a `string` that has passed one of the app's validators.
// The brand is erased at runtime (this module emits nothing but a type
// export), but at compile time a HexColor cannot be handed a raw string and
// a RichHtml is the only thing an innerHTML sink accepts — the CLAUDE.md
// rule "never render user html without sanitizeRich()" as a type. See
// docs/TYPES.md §3 for the validator each brand is backed by.
declare const __brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type HexColor = Brand<string, "HexColor"> // isHex / cleanColor / safeColor: #rrggbb, lowercase
export type GameCode = Brand<string, "GameCode"> // CODE_RE: four upper-case letters/digits
export type Cid = Brand<string, "Cid"> // CID_RE: a 12-hex comment anchor id
export type ChapterId = Brand<string, "ChapterId"> // CH_ID_RE: 12 hex
export type DocId = Brand<string, "DocId"> // ID_RE: a uuid
export type UserId = Brand<string, "UserId"> // a uuid
export type HttpUrl = Brand<string, "HttpUrl"> // httpUrl(): http(s) only
export type Email = Brand<string, "Email"> // EMAIL_RE
export type Slug = Brand<string, "Slug"> // /^[a-z0-9-]+$/ — option ids, badge ids
export type RichHtml = Brand<string, "RichHtml"> // sanitizeRich() output (or esc()'d text): safe to inject
export type DocHtml = Brand<string, "DocHtml"> // sanitizeDoc() output: the wider document subset
/** A screen fraction, 0..1 — where a gimmick sits on its owner's screen. */
export type Frac = number

/** Assert a brand where the value is known-good (a literal, a validator's own return). */
export const brand = <B extends Brand<string, string>>(s: string): B => s as B
