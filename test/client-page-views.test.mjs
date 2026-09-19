import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onlineUsersHtml, liveGameInfoHtml, statsText, badgeProgress, coverArt, coverStyle,
  myGameStatus, myGameCardHtml, recentRowHtml, achievementsHtml, streakRingHtml, streakMetaHtml, STREAK_TIP, writerRowHtml, filterWriters, writerRanks, WORD_BANDS, inboxMsgHtml, replyBoxHtml, chainMsgHtml, threadInbox, foldBtnHtml,
} from "../public/js/dashboard-view.js";
import { gameCardHtml, archiveMetaText, archiveStoryHtml } from "../public/js/archive-view.js";

// ---- dashboard ----
test("onlineUsersHtml: escapes names, marks me, empty fallback", () => {
  const out = onlineUsersHtml([
    { username: "<x>", color: "#6c8cff", badge: "✏️ Inkling", me: true },
    { username: "mike", color: "junk", badge: null },
  ]);
  assert.ok(out.includes("&lt;x&gt; (you)"));
  assert.ok(out.includes("✏️ Inkling"));
  assert.ok(out.includes("#e63946"), "junk color falls back");
  assert.match(onlineUsersHtml([]), /Nobody online/);
});

test("liveGameInfoHtml: phase label, host crown, online count", () => {
  const out = liveGameInfoHtml({
    code: "AB12", name: "The <Tale>", phase: "writing", hostName: "will",
    players: [{ name: "will", connected: true }, { name: "mike", connected: false }],
  });
  assert.ok(out.includes("The &lt;Tale&gt;"));
  assert.ok(out.includes("AB12 · writing"));
  assert.ok(out.includes("will (host)") || out.includes("will</b> (host)") || /will.*\(host\)/.test(out), "host tagged");
  assert.ok(out.includes("1/2 online"));
});

test("statsText: singulars, next-badge distance, ladder top", () => {
  assert.equal(
    statsText({ wordCount: 99, badges: ["a"], nextBadge: { min: 100, name: "🖊️ Scribbler" } }),
    "99 words written · 1 badge · 1 word to 🖊️ Scribbler",
  );
  assert.equal(statsText({ wordCount: 20000, badges: ["a", "b"], nextBadge: null }), "20000 words written · 2 badges");
});

test("badgeProgress: fill = words / next rank's cost (what the label says); sliver; topped-out ladder", () => {
  assert.deepEqual(badgeProgress({ wordCount: 23, nextBadge: { min: 100, name: "🖊️ Scribbler" } }),
    { pct: 23, label: "23 / 100 words to 🖊️ Scribbler" });
  assert.equal(badgeProgress({ wordCount: 5913, nextBadge: { min: 10000, name: "x" } }).pct, 59, "not stuck at 1% under halfway");
  assert.equal(badgeProgress({ wordCount: 8, nextBadge: { min: 5000, name: "🐶 Puppy Mike" } }).pct, 1,
    "any words at all show a sliver");
  assert.match(badgeProgress({ wordCount: 8, nextBadge: { min: 5000, name: "🐶 Puppy Mike" } }).label,
    /8 \/ 5,000 words/);
  assert.equal(badgeProgress({ wordCount: 0, nextBadge: { min: 5000, name: "x" } }).pct, 0);
  // 99 written of 100: 99, and never 100 until the rank is actually earned
  assert.equal(badgeProgress({ wordCount: 99, nextBadge: { min: 100, name: "x" } }).pct, 99);
  assert.equal(badgeProgress({ wordCount: 75, nextBadge: { min: 100, name: "x" } }).pct, 75);
  assert.equal(badgeProgress({ wordCount: 50000, nextBadge: null }).pct, 100);
});

