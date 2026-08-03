import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderHtml, usageCaseHtml, aboutHtml } from "../public/js/profile-view.js";

test("aboutHtml: escapes text/labels/urls, safe link rel, empty state", () => {
  const out = aboutHtml({
    about: 'I write <b>fics</b> & things',
    links: [{ label: '<script>', url: 'https://a.com/?q="x"' }],
    images: ["https://img.com/1.png"],
  });
  assert.ok(out.includes("I write &lt;b&gt;fics&lt;/b&gt; &amp; things"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes('href="https://a.com/?q=&quot;x&quot;"'), "url attr escaped");
  assert.ok(out.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(out.includes('<img class="about-img" src="https://img.com/1.png"'));
  assert.match(aboutHtml({ about: "", links: [], images: [] }), /Nothing here yet/);
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
