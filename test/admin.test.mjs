// Admin moderation: joining and ending any game, editing/deleting any story,
// and removing inactive accounts. Admin comes from a fixed email list in
// store.js — every test here also checks a normal account CAN'T do the thing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

const ADMIN_EMAIL = "admin@cowrite.test";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const makeAdmin = (c, username = "ninaadmin") => signup(c, username, ADMIN_EMAIL);

test("the listed email is an admin at signup AND at every sign-in", async () => {
  const c = await startServer();
  try {
    const s = await c.api("/api/signup", { email: ADMIN_EMAIL, username: "ninaadmin", password: "1234" });
    assert.equal(s.data.user.admin, true, "admin from the moment the account exists");
    const login = await c.api("/api/login", { user: "ninaadmin", password: "1234" });
    assert.equal(login.data.user.admin, true, "and again on the way back in");
    const normie = await signup(c, "lucassinclair", "lucas@sinclair.com");
    assert.equal(normie.user.admin, false);
    const denied = await c.api("/api/admin/users", undefined, normie.token);
    assert.equal(denied.status, 403, "a normal account is refused the admin routes");
  } finally {
    await c.stop();
  }
});

test("admin joins a started game without the host's approval; a stranger is still gated", async () => {
  const c = await startServer();
  try {
    const { code, A } = await startedGame(c);
    const admin = await makeAdmin(c);
    const stranger = await signup(c, "maxmayfield", "max@mayfield.com");

    const S = await c.conn();
    const gated = await c.emit(S, "join-session", { code, auth: stranger.token });
    assert.equal(gated.pending, true, "a normal latecomer needs the host");

    const M = await c.conn();
    const seated = await c.emit(M, "join-session", { code, auth: admin.token });
    assert.equal(seated.ok, true);
    assert.ok(!seated.pending, "the admin walks straight in");
    assert.equal(seated.phase, "writing");
    assert.ok(seated.token, "and gets a real seat");
    A.disconnect();
    S.disconnect();
    M.disconnect();
  } finally {
    await c.stop();
  }
});

test("admin can end a game they're sitting in; a non-host writer can't", async () => {
  const c = await startServer();
  try {
    const { code, B } = await startedGame(c);
    const nope = await c.emit(B, "end-game", {});
    assert.equal(nope.ok, false, "an ordinary writer is not the host");

    const admin = await makeAdmin(c);
    const M = await c.conn();
    await c.emit(M, "join-session", { code, auth: admin.token });
    const over = new Promise((r) => M.on("game-over", r));
    const ended = await c.emit(M, "end-game", {});
    assert.equal(ended.ok, true);
    await over;
  } finally {
    await c.stop();
  }
});

test("admin ends a game in progress from outside it, over HTTP", async () => {
  const c = await startServer();
  try {
    const { code, A } = await startedGame(c);
    const admin = await makeAdmin(c);
    const normie = await signup(c, "dustinbun", "dustin@henderson.com");

    const denied = await c.api(`/api/admin/games/${code}/end`, {}, normie.token);
    assert.equal(denied.status, 403);

    const list = await c.api("/api/admin/games", undefined, admin.token);
    assert.ok(list.data.games.some((g) => g.code === code), "the moderation view sees games the admin isn't in");

    const over = new Promise((r) => A.on("game-over", r));
    const r = await c.api(`/api/admin/games/${code}/end`, {}, admin.token);
    assert.equal(r.status, 200);
    await over; // the players get their reveal

    const again = await c.api(`/api/admin/games/${code}/end`, {}, admin.token);
    assert.equal(again.status, 404, "a finished game has nothing left to end");
  } finally {
    await c.stop();
  }
});