test("filterWriters: name, word band, friends vs not, and rank combine; my own row is neither friend nor stranger", () => {
  const rows = [
    { username: "Will", color: "#6c8cff", wordCount: 12000, badge: "🎨 Painter", friend: true },
    { username: "mike", color: "#6c8cff", wordCount: 999, badge: "✏️ Inkling" },
    { username: "El", color: "#6c8cff", wordCount: 1000, badge: "✏️ Inkling", requested: true },
    { username: "newbie", color: "#6c8cff", wordCount: 0, badge: null },
    { username: "self", color: "#6c8cff", wordCount: 60000, badge: "🎨 Painter", me: true },
  ];
  const names = (f) => filterWriters(rows, f).map((u) => u.username);
  assert.deepEqual(names({}), ["Will", "mike", "El", "newbie", "self"], "no filter, everyone");
  assert.deepEqual(names({ q: " wIL " }), ["Will"], "the name search is trimmed and caseless");
  assert.deepEqual(names({ words: "0" }), ["mike", "newbie"], "999 is under 1,000");
  assert.deepEqual(names({ words: "1k" }), ["El"], "1,000 opens the next band");
  assert.deepEqual(names({ words: "50k" }), ["self"], "the top band has no ceiling");
  assert.deepEqual(names({ who: "friends" }), ["Will"]);
  assert.deepEqual(names({ who: "others" }), ["mike", "El", "newbie"], "a pending request is not a friend yet; I am not a stranger to myself");
  assert.deepEqual(names({ rank: "✏️ Inkling" }), ["mike", "El"]);
  assert.deepEqual(names({ rank: "none" }), ["newbie"]);
  assert.deepEqual(names({ rank: "🎨 Painter", who: "friends", words: "10k" }), ["Will"], "filters combine");
  assert.deepEqual(names({ words: "nonsense", who: "nonsense" }), ["Will", "mike", "El", "newbie", "self"], "an unknown choice filters nothing");
  assert.deepEqual(writerRanks(rows), ["✏️ Inkling", "🎨 Painter"], "ranks held by someone, lowest first");
  for (let i = 1; i < WORD_BANDS.length; i++) assert.equal(WORD_BANDS[i].min, WORD_BANDS[i - 1].max, "the bands leave no gap");
});

test("writerRowHtml: escapes, online dot, and the tail is the friend state — friend / requested / Add friend / nothing on my own row", () => {
  const on = writerRowHtml({ username: "<will>", color: "#6c8cff", wordCount: 1234, badge: "🐶 Puppy Mike", online: true, friend: true });
  assert.ok(on.includes("&lt;will&gt;"));
  assert.ok(on.includes("st-dot on"));
  assert.ok(on.includes("1,234 words"));
  assert.ok(!on.includes("🐶 Puppy Mike"), "the badge chip gave way to the friend state");
  assert.ok(on.includes('class="badge-chip friend">friend<'));
  const asked = writerRowHtml({ username: "dustin", color: "#6c8cff", wordCount: 5, online: true, requested: true });
  assert.ok(asked.includes('class="badge-chip requested">requested<'));
  assert.ok(!asked.includes("data-add-friend"));
  const me = writerRowHtml({ username: "self", color: "#6c8cff", wordCount: 5, online: true, me: true });
  assert.ok(!me.includes("badge-chip") && !me.includes("data-add-friend"), "my own row has no friend state");
  const off = writerRowHtml({ username: "mike", color: "bad", wordCount: 0, badge: null, online: false });
  assert.ok(off.includes("st-dot off"));
  assert.ok(!off.includes("badge-chip"));
  assert.ok(off.includes('data-add-friend="mike"') && off.includes(">Add friend<"), "a stranger gets an Add friend button");
  assert.ok(off.includes("mini-initial"), "no picture -> colored initial disc");
  const pic = writerRowHtml({ username: "el", color: "#e879c9", wordCount: 1, online: true,
    avatar: "https://img.com/el.png", avatarFit: "contain" });
  assert.ok(pic.includes('mini-avatar fit-contain'), "directory rows show the profile pic with fit pref");
});

