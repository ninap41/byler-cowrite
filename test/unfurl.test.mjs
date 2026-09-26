// Chat link previews (src/unfurl.js): the one place the server fetches a URL
// a user typed. Every request is faked — nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnfurler, parsePreview, isPrivateAddress, hostLooksPrivate, UNFURL_MAX_BYTES } from "../src/unfurl.js";
import { firstUrl } from "../src/game.js";
import { findUrls, URL_RE } from "../public/js/util.js";

const page = (head) => `<!doctype html><html><head>${head}</head><body>hi</body></html>`;
const html = (body, extra = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...extra } });
const publicLookup = async () => ({ address: "93.184.216.34" });
const make = (routes, lookup = publicLookup) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404 });
    return typeof r === "function" ? r() : r;
  };
  return { ...createUnfurler({ fetchImpl, lookup, mode: "1" }), calls };
};

test("parsePreview: og tags win, relative og:image resolves, entities decode, <title> is the fallback", () => {
  const p = parsePreview(page(`<meta property="og:title" content="Will &amp; Mike"><meta content="/img/a.png" property="og:image"><meta name="description" content="a story"><meta property="og:site_name" content="AO3"><title>ignored</title>`), "https://ex.com/works/1");
  assert.deepEqual(p, { url: "https://ex.com/works/1", title: "Will & Mike", description: "a story", image: "https://ex.com/img/a.png", site: "AO3" });
  assert.deepEqual(parsePreview(page(`<title>  Just a\n title </title>`), "https://ex.com/"), { url: "https://ex.com/", title: "Just a title" });
  assert.equal(parsePreview(page(`<meta name="x" content="y">`), "https://ex.com/"), null, "no title and no image → nothing");
  assert.equal(parsePreview(page(`<meta property="og:image" content="javascript:alert(1)">`), "https://ex.com/"), null, "a non-http image is dropped");
  assert.equal(parsePreview(page(`<meta property="og:title" content="x"><meta property="og:image" content="http://127.0.0.1/a.png">`), "https://ex.com/").image, undefined, "a private-host image is dropped");
  assert.ok(parsePreview(page(`<meta property="og:title" content="${"t".repeat(500)}">`), "https://ex.com/").title.length <= 120, "title clipped");
});

test("private hosts by name and by address", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["93.184.216.34", "172.32.0.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  for (const h of ["localhost", "LOCALHOST", "db.internal", "printer.local", "127.0.0.1", "[::1]"]) assert.ok(hostLooksPrivate(h), h);
  assert.ok(!hostLooksPrivate("archiveofourown.org"));
});

test("unfurl: fetches once per URL (cached, negatives too), sends redirect:manual with a timeout", async () => {
  const u = make({ "https://ex.com/a": () => html(page(`<meta property="og:title" content="A">`)) });
  const first = await u.unfurl("https://ex.com/a");
  assert.equal(first.title, "A");
  assert.deepEqual(await u.unfurl("https://ex.com/a"), first);
  assert.equal(await u.unfurl("https://ex.com/missing"), null);
  assert.equal(await u.unfurl("https://ex.com/missing"), null);
  assert.deepEqual(u.calls, ["https://ex.com/a", "https://ex.com/missing"], "one fetch each");
});

test("unfurl: refuses private hosts, by literal, by name, by DNS answer and after a redirect", async () => {
  const good = () => html(page(`<meta property="og:title" content="A">`));
  const u = make({ "http://localhost:3000/x": good, "http://127.0.0.1/x": good, "http://10.0.0.1/x": good, "https://ex.com/x": good, "https://ex.com/r": () => new Response("", { status: 302, headers: { location: "http://192.168.1.1/admin" } }), "http://192.168.1.1/admin": good });
  for (const url of ["http://localhost:3000/x", "http://127.0.0.1/x", "http://10.0.0.1/x", "https://ex.com/r", "ftp://ex.com/x", "javascript:alert(1)"]) assert.equal(await u.unfurl(url), null, url);
  assert.equal(u.calls.includes("http://192.168.1.1/admin"), false, "the redirect target was never fetched");
  const rebinder = make({ "https://ex.com/x": good }, async () => ({ address: "192.168.1.1" }));
  assert.equal(await rebinder.unfurl("https://ex.com/x"), null, "a public name resolving inside the network is refused");
  assert.deepEqual(rebinder.calls, []);
  const failing = make({ "https://ex.com/x": good }, async () => { throw new Error("ENOTFOUND"); });
  assert.equal(await failing.unfurl("https://ex.com/x"), null);
});

test("unfurl: follows a public redirect, needs an html content type, and reads at most the cap", async () => {
  const big = page(`<meta property="og:title" content="Big">`) + "x".repeat(UNFURL_MAX_BYTES * 2);
  const u = make({
    "https://ex.com/r": () => new Response("", { status: 301, headers: { location: "/final" } }),
    "https://ex.com/final": () => html(page(`<meta property="og:title" content="Final">`)),
    "https://ex.com/pdf": () => html("%PDF", { "content-type": "application/pdf" }),
    "https://ex.com/big": () => html(big),
    "https://ex.com/loop": () => new Response("", { status: 302, headers: { location: "/loop" } }),
  });
  assert.equal((await u.unfurl("https://ex.com/r")).title, "Final");
  assert.equal(await u.unfurl("https://ex.com/pdf"), null, "not html");
  assert.equal((await u.unfurl("https://ex.com/big")).title, "Big", "a huge page still yields its head");
  assert.equal(await u.unfurl("https://ex.com/loop"), null, "a redirect loop gives up");
});

test("modes: off answers nothing, stub answers a canned card without fetching", async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return html(page("<title>x</title>")); };
  assert.equal(await createUnfurler({ fetchImpl, lookup: publicLookup, mode: "0" }).unfurl("https://ex.com/"), null);
  const stub = await createUnfurler({ fetchImpl, lookup: publicLookup, mode: "stub" }).unfurl("https://ex.com/p");
  assert.equal(stub.url, "https://ex.com/p");
  assert.ok(stub.title && stub.image.startsWith("https://"));
  assert.equal(fetched, 0);
});

test("the server picks the SAME first link the client underlines", () => {
  const text = "look (https://a.com/x?q=1). then http://b.org/y, and javascript:alert(1) www.c.com";
  assert.equal(firstUrl(text), "https://a.com/x?q=1");
  assert.deepEqual(findUrls(text).map((u) => u.url), ["https://a.com/x?q=1", "http://b.org/y"]);
  assert.equal(firstUrl("no links here"), null);
  assert.equal(String(URL_RE), String(/\bhttps?:\/\/[^\s<>"'`]+/gi), "one regex, two copies (client/util.ts, src/game.js)");
});
