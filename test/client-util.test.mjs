import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";
installDom();
import { PALETTE, esc, safeColor, isHex, whoMarks, miniAvatar, oneLinePrompt, gradEmoji, gradEmojisIn, gradAllEmojis } from "../public/js/util.js";

test("miniAvatar: img with fit class when set, empty otherwise, url escaped", () => {
  const cover = miniAvatar({ avatar: "https://img.com/a.png" });
  assert.ok(cover.includes('class="mini-avatar fit-cover"'), "cover is the default fit");
  assert.ok(cover.includes('src="https://img.com/a.png"'));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "contain" }).includes("fit-contain"));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "junk" }).includes("fit-cover"), "unknown fit falls back");
  assert.equal(miniAvatar({ avatar: "" }), "", "no picture and no name renders nothing");
  assert.equal(miniAvatar(null), "");
  // no picture but a name -> colored disc with the initial
  const disc = miniAvatar({ name: "willthewise", color: "#6c8cff" });
  assert.ok(disc.includes("mini-initial"));
  assert.ok(disc.includes("background:#6c8cff"), "disc takes the chosen color");
  assert.ok(disc.includes(">W<"), "first letter, uppercased");
  assert.ok(miniAvatar({ username: "mikey", color: "bad" }).includes(">M<"), "username works too; bad colors fall back");
  assert.ok(miniAvatar({ avatar: 'https://a.com/"x"' }).includes("&quot;x&quot;"), "attr escaped");
});