test("admin edits and deletes lines they did not write; a normal writer cannot", async () => {
  const c = await startServer();
  try {
    const { code, A, B, state } = await startedGame(c);
    const first = state.current.writers.find((w) => w.id === state.current.currentId);
    const author = first.id === state.current.writers[0].id ? A : B;
    const other = author === A ? B : A;
    await c.emit(author, "submit-line", { text: "the first line" });
    await c.wait(100);

    const refused = await c.emit(other, "edit-line", { index: 0, text: "not mine" });
    assert.equal(refused.ok, false, "writers only touch their own lines");

    const admin = await makeAdmin(c);
    const M = await c.conn();
    await c.emit(M, "join-session", { code, auth: admin.token });
    const edited = await c.emit(M, "edit-line", { index: 0, text: "moderated" });
    assert.equal(edited.ok, true);
    await c.wait(100);
    const removed = await c.emit(M, "delete-line", { index: 0 });
    assert.equal(removed.ok, true);
  } finally {
    await c.stop();
  }
});

test("admin deletes and reads any story; a stranger gets 403 for both", async () => {
  const c = await startServer();
  try {
    const { code } = await startedGame(c);
    const admin = await makeAdmin(c);
    const stranger = await signup(c, "eddiemunson", "eddie@munson.com");

    assert.equal((await c.api(`/api/games/${code}`, undefined, stranger.token)).status, 403);
    assert.equal((await c.api(`/api/games/${code}`, undefined, admin.token)).status, 200, "admins can read it");
    assert.equal((await c.api(`/api/games/${code}`, null, stranger.token, "DELETE")).status, 403);
    assert.equal((await c.api(`/api/games/${code}`, null, admin.token, "DELETE")).status, 200);
    assert.equal((await c.api(`/api/games/${code}`, undefined, admin.token)).status, 404, "gone for good");
  } finally {
    await c.stop();
  }
});

test("admin sees when accounts were last active and can remove an inactive one", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const idle = await signup(c, "jonathanb", "jonathan@byers.com");

    const list = await c.api("/api/admin/users", undefined, admin.token);
    const row = list.data.users.find((u) => u.username === "jonathanb");
    assert.ok(row, "every account is listed");
    assert.ok(row.lastSeen > 0, "signing up counts as being seen");
    assert.equal(row.email, "jonathan@byers.com");

    const denied = await c.api("/api/admin/users/jonathanb", null, idle.token, "DELETE");
    assert.equal(denied.status, 403, "a user can't wield the admin route on anyone");

    const gone = await c.api("/api/admin/users/jonathanb", null, admin.token, "DELETE");
    assert.equal(gone.status, 200);
    assert.equal((await c.api("/api/me", undefined, idle.token)).status, 401, "their sessions die with them");
    const after = await c.api("/api/admin/users", undefined, admin.token);
    assert.ok(!after.data.users.some((u) => u.username === "jonathanb"));
    assert.equal((await c.api("/api/admin/users/nobodyhere", null, admin.token, "DELETE")).status, 404);
  } finally {
    await c.stop();
  }
});

test("an admin account can't be removed, not even by another admin route call", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const r = await c.api("/api/admin/users/ninaadmin", null, admin.token, "DELETE");
    assert.equal(r.status, 403);
    assert.match(r.data.error, /Admin accounts/);
    assert.equal((await c.api("/api/me", undefined, admin.token)).status, 200);
  } finally {
    await c.stop();
  }
});

// ---- the admin page + its row builders ----

test("/admin serves, and the nav entrance is hidden markup until an admin loads it", async () => {
  const r = await fetch(ctx.url + "/admin");
  const body = await r.text();
  assert.equal(r.status, 200);
  assert.ok(body.includes('id="adminGames"') && body.includes('id="adminUsers"'), "both moderation lists");
  assert.ok(body.includes("/js/pages/admin.js"), "the page loads its script (emitted from client/pages/admin.ts)");
  const script = await fetch(ctx.url + "/js/pages/admin.js").then((r) => r.text());
  assert.ok(script.includes("/js/admin-view.js"), "rows come from the shared builder");
});

// ---- Help: users ask the admin ----

