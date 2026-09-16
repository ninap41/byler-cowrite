// The rail's side-flyout submenus (components/nav-flyout.js): the builders,
// and the wiring on jsdom — open/close, one at a time, keyboard, outside
// click, the phone fold versus the desktop flyout, the admin reveal, and
// the GSAP close clearing only what it set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom, mount } from "./dom.mjs";

installDom();
// a stubbed viewport: `phone` flips the breakpoint, everything else is false
let phone = false;
let hover = true;
window.matchMedia = (q) => ({ matches: q.includes("max-width") ? phone : q.includes("hover") ? hover : false, addEventListener() {}, removeEventListener() {} });
const { flyoutItemHtml, flyoutGroupHtml, navFlyoutHtml, mountNavFlyout, groupIds, isGroup } = await import("../public/js/components/nav-flyout.js");

// the dashboard's rail, as data — the page writes the same markup by hand
const DASH_RAIL = [
  { label: "Inbox", emoji: "📬", href: "/inbox", badgeId: "navInbox" },
  { id: "cowrite", label: "Cowrite", emoji: "👥", items: [
    { id: "createBtn", label: "New game", emoji: "✨", href: "/game?new=1" },
    { id: "joinOpen", label: "Join game", emoji: "🔑", action: "join" },
    { label: "Your previous games", emoji: "📚", href: "/archive" },
    { label: "All previous games", emoji: "📖", href: "/stories?kind=game" },
  ] },
  { id: "solo", label: "Solo writes", emoji: "✒️", items: [
    { label: "Your solo writes", emoji: "📚", href: "/writes" },
    { id: "soloBtn", label: "New solo write", emoji: "✒️", action: "newSolo" },
  ] },
  { id: "account", label: "Account", emoji: "👤", items: [
    { label: "Profile", emoji: "🏆", href: "/profile" },
    { label: "Settings", emoji: "⚙️", href: "/settings" },
  ] },
  { label: "AO3 skin previewer", emoji: "🎨", href: "https://ao3-skin-previewer.replit.app", external: true, glow: true, tag: "new" },
  { id: "railAdmin", label: "Admin", emoji: "🛡️", href: "/admin", admin: true },
  { label: "Other games", emoji: "🕹️", href: "/games", tag: "soon" },
  { id: "inviteBtn", label: "Invite a friend", emoji: "➕" },
];
const tight = (s) => s.replace(/>\s+</g, "><").trim();