test("coverArt is deterministic per code and palette-bound", () => {
  assert.equal(coverArt("AB12"), coverArt("AB12"));
  assert.match(coverArt("AB12"), /^background:linear-gradient\(\d+deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
});

test("myGameStatus covers every phase", () => {
  assert.equal(myGameStatus({ phase: "waiting" }).text, "Gathering writers");
  assert.equal(myGameStatus({ phase: "choosing" }).text, "Voting on a scenario");
  assert.deepEqual(myGameStatus({ phase: "writing", myTurn: true }), { text: "● Your turn: write!", cls: "is-turn" });
  assert.equal(myGameStatus({ phase: "writing", paused: true }).cls, "is-paused");
  assert.equal(myGameStatus({ phase: "writing", currentName: "mike" }).text, "Waiting for mike");
  assert.equal(myGameStatus({ phase: "writing" }).text, "In progress");
});

test("myGameCardHtml: escapes name, shows player dots with offline state", () => {
  const out = myGameCardHtml({
    code: "AB12", name: "<b>Tale</b>", phase: "writing", myTurn: true, paused: false,
    players: [{ name: "will", color: "#6c8cff", connected: true }, { name: "mike", color: "bad", connected: false }],
    lines: 3, words: 40,
  });
  assert.ok(out.includes("&lt;b&gt;Tale&lt;/b&gt;"));
  assert.ok(out.includes("is-turn"));
  assert.ok(out.includes('mg-dot off'), "offline dot dimmed");
  assert.ok(out.includes("2 writers · 40 words"), "writers and words, not lines");
});

test("recentRowHtml + achievementsHtml + streakRingHtml", () => {
  const row = recentRowHtml({ code: "AB12", name: "<Done>", prompt: "", lines: 1, words: 1234, writers: [{ name: "w" }] });
  assert.ok(row.includes("&lt;Done&gt;"));
  assert.ok(row.includes("1 writer · 1,234 words"), "writers and words, not lines");
  assert.ok(row.includes('data-act="write-more"'), "a Write more button");

  const ach = achievementsHtml({ badges: ["✏️ Inkling"], nextBadge: { name: "🖊️ Scribbler", min: 100 } });
  assert.ok(ach.includes("✏️ Inkling"));
  assert.ok(ach.includes("? 🖊️ Scribbler · 100 words"));
  assert.match(achievementsHtml({ badges: [], nextBadge: null }), /first line/);

  const ring = streakRingHtml(3, 7);
  assert.ok(ring.includes('aria-label="3-day streak"'));
  assert.ok(ring.includes("3d"));
  const meta = streakMetaHtml(1, 12);
  assert.ok(meta.includes("<b>1 day</b> current streak") && meta.includes("Best: 12 days"), "singular and plural days");
  assert.ok(meta.includes('class="streak-help"') && meta.includes('aria-label="How streaks work"'), "a ? button says how it works");
  assert.ok(meta.includes('data-tip="') && meta.includes("don&#39;t") && !/data-tip="[^"]*'/.test(meta), "the tip is escaped into its attribute");
  for (const fact of [/one line in a game/, /missed day/, /midnight UTC/, /Solo writes don't count/]) assert.match(STREAK_TIP, fact);
  const full = streakRingHtml(7, 7);
  assert.ok(full.includes('stroke-dashoffset="0.0"'), "at best -> full ring");
});

// ---- archive ----
test("gameCardHtml: escapes everything, marks host writers, counts writers and words", () => {
  const out = gameCardHtml({
    code: "AB12", name: "<b>N</b>", prompt: "<i>P</i>", phase: "over", lines: 1, words: 2500,
    hostName: "will", savedAt: 0,
    writers: [{ name: "will", isHost: true }, { name: "mike", isHost: false }],
  });
  assert.ok(out.includes("&lt;b&gt;N&lt;/b&gt;"));
  assert.ok(!out.includes("&lt;i&gt;P&lt;/i&gt;"), "named games show the name INSTEAD of the prompt");
  assert.ok(out.includes("2 writers · 2,500 words"));
  assert.ok(out.includes("finished"));
  assert.ok(out.includes("will (host), mike"));
  const unnamed = gameCardHtml({
    code: "AB12", name: "", prompt: "<i>P</i>", phase: "over", lines: 1,
    hostName: "will", savedAt: 0, writers: [],
  });
  assert.ok(unnamed.includes("&lt;i&gt;P&lt;/i&gt;"), "unnamed games fall back to the prompt");
});

test("archiveMetaText + archiveStoryHtml: sanitized html as-is, names escaped, empty state", () => {
  assert.match(archiveMetaText({ code: "AB12", phase: "writing", savedAt: 0 }), /^AB12 · paused · /);
  const out = archiveStoryHtml([{ name: "<will>", color: "bad", html: "<b>line</b>", host: true }]);
  assert.ok(out.includes("<b>line</b>"), "server-sanitized html untouched");
  assert.ok(out.includes("&lt;will&gt;"));
  assert.ok(out.includes("(host)"));
  assert.match(archiveStoryHtml([]), /Nothing written yet/);
});

test("coverStyle: linked image layers over the code gradient; falls back to gradient", () => {
  assert.equal(coverStyle({ code: "AB12" }), coverArt("AB12"), "no cover -> gradient only");
  const withCover = coverStyle({ code: "AB12", cover: "https://x.example/y.png" });
  assert.match(withCover, /^background:url\('https:\/\/x\.example\/y\.png'\) center\/cover no-repeat, linear-gradient\(/);
  const escaped = coverStyle({ code: "AB12", cover: `https://x/y.png'"` });
  assert.ok(!escaped.includes(`png'"`), "quotes in the url are escaped for the style attr");
  // the image cover also drives the card + row builders
  assert.ok(myGameCardHtml({ code: "AB12", cover: "https://x.example/y.png", players: [], lines: 0 }).includes("url("), "mg card uses it");
  assert.ok(!myGameCardHtml({ code: "AB12", cover: "https://x.example/y.png", players: [], lines: 0 }).includes("mg-glyph"), "glyph hidden under an image");
  assert.ok(gameCardHtml({ code: "AB12", cover: "https://x.example/y.png", writers: [], lines: 0, phase: "over" }).includes("gc-cover"), "archive card thumb");
});

test("inboxMsgHtml labels a help question and escapes what the asker typed", () => {
  const q = inboxMsgHtml({
    id: "1", type: "help", text: "<img src=x onerror=1> is this a bug?", read: false, ts: Date.now(),
    from: { username: "robinbuckley", color: "#6c8cff", badge: "", avatar: "", avatarFit: "cover" },
  });
  assert.ok(q.includes("help question"), "the admin can tell it apart from a friendly note");
  assert.ok(q.includes("robinbuckley"), "and who asked");
  assert.ok(!q.includes("<img"), "the question is escaped, not rendered");

  const note = inboxMsgHtml({ id: "2", type: "note", text: "answered!", read: true, ts: Date.now(), from: null });
  assert.ok(!note.includes("help question"), "an ordinary note wears no tag");
});

test("an inbox row says who a message is between: sender → recipient by username, 'You' on my side", () => {
  const from = { username: "ninaadmin", color: "#6c8cff", badge: "", avatar: "", avatarFit: "cover" };
  const to = { username: "mikester", color: "#ff6c6c", badge: "", avatar: "", avatarFit: "cover" };
  const got = inboxMsgHtml({ id: "1", type: "note", text: "hi", read: true, ts: Date.now(), from, to });
  assert.ok(got.includes('class="ib-who"'));
  assert.ok(got.indexOf("ninaadmin") < got.indexOf("ib-arrow") && got.indexOf("ib-arrow") < got.indexOf("<b>You</b>"), "received: them → You");
  const sent = chainMsgHtml({ id: "2", type: "note", text: "hi", read: true, ts: Date.now(), from, to, mine: true });
  assert.ok(sent.indexOf("<b>You</b>") < sent.indexOf("ib-arrow") && sent.indexOf("ib-arrow") < sent.indexOf("mikester"), "sent: You → them");
  assert.ok(!sent.includes("ninaadmin"), "my own name isn't spelled out on my sent copy");
  const sys = inboxMsgHtml({ id: "3", type: "system", text: "welcome", read: true, ts: Date.now(), from: null });
  assert.ok(!sys.includes("ib-who") && !sys.includes("ib-arrow"), "a system note names nobody");
  const old = inboxMsgHtml({ id: "4", type: "note", text: "old", read: true, ts: Date.now(), from, mine: true, to: null });
  assert.ok(old.includes("<b>You</b>") && !old.includes("ib-arrow"), "an old sent copy with no recipient stays 'You'");
});

test("a conversation carries an open composer; system notes carry none", () => {
  const from = { username: "ninaadmin", color: "#6c8cff", badge: "", avatar: "", avatarFit: "cover" };
  const row = inboxMsgHtml({ id: "1", type: "note", text: "hello", read: true, ts: Date.now(), from });
  assert.ok(row.includes("ib-reply"), "the composer ships with the row");
  assert.ok(row.includes("ib-reply hidden"), "folded until Reply is pressed");
  assert.ok(row.includes("<textarea"), "an inline textarea, not a browser prompt");
  assert.ok(row.includes("ib-reply-send"), "send");
  assert.ok(!row.includes("ib-reply-cancel"), "and no cancel: nothing to close");
  assert.ok(row.includes('maxlength="1000"'), "matched to the server's limit");
  // it sits after the conversation, addressed to whoever spoke last
  const other = { username: "mikewheeler", color: "#e63946" };
  const threaded = inboxMsgHtml(
    { id: "1", type: "help", text: "q", read: true, ts: 1, from },
    { chain: [{ id: "2", text: "later", ts: 2, from: other }], replyTo: { id: "2", text: "later", ts: 2, from: other } },
  );
  assert.ok(threaded.indexOf("ib-chain") < threaded.indexOf("ib-reply"), "composer at the foot");
  assert.match(threaded, /placeholder="Reply to mikewheeler/);

  const system = inboxMsgHtml({ id: "2", type: "system", text: "welcome", read: true, ts: Date.now(), from: null });
  assert.ok(!system.includes("ib-reply"), "there is nobody to answer a system note");
  const fr = inboxMsgHtml({ id: "3", type: "friend-request", text: "wants to be friends", read: false, ts: 1, from });
  assert.ok(!fr.includes("ib-reply"), "a friend request is answered with Accept/Decline, not words");
});

test("a preview row carries no composer at all, replies live in the inbox", () => {
  const from = { username: "ninaadmin", color: "#6c8cff", badge: "", avatar: "", avatarFit: "cover" };
  const m = { id: "1", type: "note", text: "hello", read: true, ts: Date.now(), from };
  const preview = inboxMsgHtml(m, { reply: false });
  assert.ok(!preview.includes("ib-reply"), "no folded composer");
  assert.ok(!preview.includes("<textarea"), "and nothing focusable to steal a click");
  assert.ok(preview.includes("hello"), "it is still the whole message");
  assert.ok(inboxMsgHtml(m).includes("ib-reply"), "the default is still a full row");
});

test("a chained row renders the conversation under its first message", () => {
  const from = { username: "ninaadmin", color: "#6c8cff", badge: "", avatar: "", avatarFit: "cover" };
  const chain = [
    { id: "2", text: "my answer", read: true, ts: Date.now(), mine: true, from },
    { id: "3", text: "<b>thanks</b>", read: false, ts: Date.now(), from },
  ];
  const html = inboxMsgHtml({ id: "1", type: "help", text: "a question", read: true, ts: Date.now(), from }, { chain });
  assert.ok(html.includes("ib-chain"), "the follow-ups are attached to the row");
  assert.equal(html.match(/class="ib-chain-msg/g).length, 2);
  assert.ok(!html.includes("<b>thanks</b>"), "chained text is escaped like any other");
  // my own half says so and is sided; theirs names them
  assert.ok(chainMsgHtml(chain[0]).includes(">You<"));
  assert.ok(chainMsgHtml(chain[0]).includes("ib-chain-msg mine"));
  assert.ok(chainMsgHtml(chain[1]).includes("ninaadmin"));
  assert.ok(chainMsgHtml(chain[1]).includes("unread"));
  // an empty chain adds nothing
  assert.ok(!inboxMsgHtml({ id: "1", text: "x", ts: 1, from }, { chain: [] }).includes("ib-chain"));
});

test("threadInbox groups an inbox into conversations, newest exchange first", () => {
  const from = { username: "mike", color: "#6c8cff" };
  const msgs = [
    { id: "a", threadId: "a", text: "old lone note", read: true, ts: 100, from },
    { id: "b", threadId: "b", text: "question", read: true, ts: 200, from: null, mine: true },
    { id: "c", threadId: "b", text: "answer", read: false, ts: 300, from },
    { id: "d", threadId: "b", text: "my thanks", read: true, ts: 400, mine: true, from },
    { id: "e", text: "no thread field at all", read: true, ts: 50, from },
  ];
  const threads = threadInbox(msgs);
  assert.equal(threads.length, 3, "two lone messages and one conversation");
  assert.deepEqual(threads.map((t) => t.id), ["b", "a", "e"], "ordered by the newest message in each");
  const convo = threads[0];
  assert.deepEqual(convo.messages.map((m) => m.id), ["b", "c", "d"], "oldest first, so it reads downward");
  assert.equal(convo.head.text, "question");
  assert.equal(convo.unread, true, "one unread message makes the conversation unread");
  assert.equal(convo.replyTo.id, "c", "answer the last thing THEY said, not my own last word");
  // a message with no threadId is a conversation of one
  assert.equal(threads[2].messages.length, 1);
  assert.equal(threads[2].replyTo.id, "e");
  // nothing to answer when every message is mine or from the system
  assert.equal(threadInbox([{ id: "x", text: "sys", ts: 1, from: null }])[0].replyTo, null);
  assert.deepEqual(threadInbox([]), []);
});

test("the composer's placeholder names the recipient, escaped", () => {
  const html = replyBoxHtml({ from: { username: '"><img src=x>', color: "#6c8cff" } });
  assert.ok(!html.includes("<img"), "a hostile username can't break out of the attribute");
  assert.ok(html.includes("placeholder=\"Reply to "));
});

test("a threaded conversation can be folded, and the button says how much it hides", () => {
  const from = { username: "kali", color: "#f0f" };
  const chain = [{ id: "2", text: "later", ts: 2, mine: true, read: true }];
  const folded = inboxMsgHtml({ id: "1", text: "hi", ts: 1, read: true, from }, { chain, fold: true });
  assert.ok(folded.includes("ib-fold"), "the fold button is offered");
  assert.ok(folded.indexOf("ib-fold") < folded.indexOf("ib-chain"), "it sits above what it hides");
  assert.ok(!inboxMsgHtml({ id: "1", text: "hi", ts: 1, read: true, from }, { chain }).includes("ib-fold"),
    "no fold unless the surface asks for one");
  assert.ok(!inboxMsgHtml({ id: "1", text: "hi", ts: 1, read: true, from }, { chain: [], fold: true }).includes("ib-fold"),
    "a conversation of one has nothing to fold");
  assert.match(foldBtnHtml(1), /1 reply</);
  assert.match(foldBtnHtml(3), /3 replies</);
});

test("dashboard: the host's card menu offers End & reveal and Delete behind confirms, and both are disabled while the game is active", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../public/js/pages/dashboard.js", import.meta.url), "utf-8"); // the page's script, emitted from client/pages/dashboard.ts
  assert.match(html, /import \{ confirmDialog \} from "\/js\/components\/confirm-delete\.js"/);
  assert.match(html, /const isActive = \(g\) => g\.live && !g\.paused/, "active = a live session that isn't paused");
  assert.match(html, /data-act="end" \$\{active \? "disabled" : ""\}/);
  assert.match(html, /data-act="delete" \$\{active \? "disabled" : ""\}/);
  assert.match(html, /if \(g\.hosted\) \{/, "host only");
  assert.match(html, /confirmLabel: "End & reveal"/);
  assert.match(html, /confirmLabel: "Delete forever"/);
  assert.match(html, /"\/api\/games\/" \+ encodeURIComponent\(g\.code\) \+ "\/end"/);
  assert.match(html, /"\/api\/games\/" \+ encodeURIComponent\(g\.code\), null, "DELETE"/);
  assert.ok(!/mg-del\b/.test(html), "the bare Delete button is gone");
});

test("archive: only the host may continue a story, canContinue is host-only, by username", async () => {
  const { canContinue } = await import("../public/js/archive-view.js");
  assert.equal(canContinue({ hostName: "mikewheeler" }, "mikewheeler"), true, "the host can continue");
  assert.equal(canContinue({ hostName: "mikewheeler" }, "willbyers"), false, "a contributor cannot");
  assert.equal(canContinue({ hostName: "mikewheeler" }, null), false, "signed out cannot");
  assert.equal(canContinue({ hostName: "" }, "willbyers"), false, "no host named, no continue");
  assert.equal(canContinue(null, "x"), false);
  // and the page hides the buttons through it, not with an ad-hoc check
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../public/js/pages/archive.js", import.meta.url), "utf-8"); // emitted from client/pages/archive.ts
  assert.match(html, /import \{[^}]*canContinue[^}]*\} from "\/js\/archive-view\.js"/);
  assert.match(html, /canContinue\(g, me\?\.username\)/, "the card's Continue is gated");
  assert.match(html, /canContinue\(g, me\?\.username\)/, "the detail's Continue too");
});

test("dashboard announcement glimpse: truncated plain-text preview, escaped, Read more to /announcements, nothing without a post", async () => {
  const { latestAnnouncementHtml, previewText, PREVIEW_CHARS } = await import("../public/js/dashboard-view.js");
  assert.equal(latestAnnouncementHtml(null), "");
  assert.equal(latestAnnouncementHtml(undefined), "");
  const long = "word ".repeat(80).trim();
  const html = latestAnnouncementHtml({ id: "a", title: "Big <news>", html: `<h2>Big news</h2><p>${long}</p>`, at: 1_700_000_000_000 });
  assert.ok(html.includes("Big &lt;news&gt;") && !html.includes("<news>"), "title escaped");
  assert.ok(html.includes('href="/announcements"') && html.includes("Read more"));
  assert.ok(!html.includes("<h2>"), "markup is stripped from the preview");
  const preview = previewText(`<h2>Big news</h2><p>${long}</p>`);
  assert.ok(preview.length <= PREVIEW_CHARS + 1 && preview.endsWith("…"), "cut on a word with an ellipsis");
  assert.ok(preview.startsWith("Big news word"), "block boundaries become spaces");
  assert.equal(previewText("<p>short</p>"), "short");
  assert.equal(previewText("<p>the writers&#39; reference &amp; more</p>"), "the writers' reference & more", "stored entities are decoded once");
  const plain = latestAnnouncementHtml({ id: "b", title: "No heading here, just words", html: "<p>No heading here, just words</p>", at: 1 });
  assert.ok(!plain.includes("ann-glimpse-title"), "a derived title is not repeated above the preview");
  assert.ok(plain.includes("<p class=\"ann-glimpse-text\">No heading here, just words <a class=\"ann-glimpse-more\""), "the preview, with Read more riding its last line");
});

test("a friend row has no badge chip, carries a ✉ for the composer, and its tooltip lists the stats", async () => {
  const { friendRowHtml, friendStatsTip } = await import("../public/js/dashboard-view.js");
  const u = { username: "mikewheeler", color: "#ff5252", badge: "Puppy Mike", online: true, wordCount: 1234, badges: 2, games: 1 };
  const html = friendRowHtml(u);
  assert.ok(!html.includes("badge-chip"));
  assert.match(html, /class="rg-msg" data-msg="mikewheeler"/);
  assert.equal(friendStatsTip(u), "Online · Puppy Mike · 1,234 words · 2 badges · 1 game");
  assert.match(friendStatsTip({ username: "x", online: false }), /^Offline$/);
});

test("joinLiveRowsHtml: the join modal's list — one .live-game per running game with a data-join button, gathering only when I'm not seated", async () => {
  const { joinLiveRowsHtml } = await import("../public/js/dashboard-view.js");
  assert.match(joinLiveRowsHtml([], "me"), /No games running right now/);
  const games = [
    { code: "ABCD", name: "One", phase: "waiting", players: [{ name: "other", connected: true }] },
    { code: "EFGH", name: "Two", phase: "waiting", players: [{ name: "me", connected: true }] },
    { code: "IJKL", name: "Three", phase: "writing", players: [{ name: "other", connected: true }] },
  ];
  const html = joinLiveRowsHtml(games, "me");
  assert.equal((html.match(/class="live-game/g) || []).length, 3);
  assert.equal((html.match(/class="live-game gathering"/g) || []).length, 1, "only the waiting game I'm not in gathers");
  for (const code of ["ABCD", "EFGH", "IJKL"]) assert.ok(html.includes(`data-join="${code}">Join</button>`), code + " joins");
  assert.ok(html.includes("--lg-i:2"), "rows are staggered");
});