test("a question reaches every admin's inbox, tagged and attributed to the asker", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const asker = await signup(c, "robinbuckley", "robin@buckley.com");

    const sent = await c.api("/api/help", { text: "  How do rounds work?  " }, asker.token);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.data.sentTo, ["ninaadmin"]);

    const box = await c.api("/api/inbox", undefined, admin.token);
    const q = box.data.messages.find((m) => m.type === "help");
    assert.ok(q, "it lands as a help message");
    assert.equal(q.text, "How do rounds work?", "trimmed");
    assert.equal(q.from.username, "robinbuckley", "the admin knows who asked");
    assert.equal(q.read, false, "and it arrives unread");
  } finally {
    await c.stop();
  }
});

test("help questions are sanitized, non-empty, signed-in, and rate-limited", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const asker = await signup(c, "robinbuckley", "robin@buckley.com");

    assert.equal((await c.api("/api/help", { text: "hi" })).status, 401, "no anonymous questions");
    assert.equal((await c.api("/api/help", { text: "   " }, asker.token)).status, 400);
    assert.equal((await c.api("/api/help", { text: "x" }, asker.token)).status, 400, "one character isn't a question");

    const tagged = await c.api("/api/help", { text: "<script>alert(1)</script> is this ok?" }, asker.token);
    assert.equal(tagged.status, 200);
    const box = await c.api("/api/inbox", undefined, admin.token);
    const q = box.data.messages.find((m) => m.type === "help");
    assert.ok(!q.text.includes("<script>"), "html is stripped before it's stored");

    const tooSoon = await c.api("/api/help", { text: "and another thing" }, asker.token);
    assert.equal(tooSoon.status, 429, "a second question straight away is held off");

    const long = await c.api("/api/help", { text: "y".repeat(2000) }, asker.token);
    assert.equal(long.status, 429, "still cooling down");
  } finally {
    await c.stop();
  }
});

test("the admin is not offered the help box, the route says so", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const r = await c.api("/api/help", { text: "asking myself" }, admin.token);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /You are the admin/);
  } finally {
    await c.stop();
  }
});

test("the admin replies, and the answer comes back to the asker's inbox", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const asker = await signup(c, "robinbuckley", "robin@buckley.com");
    await c.api("/api/help", { text: "my game is stuck" }, asker.token);

    const box = await c.api("/api/inbox", undefined, admin.token);
    const q = box.data.messages.find((m) => m.type === "help");

    const stranger = await signup(c, "eddiemunson", "eddie@munson.com");
    assert.equal(
      (await c.api("/api/inbox/reply", { id: q.id, text: "not mine" }, stranger.token)).status,
      404,
      "you can only reply to messages in your own inbox",
    );
    assert.equal((await c.api("/api/inbox/reply", { id: q.id, text: "  " }, admin.token)).status, 400);

    const sent = await c.api("/api/inbox/reply", { id: q.id, text: "Resume it from the dashboard." }, admin.token);
    assert.equal(sent.status, 200);

    const theirs = await c.api("/api/inbox", undefined, asker.token);
    const reply = theirs.data.messages.find((m) => m.from?.username === "ninaadmin");
    assert.ok(reply, "the answer is in the asker's inbox");
    assert.equal(reply.type, "note");
    assert.equal(reply.text, "Resume it from the dashboard.");

    const after = await c.api("/api/inbox", undefined, admin.token);
    assert.equal(after.data.messages.find((m) => m.id === q.id).read, true, "answering marks it handled");
  } finally {
    await c.stop();
  }
});

test("the dashboard carries the help box, and it starts hidden for everyone", async () => {
  const r = await fetch(ctx.url + "/dashboard");
  const body = await r.text();
  assert.ok(body.includes('id="helpCard"'), "the help section exists");
  assert.match(body, /id="helpCard"[^>]*class="[^"]*hidden|class="card hidden" id="helpCard"/, "hidden until a non-admin loads it");
  assert.ok(body.includes('id="helpText"') && body.includes('id="helpSend"'), "a box and a send button");
  const script = await fetch(ctx.url + "/js/pages/dashboard.js").then((r) => r.text()); // the page's script, emitted from client/pages/dashboard.ts
  assert.ok(script.includes("/api/help"), "wired to the help route");
  assert.ok(script.includes("me?.admin"), "the admin never sees it");
});

