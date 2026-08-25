// A random title for a story nobody named. Pure: the word bank comes from
// content/titles.json (a fandom-pack file), the rng is injectable so a test
// can pin one, and every title is cut to MAX_TITLE characters — the same
// limit rename-session enforces, so a generated name is a legal name.
export const MAX_TITLE = 40;

const fill = (pattern, bank, rng) =>
  pattern.replace(/\{([a-z]+)\}/g, (_, key) => {
    const list = bank[key];
    return list?.length ? list[Math.floor(rng() * list.length)] : "";
  });

export function randomTitle(bank, rng = Math.random) {
  const patterns = bank?.patterns?.length ? bank.patterns : ["Untitled"];
  const pattern = patterns[Math.floor(rng() * patterns.length)];
  const title = fill(pattern, bank || {}, rng).replace(/\s+/g, " ").trim();
  if (title.length <= MAX_TITLE) return title;
  // cut on a word so it never ends mid-syllable
  const cut = title.slice(0, MAX_TITLE);
  return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,&]+$/, "");
}