test("builders: a parent row is a menu button over a role=menu panel; items are links or action buttons; admin/external/tag/badge all render", () => {
  assert.deepEqual(groupIds("cowrite"), { button: "railCowrite", menu: "railCowriteMenu" });
  assert.ok(isGroup(DASH_RAIL[1]) && !isGroup(DASH_RAIL[0]));
  const g = flyoutGroupHtml(DASH_RAIL[1]);
  assert.match(g, /<div class="dnav-wrap" data-flyout="cowrite"><button type="button" class="dnav dnav-parent" id="railCowrite" aria-haspopup="menu" aria-expanded="false" aria-controls="railCowriteMenu">/);
  assert.match(g, /<span class="dnav-ico" aria-hidden="true">👥<\/span><span class="dnav-label">Cowrite<\/span><span class="dnav-chev" aria-hidden="true">&#9656;<\/span>/);
  assert.match(g, /<div class="dnav-sub hidden" id="railCowriteMenu" role="menu" aria-label="Cowrite">/);
  assert.match(g, /<a class="dnav" id="createBtn" role="menuitem" href="\/game\?new=1">/);
  assert.match(g, /<button type="button" class="dnav" id="joinOpen" role="menuitem" data-action="join">/);
  assert.match(flyoutItemHtml(DASH_RAIL[4]), /<a class="dnav dnav-glow" href="https:\/\/ao3-skin-previewer.replit.app" target="_blank" rel="noopener">.*<span class="dnav-new">New<\/span>/);
  assert.match(flyoutItemHtml(DASH_RAIL[5]), /<a class="dnav hidden" id="railAdmin" href="\/admin" data-admin>/);
  assert.match(flyoutItemHtml(DASH_RAIL[6]), /<span class="dnav-tag">soon<\/span>/);
  assert.match(flyoutItemHtml(DASH_RAIL[0]), /<span class="dnav-badge hidden" id="navInbox"><\/span>/);
  assert.match(flyoutItemHtml(DASH_RAIL[7]), /<button type="button" class="dnav" id="inviteBtn"><span class="dnav-ico" aria-hidden="true">➕<\/span><span class="dnav-label" id="inviteLabel">Invite a friend<\/span>/);
  assert.match(flyoutItemHtml({ label: "<b>x</b>", emoji: "🔑", action: '"' }), /&lt;b&gt;x&lt;\/b&gt;/, "labels are escaped");
});

test("the dashboard's hand-written rail is exactly what navFlyoutHtml emits", () => {
  const html = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf-8");
  const nav = html.slice(html.indexOf('id="railNav"'), html.indexOf("</nav>", html.indexOf('id="railNav"')));
  const rows = nav.slice(nav.indexOf(">") + 1, nav.indexOf('<div class="err"'));
  assert.equal(tight(rows), tight(navFlyoutHtml(DASH_RAIL)));
});

function setup(opts = {}) {
  document.body.innerHTML = "";
  const root = mount(`<nav id="railNav">${navFlyoutHtml(DASH_RAIL)}</nav>`).firstElementChild;
  const fly = mountNavFlyout(root, opts);
  const btn = (id) => root.querySelector("#" + id);
  const panel = (id) => root.querySelector("#" + id + "Menu");
  return { root, fly, btn, panel };
}

test("click opens a parent, opens one at a time, closes on its own row, outside click and Escape (which refocuses the row)", () => {
  const { root, fly, btn, panel } = setup();
  assert.equal(fly.openId, null);
  btn("railCowrite").click();
  assert.equal(fly.openId, "cowrite");
  assert.ok(!panel("railCowrite").classList.contains("hidden"));
  assert.equal(btn("railCowrite").getAttribute("aria-expanded"), "true");
  assert.ok(btn("railCowrite").classList.contains("on"));
  btn("railSolo").click();
  assert.equal(fly.openId, "solo", "the second parent takes over");
  assert.ok(panel("railCowrite").classList.contains("hidden"), "and the first closed");
  btn("railSolo").click();
  assert.equal(fly.openId, null, "its own row toggles it shut");
  btn("railAccount").click();
  document.body.click();
  assert.equal(fly.openId, null, "an outside click closes");
  btn("railAccount").click();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(fly.openId, null, "Escape closes");
  assert.equal(document.activeElement, btn("railAccount"), "and hands focus back to the row");
  root.querySelector("#createBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  fly.destroy();
});

test("keyboard: ArrowRight/Enter open and focus the first item, ArrowUp the last; Down/Up cycle; ArrowLeft closes and refocuses", () => {
  const { root, fly, btn, panel } = setup();
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  key(btn("railCowrite"), "ArrowRight");
  assert.equal(fly.openId, "cowrite");
  assert.equal(document.activeElement, root.querySelector("#createBtn"), "first item focused");
  key(panel("railCowrite"), "ArrowDown");
  assert.equal(document.activeElement, root.querySelector("#joinOpen"));
  key(panel("railCowrite"), "ArrowUp");
  assert.equal(document.activeElement, root.querySelector("#createBtn"));
  key(panel("railCowrite"), "ArrowUp");
  assert.equal(document.activeElement.getAttribute("href"), "/stories?kind=game", "wraps to the last");
  key(panel("railCowrite"), "ArrowLeft");
  assert.equal(fly.openId, null);
  assert.equal(document.activeElement, btn("railCowrite"));
  key(btn("railSolo"), "ArrowUp");
  assert.equal(document.activeElement, root.querySelector("#soloBtn"), "ArrowUp opens on the last item");
  key(btn("railSolo"), "Enter");
  assert.equal(fly.openId, "solo");
  fly.destroy();
});

test("an action item reports its data-action and closes the menu; a link item just closes", () => {
  const calls = [];
  const { root, fly, btn } = setup({ onAction: (a, el) => calls.push([a, el.id]) });
  btn("railCowrite").click();
  root.querySelector("#joinOpen").click();
  assert.deepEqual(calls, [["join", "joinOpen"]]);
  assert.equal(fly.openId, null);
  btn("railSolo").click();
  root.querySelector("#soloBtn").click();
  assert.deepEqual(calls.at(-1), ["newSolo", "soloBtn"]);
  fly.destroy();
});

test("desktop flies out beside the row (fixed, placed from its rect); a phone folds the panel open in-flow under it", () => {
  phone = false;
  let { fly, btn, panel } = setup();
  btn("railCowrite").click();
  assert.equal(panel("railCowrite").style.position, "fixed");
  assert.match(panel("railCowrite").style.left, /px$/);
  assert.ok(!panel("railCowrite").classList.contains("is-fold"));
  fly.close();
  assert.equal(panel("railCowrite").style.position, "", "close clears the placement");
  fly.destroy();
  phone = true;
  ({ fly, btn, panel } = setup());
  assert.ok(fly.isPhone());
  btn("railCowrite").click();
  assert.ok(panel("railCowrite").classList.contains("is-fold"));
  assert.ok(panel("railCowrite").parentElement.classList.contains("is-fold"), "the wrap says so too (the chevron turns)");
  assert.equal(panel("railCowrite").style.position, "", "no fixed placement on a phone");
  fly.destroy();
  phone = false;
});

test("admin rows hide until told: `admin: true` at mount or setAdmin(true) reveals [data-admin]", () => {
  let { root, fly } = setup();
  assert.ok(root.querySelector("#railAdmin").classList.contains("hidden"));
  fly.setAdmin(true);
  assert.ok(!root.querySelector("#railAdmin").classList.contains("hidden"));
  fly.setAdmin(false);
  assert.ok(root.querySelector("#railAdmin").classList.contains("hidden"));
  fly.destroy();
  ({ root, fly } = setup({ admin: true }));
  assert.ok(!root.querySelector("#railAdmin").classList.contains("hidden"));
  fly.destroy();
});

test("with GSAP loaded the close tween clears only what it set — never clearProps: all, which would wipe the inline transition:none", () => {
  const calls = [];
  window.gsap = {
    killTweensOf() {},
    set: (t, v) => calls.push(["set", v]),
    to: (t, v) => { calls.push(["to", v]); v.onComplete?.(); return {}; },
    fromTo: (t, a, v) => { calls.push(["fromTo", v]); return {}; },
  };
  const { fly, btn, panel } = setup();
  assert.equal(panel("railCowrite").style.transition, "none", "the CSS keyframe is the fallback only");
  btn("railCowrite").click();
  assert.ok(!panel("railCowrite").classList.contains("open"), "GSAP owns the entrance");
  fly.close();
  const clear = calls.filter(([k, v]) => k === "set" && v.clearProps).map(([, v]) => v.clearProps);
  assert.deepEqual(clear, ["transform,opacity,visibility,height"]);
  assert.ok(panel("railCowrite").classList.contains("hidden"));
  assert.equal(panel("railCowrite").style.transition, "none", "still in place for the next open");
  fly.destroy();
  delete window.gsap;
});
