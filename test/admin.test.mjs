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
  assert.ok(body.includes("/js/admin-view.js"), "rows come from the shared builder");
});