test("the inbox reply composer is inline markup on the page, not a browser prompt", async () => {
  // The rows and their actions live in one module, mounted by /inbox. The
  // dashboard shows no messages at all — only that some are waiting.
  const body = await fetch(ctx.url + "/js/inbox-page.js").then((r) => r.text());
  assert.ok(!body.includes("window.prompt"), "no modal prompt anywhere in the inbox");
  assert.ok(body.includes("ib-reply-send"), "the composer is wired")
  assert.ok(body.includes("inboxPaneComposerHtml"), "the composer sits at the foot of the open conversation");
  assert.ok(!body.includes("ib-reply-cancel"), "Escape clears it, so no Cancel");
  assert.ok(body.includes("/api/inbox/reply"), "wired to the reply route");
  assert.ok(body.includes('e.key === "Escape"'), "Escape clears it");
  assert.ok(body.includes("metaKey || e.ctrlKey"), "and Ctrl/Cmd+Enter sends");
  assert.ok((await fetch(ctx.url + "/js/pages/inbox.js").then((r) => r.text())).includes("inbox-page.js"), "/inbox uses it (its script is /js/pages/inbox.js)");
  const dash = await fetch(ctx.url + "/dashboard").then((r) => r.text());
  assert.ok(!dash.includes("inbox-panel.js"), "the dashboard does not render messages at all");
});

// ---- The prompt library editor ----
test("admins read and rewrite the prompt library; the next ballot deals from it; a normal account can't", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c, "promptadmin");
    const normie = await signup(c, "promptnormie", "pn@x.com");
    const denied = await c.api("/api/admin/prompts", undefined, normie.token);
    assert.equal(denied.status, 403);
    const put = await c.api("/api/admin/prompts", { data: { prompts: ["x"] } }, normie.token, "PUT");
    assert.equal(put.status, 403, "a normal account can't rewrite it either");

    const got = await c.api("/api/admin/prompts", undefined, admin.token);
    assert.equal(got.status, 200);
    const doc = got.data.data;
    assert.ok(doc.prompts.length > 10 && doc.intermediate.seasons.length >= 7 && doc.intermediate.explicit.kinks.length);

    // a broken library is refused as a whole, with the reasons
    const broken = JSON.parse(JSON.stringify(doc));
    broken.intermediate.tropes.push({ id: "x", label: "x", text: "x", group: "nowhere" });
    const bad = await c.api("/api/admin/prompts", { data: broken }, admin.token, "PUT");
    assert.equal(bad.status, 400);
    assert.ok(bad.data.errors.some((e) => /group nowhere/.test(e)));
    const noPrompts = await c.api("/api/admin/prompts", { data: { ...doc, prompts: [] } }, admin.token, "PUT");
    assert.equal(noPrompts.status, 400);

    // a good one is saved and dealt from at once — Simple AND Advanced
    const next = JSON.parse(JSON.stringify(doc));
    next.prompts = ["Only this scenario now."];
    next.intermediate.tones = [{ id: "test-tone", label: "Test tone", text: "the test tone", weight: 1 }];
    const ok = await c.api("/api/admin/prompts", { data: next }, admin.token, "PUT");
    assert.equal(ok.status, 200);
    const again = await c.api("/api/admin/prompts", undefined, admin.token);
    assert.equal(again.data.data.prompts[0], "Only this scenario now.");
    const menus = await c.api("/api/prompt-options");
    assert.deepEqual(menus.data.intermediate.tones, [{ id: "test-tone", label: "Test tone" }], "the menus follow the edit");

    const mate = await signup(c, "promptmate", "pm@x.com");
    const A = await c.conn(); const B = await c.conn();
    const state = { current: null };
    A.on("game-state", (st) => (state.current = st));
    const s = await c.emit(A, "create-session", { auth: admin.token });
    await c.emit(B, "join-session", { code: s.code, auth: mate.token });
    await c.emit(A, "start-game", { turnSeconds: 60, rounds: 1 });
    await c.wait(150);
    assert.deepEqual(state.current.options, ["Only this scenario now."]);
    await c.emit(A, "set-prompt-mode", { mode: "intermediate" });
    await c.wait(150);
    for (const p of state.current.options) assert.ok(p.includes("Tone: the test tone"), p);
  } finally {
    await c.stop();
  }
});

