import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderHtml, usageCaseHtml, aboutHtml, avatarHtml } from "../public/js/profile-view.js";

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

test("ladderHtml: fresh account shows first tier progress, rest locked", () => {
  const out = ladderHtml(TIERS, { wordCount: 0, wordBadges: [], currentBadge: null });
  assert.ok(out.includes("0%"));
  assert.equal((out.match(/>locked</g) || []).length, 2);
});

test("usageCaseHtml: earned chips + mystery slots, never reveals triggers", () => {
  const out = usageCaseHtml(["🐺 Omega Badge"], 4);
  assert.ok(out.includes("🐺 Omega Badge"));
  assert.equal((out.match(/hidden badge/g) || []).length, 3);
  assert.ok(!/puppy|cock|moan|michael/i.test(out));
});
