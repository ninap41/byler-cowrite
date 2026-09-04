// jsdom bootstrap for client-component tests (test-only — the app has no build
// step and never imports jsdom). Installs window/document globals BEFORE the
// component modules are imported.
import { JSDOM } from "jsdom";

export function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.localStorage = dom.window.localStorage;
  return dom;
}

export const mount = (html) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
};