test("the writers' reference is editable by category from /admin, and only by an admin", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const normie = await signup(c, "dustinhend", "dustin@hend.com");
    assert.equal((await c.api("/api/admin/reference", undefined, normie.token)).status, 403);
    assert.equal((await c.api("/api/admin/reference/dialogue-tags", { categories: [{ key: "basic", words: ["said"] }] }, normie.token, "PUT")).status, 403);

    const got = await c.api("/api/admin/reference", undefined, admin.token);
    assert.equal(got.status, 200);
    const dlg = got.data.groups.find((g) => g.slug === "dialogue-tags");
    assert.ok(dlg && dlg.categories.length > 3, "the whole bank, by group and category");
    // the delivery group is the one wrapped in a root key — it must round-trip too
    const delivery = got.data.groups.find((g) => g.slug === "delivery-modifiers");
    assert.ok(delivery && delivery.categories.length);

    // replace: keep two categories, add one, drop the rest (an emptied one goes)
    const keep = dlg.categories.slice(0, 2).map(({ key, words }) => ({ key, words }));
    const put = await c.api(
      "/api/admin/reference/dialogue-tags",
      { categories: [...keep, { key: "nervous_habits", words: ["stammered", " stammered ", "fidgeted"] }, { key: "gone", words: [] }] },
      admin.token, "PUT",
    );
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.deepEqual(put.data.group.categories.map((x) => x.key), [...keep.map((k) => k.key), "nervous_habits"]);
    assert.deepEqual(put.data.group.categories.at(-1).words, ["stammered", "fidgeted"], "trimmed and deduped");
    assert.equal(put.data.group.categories.at(-1).label, "Nervous habits");

    // the palette sees it with no restart
    const ref = await c.api("/api/reference", undefined, normie.token);
    assert.equal(ref.data.groups.find((g) => g.slug === "dialogue-tags").categories.length, 3);

    // the root-wrapped group keeps its wrapper on disk
    const dput = await c.api("/api/admin/reference/delivery-modifiers", { categories: [{ key: "warm", words: ["softly"] }] }, admin.token, "PUT");
    assert.equal(dput.status, 200);
    assert.deepEqual((await c.api("/api/reference", undefined, normie.token)).data.groups.find((g) => g.slug === "delivery-modifiers").categories, [{ key: "warm", label: "Warm", words: ["softly"] }]);

    // validation: bad keys, empty groups, unknown groups
    assert.equal((await c.api("/api/admin/reference/dialogue-tags", { categories: [{ key: "Bad Key", words: ["x"] }] }, admin.token, "PUT")).status, 400);
    assert.equal((await c.api("/api/admin/reference/dialogue-tags", { categories: [] }, admin.token, "PUT")).status, 400);
    assert.equal((await c.api("/api/admin/reference/nope", { categories: [{ key: "a", words: ["x"] }] }, admin.token, "PUT")).status, 400);
    assert.equal((await c.api("/api/admin/reference/!repitition_parser", { categories: [{ key: "a", words: ["x"] }] }, admin.token, "PUT")).status, 400);
  } finally {
    await c.stop();
  }
});

test("GET /api/admin/storage says where the data lives, files under test, and a normal account can't see it", async () => {
  const admin = await makeAdmin(ctx, "storageadmin");
  const normie = await signup(ctx, "storagenormie", "sn@example.com");
  const denied = await ctx.api("/api/admin/storage", undefined, normie.token);
  assert.equal(denied.status, 403);
  const r = await ctx.api("/api/admin/storage", undefined, admin.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "files", "the suite never runs against Postgres");
  assert.equal(r.data.lastError, null);
  assert.ok(r.data.counts.users >= 1 && r.data.counts.content >= 1 && r.data.counts.reference >= 1);
  assert.match(r.data.summary, /^storage: files/);
});

