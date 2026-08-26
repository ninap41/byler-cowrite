import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderHtml, ladderAccordionHtml, usageCaseHtml, aboutHtml, avatarHtml } from "../public/js/profile-view.js";

test("aboutHtml: server-sanitized about injected as-is, links escaped, empty state", () => {
  const out = aboutHtml({
    // this is what the server stores: pre-escaped text + re-enabled img
    about: 'escaped &lt;b&gt; text<img class="about-img" src="https://img.com/1.png" alt="" loading="lazy">',
    links: [{ label: "<script>", url: 'https://a.com/?q="x"' }],
  });
  assert.ok(out.includes("escaped &lt;b&gt; text"), "sanitized about untouched");
  assert.ok(out.includes('<img class="about-img" src="https://img.com/1.png"'), "inline embed kept");
  assert.ok(out.includes("&lt;script&gt;"), "link label escaped");
  assert.ok(out.includes('href="https://a.com/?q=&quot;x&quot;"'), "url attr escaped");
  assert.ok(out.includes('rel="noopener noreferrer nofollow"'));
  assert.match(aboutHtml({ about: "", links: [] }), /Nothing here yet/);
});

test("avatarHtml: external pic when set, escaped initial otherwise", () => {
  assert.ok(avatarHtml({ username: "will", avatar: "https://img.com/me.png" }).includes('src="https://img.com/me.png"'));
  assert.equal(avatarHtml({ username: "will", avatar: "" }), "W");
  assert.equal(avatarHtml({ username: "<x>" }), "&lt;");
});

const TIERS = [
  { name: "🐶 Puppy Mike", min: 5000 },
  { name: "🪄 Practice", min: 10000 },
  { name: "🧙 Sorcerer", min: 20000 },
];

test("ladderHtml: earned/current/next-with-progress/locked states", () => {
  const out = ladderHtml(TIERS, {
    wordCount: 12000,
    wordBadges: ["🐶 Puppy Mike", "🪄 Practice"],
    currentBadge: "🪄 Practice",
  });
  const rows = out.split('<div class="tier').slice(1);
  assert.ok(rows[0].includes("earned") && rows[0].includes(">earned<"));
  assert.ok(rows[1].includes("current") && rows[1].includes("current rank"));
  assert.ok(rows[2].includes("60%"), "12000/20000 toward Sorcerer");
  assert.ok(rows[2].includes('width:60%'));
  assert.ok(out.includes("5,000 words"));
});

test("ladderAccordionHtml: only the current rank in the open view, full ladder folded away", () => {
  const out = ladderAccordionHtml(TIERS, {
    wordCount: 12000,
    wordBadges: ["🐶 Puppy Mike", "🪄 Practice"],
    currentBadge: "🪄 Practice",
  });
  const [visible, folded] = out.split("<details");
  assert.ok(visible.includes("🪄 Practice"), "current rank shows");
  assert.ok(!visible.includes("🐶 Puppy Mike") && !visible.includes("🧙 Sorcerer"), "other tiers only in the accordion");
  assert.ok(folded.includes("All ranks"), "accordion summary");
  for (const t of TIERS) assert.ok(folded.includes(t.name), "every tier inside the accordion");
});

test("ladderHtml: fresh account shows first tier progress, rest locked", () => {
  const out = ladderHtml(TIERS, { wordCount: 0, wordBadges: [], currentBadge: null });
  assert.ok(out.includes("0%"));
  assert.equal((out.match(/>locked</g) || []).length, 2);
});

test("usageCaseHtml: secret badges keep their tooltip until earned; open badges never do", () => {
  const all = [{ name: "🐺 Omega Badge" }, { name: "😏 Smutty Buddy" }];
  const descs = { "🐺 Omega Badge": 'Write "puppy" into a story line.' }; // earned-only, from badgeDescs
  const out = usageCaseHtml(all, ["🐺 Omega Badge"], descs);
  const [omega, smutty] = out.split("</span>");
  assert.ok(omega.includes("earned") && !omega.includes("🔒"), "earned badge glows");
  assert.ok(omega.includes('title="Write &quot;puppy&quot; into a story line."'), "earned tooltip carries the how (escaped)");
  assert.ok(smutty.includes("next") && smutty.includes("🔒"), "unearned badge locked");
  assert.ok(!smutty.includes("moan"), "a locked secret badge never explains itself");
  assert.ok(smutty.includes("Secret: unlock it to find out how."), "locked tooltip is just a teaser");

  // the open (non-secret) case: descriptions show even before earning
  const open = usageCaseHtml([{ name: "🖋 Opening Line", desc: "Write “once upon a time”." }], [], {}, { secret: false });
  assert.ok(open.includes("🔒"), "still shows as locked");
  assert.ok(open.includes("Write “once upon a time”."), "but the how is visible");
});