test("esc escapes every HTML-significant character", () => {
  assert.equal(esc(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.equal(esc("plain text"), "plain text");
  assert.equal(esc(123), "123", "coerces non-strings");
  assert.equal(esc('<img src=x onerror="a()">'), "&lt;img src=x onerror=&quot;a()&quot;&gt;");
});

test("safeColor passes any #rrggbb through (lowercased) and nothing else", () => {
  for (const c of PALETTE) assert.equal(safeColor(c), c);
  assert.equal(safeColor("#123ABC"), "#123abc", "a custom colour from the settings picker");
  assert.equal(isHex("#123abc"), true);
  assert.equal(isHex("#abc"), false, "short hex is not a colour here");
  assert.equal(safeColor("#abc"), PALETTE[0]);
  assert.equal(safeColor("red"), PALETTE[0]);
  assert.equal(safeColor("#12345g"), PALETTE[0]);
  assert.equal(safeColor('"><script>'), PALETTE[0]);
  assert.equal(safeColor("#123456;background:url(x)"), PALETTE[0], "nothing that could reach a style= attribute");
  assert.equal(safeColor(undefined), PALETTE[0]);
});

test("whoMarks: (host) tag for hosts (either flag), nothing otherwise", () => {
  assert.match(whoMarks({ host: true }), /\(host\)/);
  assert.match(whoMarks({ isHost: true }), /\(host\)/);
  assert.equal(whoMarks({ host: false }), "");
  assert.equal(whoMarks(null), "");
});

// ---- prompts used as titles ----
test("oneLinePrompt collapses a bulleted guided prompt for card titles", () => {
  const guided = "\u2022 Set this after Vecna.\n\u2022 They are alone in the basement.\n\u2022 Keep it tender.";
  assert.equal(oneLinePrompt(guided), "Set this after Vecna. They are alone in the basement. Keep it tender.");
  // a curated prompt passes through untouched, and blanks stay blank
  assert.equal(oneLinePrompt("Mike finds the drawing."), "Mike finds the drawing.");
  for (const blank of ["", null, undefined]) assert.equal(oneLinePrompt(blank), "");
  // a bullet inside a clause is not a line start and survives
  assert.equal(oneLinePrompt("\u2022 a \u2022 b\n\u2022 c"), "a \u2022 b c");
  assert.equal(oneLinePrompt("\n\n\u2022 only\n\n"), "only");
});

test("promptHtml lays a guided prompt out as coloured category | choice rows, and leaves a curated one plain", async () => {
  const { promptHtml } = await import("../public/js/util.js");
  const html = promptHtml("• Season: season 5 (1987)\n• Trope: only one bed\n• Kinks: hands · voice");
  assert.match(html, /^<span class="prompt-grid">/);
  assert.match(html, /<span class="pc pc-season" title="[^"]+">Season<\/span><span class="pc-val">season 5 \(1987\)<\/span>/);
  assert.match(html, /pc-trope/);
  assert.match(html, /pc-kinks/);
  // every category name carries its tooltip
  const { PROMPT_CAT_TIPS } = await import("../public/js/util.js");
  assert.match(html, /class="pc pc-season" title="When it/);
  for (const cat of ["Season", "Canon", "Place", "Relationship", "Situation", "Trope", "Tone", "Rating", "Kinks"])
    assert.ok(PROMPT_CAT_TIPS[cat], cat + " has a tooltip");
  assert.ok(!html.includes("•"), "the bullet is the grid now");
  // a curated prompt (or anything a player typed) is escaped text, never markup
  assert.equal(promptHtml("Mike <b>finds</b> the drawing."), "Mike &lt;b&gt;finds&lt;/b&gt; the drawing.");
  assert.equal(promptHtml("• Season: x\n• Nope: <i>y</i>"), "• Season: x\n• Nope: &lt;i&gt;y&lt;/i&gt;");
  assert.equal(promptHtml(""), "");
});

test("gradEmoji: wraps a leading emoji (incl. variation selectors), leaves label + emoji-less text, idempotent", () => {
  const mk = (txt) => { const el = document.createElement("a"); el.textContent = txt; return el; };
  const a = mk("📣 Announcements"); gradEmoji(a);
  assert.equal(a.innerHTML, '<span class="emoji-grad">📣</span> Announcements');
  const g = mk("🕹️ Games"); gradEmoji(g); // variation-selector emoji
  assert.match(g.innerHTML, /^<span class="emoji-grad">🕹️<\/span> Games$/);
  const plain = mk("Games in progress"); gradEmoji(plain);
  assert.equal(plain.innerHTML, "Games in progress", "no emoji, untouched");
  assert.equal(plain.querySelector(".emoji-grad"), null);
  const dbl = mk("📖 Beta"); gradEmoji(dbl); gradEmoji(dbl);
  assert.equal(dbl.querySelectorAll(".emoji-grad").length, 1, "idempotent");
  // gradEmojisIn wraps every match in a root
  const root = document.createElement("div");
  root.innerHTML = '<a>🏅 Ranks</a><a>🚪 Logout</a><h3>No emoji</h3>';
  gradEmojisIn(root, "a, h3");
  assert.equal(root.querySelectorAll(".emoji-grad").length, 2);
});

test("gradAllEmojis: every emoji gets the gradient except rank/badge and editable/input subtrees", () => {
  document.body.innerHTML = `
    <a>📣 Announcements</a>
    <button>Start ✨ now 🎲</button>
    <span class="badge-chip">🐶 Puppy</span>
    <div class="ach-strip"><span>💛</span></div>
    <div contenteditable="true">✒️ live 🎲</div>
    <textarea>keep 🎲</textarea>
    <p class="story-line">He smiled 😄 and 🎉</p>
    <span data-badge="x">🏆</span>
    <div id="chatCard" class="side-sec chat-sec"><h4>💬 Chat</h4><div class="chat-log"><div>hi 😄</div></div></div>
    <aside class="doc-side" id="docSide"><h3>💬 Comments</h3></aside>
    <button class="doc-side-tab" id="commentsOpen">💬 3</button>
    <button id="commentToggle" class="head-chip">💬 Comment</button>
    <button id="imgBtn">🖼️</button>`;
  gradAllEmojis(document.body);
  const n = (sel) => document.querySelector(sel).querySelectorAll(".emoji-grad").length;
  assert.equal(n("a"), 1);
  assert.equal(n("button"), 2, "mid-text emojis wrapped too");
  assert.equal(n(".story-line"), 2);
  assert.equal(n(".badge-chip"), 0, "rank/badge kept full colour");
  assert.equal(n(".ach-strip"), 0);
  assert.equal(n("[data-badge]"), 0);
  assert.equal(n("[contenteditable]"), 0, "editors never mutated");
  assert.equal(n("#chatCard"), 0, "the game chat's icons and messages stay plain");
  assert.equal(n("#docSide"), 0, "so do the comments drawer's (by id — the game's host drawer shares .doc-side and keeps its gradient)");
  assert.equal(n("#commentsOpen"), 0);
  assert.equal(n("#commentToggle"), 0);
  assert.equal(n("#imgBtn"), 0, "the toolbar's picture stays a picture (a gradient-filled 🖼 is an outline)");
  assert.ok(document.querySelector("textarea").value.includes("🎲"));
  assert.equal(document.querySelector(".story-line").textContent, "He smiled 😄 and 🎉", "text preserved");
});

test("gradAllEmojis leaves the SuperSoaker's gun alone", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="sk-layer"><span class="sk-gun3d"><span class="sk-emoji">🔫</span></span></div><button class="sk-gunbtn remote"><span class="sk-emoji">🔫</span></button>';
  gradAllEmojis(root);
  assert.equal(root.querySelector(".emoji-grad"), null, "the gun is not a gradient outline");
});

// ---- chat links ----
test("linkifyText: http(s) URLs become links, everything else stays escaped text", async () => {
  const { linkifyText } = await import("../public/js/util.js");
  assert.equal(linkifyText("<script>hi & bye"), esc("<script>hi & bye"), "no link → exactly esc()");
  const one = linkifyText("read https://ao3.org/works/1?view_full_work=true. ok");
  assert.equal(one, 'read <a class="chat-link" href="https://ao3.org/works/1?view_full_work=true" target="_blank" rel="noopener noreferrer nofollow">https://ao3.org/works/1?view_full_work=true</a>. ok');
  const two = linkifyText("(http://a.com/x) and https://b.com/y?z=<1>");
  assert.equal((two.match(/<a /g) || []).length, 2);
  assert.ok(two.includes('href="http://a.com/x"'), "a closing bracket is handed back to the text");
  assert.ok(two.includes('href="https://b.com/y?z="') && two.includes("</a>&lt;1&gt;") && !two.includes("<1>"), "an angle bracket ends the URL and is escaped as text");
  for (const t of ["javascript:alert(1)", "ftp://x.y/z", "www.example.com", "https:// no"]) assert.ok(!linkifyText(t).includes("<a "), t);
  assert.ok(!linkifyText('https://x.y/"onmouseover="alert(1)').includes('"onmouseover'), "quotes end the URL and are escaped");
});