test("the badge editor: an admin saves the catalogue and a new badge is earned on the very next story line; a normal account can't read or write it", async () => {
  const { startedGame } = await import("./helpers.mjs");
  const c = await startServer();
  try {
    const admin = await makeAdmin(c, "badgeadmin");
    const normie = await signup(c, "badgenormie", "bn@example.com");
    assert.equal((await c.api("/api/admin/achievements", undefined, normie.token)).status, 403);
    assert.equal((await c.api("/api/admin/achievements", { data: {} }, normie.token, "PUT")).status, 403);
    const doc = (await c.api("/api/admin/achievements", undefined, admin.token)).data;
    assert.ok(Array.isArray(doc.wordTiers) && Array.isArray(doc.usage));
    // a broken catalogue is refused with the reasons
    const broken = structuredClone(doc);
    broken.usage.push({ id: "Not A Slug", name: "🚫 Nope" });
    const bad = await c.api("/api/admin/achievements", { data: broken }, admin.token, "PUT");
    assert.equal(bad.status, 400);
    assert.ok(bad.data.errors.some((e) => /valid id/.test(e)));
    // a new secret badge
    const next = structuredClone(doc);
    next.usage.push({ id: "mindflayer", name: "🕷️ Mind Flayer", triggers: ["mind flayer"], sound: "mindflayer-roar", desc: "Write the mind flayer into a line." });
    const ok = await c.api("/api/admin/achievements", { data: next }, admin.token, "PUT");
    assert.equal(ok.status, 200);
    assert.ok(ok.data.data.usage.some((b) => b.id === "mindflayer"));
    // the public catalogue lists it by name only; an admin sees the recipe
    const pub = await c.api("/api/achievements", undefined, normie.token);
    const mine = pub.data.usage.find((b) => b.name === "🕷️ Mind Flayer");
    assert.ok(mine && !("triggers" in mine) && !("desc" in mine) && !("sound" in mine), "secret stays secret");
    assert.equal(pub.data.admin, false);
    const adm = await c.api("/api/achievements", undefined, admin.token);
    const seen = adm.data.usage.find((b) => b.name === "🕷️ Mind Flayer");
    assert.deepEqual(seen.triggers, ["mind flayer"]);
    assert.equal(seen.desc, "Write the mind flayer into a line.");
    assert.equal(seen.sound, "mindflayer-roar");
    assert.equal(adm.data.admin, true);
    // …and it is earned, live, on the next committed line — no restart
    const { A, B } = await startedGame(c);
    const toasts = [];
    A.on("badge-earned", (b) => toasts.push(b));
    B.on("badge-earned", (b) => toasts.push(b));
    await c.emit(A, "submit-line", { text: "The mind flayer was waiting in the field." });
    await c.wait(200);
    assert.ok(toasts.some((t) => t.badge === "🕷️ Mind Flayer"), "the new badge fired: " + JSON.stringify(toasts.map((t) => t.badge)));
    const fired = toasts.filter((t) => t.badge === "🕷️ Mind Flayer");
    assert.equal(fired.length, 2, "both seats got the toast");
    assert.ok(fired.every((t) => t.sound === "mindflayer-roar"), "the clip rides to the whole table, secret or not");
    assert.ok(fired.some((t) => t.desc === null), "the room's copy still hides the recipe");
  } finally {
    await c.stop();
  }
});

test("an admin downloads the live content pack as a zip; a normal account can't", async () => {
  const c = await startServer();
  try {
    const admin = await makeAdmin(c);
    const normie = await signup(c, "dustinh", "dustin@henderson.com");
    const get = (token) => fetch(c.url + "/api/admin/content.zip", { headers: { Authorization: "Bearer " + token } });
    assert.equal((await get(normie.token)).status, 403);
    assert.equal((await fetch(c.url + "/api/admin/content.zip")).status, 401);
    // Edit a pack file first: the download must reflect the STORE, not the repo.
    const badges = (await c.api("/api/admin/achievements", undefined, admin.token)).data;
    badges.wordTiers[0].name = "Backup Proof Rank";
    assert.equal((await c.api("/api/admin/achievements", { data: badges }, admin.token, "PUT")).status, 200);
    const r = await get(admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    assert.match(r.headers.get("content-disposition"), /attachment; filename="cowrite-content-\d{4}-\d{2}-\d{2}\.zip"/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.readUInt32LE(0), 0x04034b50, "a zip");
    const text = buf.toString("latin1");
    for (const name of ["content/achievements.json", "content/prompts.json", "content/site.json", "content/quotes.json", "content/titles.json", "writers-reference/index.json", "writers-reference/dialogue-tags.json"]) {
      assert.ok(text.includes(name), `carries ${name}`);
    }
    const { inflateRawSync } = await import("node:zlib");
    // Locate the achievements entry and inflate it to prove it's the live edit.
    const i = text.indexOf("content/achievements.json");
    const headerAt = text.lastIndexOf("PK\x03\x04", i);
    const method = buf.readUInt16LE(headerAt + 8), csize = buf.readUInt32LE(headerAt + 18), nlen = buf.readUInt16LE(headerAt + 26);
    const start = headerAt + 30 + nlen;
    const body = method === 8 ? inflateRawSync(buf.subarray(start, start + csize)) : buf.subarray(start, start + csize);
    assert.ok(body.toString("utf-8").includes("Backup Proof Rank"), "the zip holds the store's copy, not the repo's");
  } finally {
    await c.stop();
  }
});

test("GET /api/admin/smtp reports the email setup to an admin only, never a secret's value", async () => {
  // the shared admin already exists on ctx (the storage test made it): sign in
  const admin = (await ctx.api("/api/login", { user: "storageadmin", password: "1234" })).data;
  const normie = await signup(ctx, "smtpnormie", "smtp@example.com");
  const denied = await ctx.api("/api/admin/smtp", undefined, normie.token);
  assert.equal(denied.status, 403);
  const r = await ctx.api("/api/admin/smtp", undefined, admin.token);
  assert.equal(r.status, 200);
  // the test server has no SMTP_HOST: it says so, and says which vars are set as booleans
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /SMTP_HOST is not set/);
  assert.equal(typeof r.data.configured.host, "boolean");
  assert.equal(typeof r.data.configured.pass, "boolean");
  const page = await fetch(ctx.url + "/admin").then((x) => x.text());
  assert.ok(page.includes('id="adminSmtp"'), "the check has a button on /admin");
});

test("an admin can delete anyone's solo write (the author is told); a normal account can't", async () => {
  const c = await startServer();
  try {
  const admin = await makeAdmin(c);
  const author = await signup(c, "docauthor", "docauthor@byers.com");
  const other = await signup(c, "docstranger", "docstranger@byers.com");
  const doc = (await c.api("/api/docs", { title: "Keep out" }, author.token)).data.doc;

  // the admin sees Delete offered on the author's profile rows, a stranger doesn't
  const asAdmin = await c.api("/api/users/docauthor", null, admin.token, "GET");
  assert.equal(asAdmin.data.writes.find((d) => d.id === doc.id).deletable, true);
  const asOther = await c.api("/api/users/docauthor", null, other.token, "GET");
  assert.equal(asOther.data.writes.find((d) => d.id === doc.id).deletable, false);

  // a normal account is refused; the admin is not
  assert.equal((await c.api("/api/docs/" + doc.id, null, other.token, "DELETE")).status, 403);
  assert.equal((await c.api("/api/docs/" + doc.id, null, admin.token, "DELETE")).status, 200);
  assert.equal((await c.api("/api/docs/" + doc.id, null, author.token, "GET")).status, 404);

  // the author hears who did it
  const inbox = await c.api("/api/inbox", null, author.token, "GET");
  const note = inbox.data.messages.find((m) => m.type === "system" && /Keep out/.test(m.text));
  assert.ok(note, "an inbox note names the deleted story");
  assert.match(note.text, /deleted by ninaadmin/);
  } finally { await c.stop(); }
});
