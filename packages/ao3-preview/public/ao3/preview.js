// The AO3 previewer's wiring: the CSS drawer (the app's side-drawer component,
// with Minimise / Expand on top of it), the live skin, and the lint list. No
// login, no chrome — everything it touches is on /ao3-preview itself.
//
// `mountPreview(doc, opts)` takes the document plus injectable storage and
// loaders so a jsdom test can drive it without a server.

// the app's side drawer, copied in (side-drawer.js) so the package has no import outside itself
import { mountSideDrawer } from "./side-drawer.js";
import { lintCss, splitSelectors, storedSelector, cleanKind } from "./ao3-rules.js";
import { createEditor } from "./editor.js";
import { mountInspector } from "./inspect.js";

export const KEY_CSS = "cowriteAo3Css";
export const KEY_DRAWER = "cowriteAo3Drawer";
export const KEY_EXPANDED = "cowriteAo3Expanded";
export const KEY_THEME = "cowriteAo3Theme";
export const KEY_KIND = "cowriteAo3Kind";
// the shipped default is a site skin, so that is the first-visit kind
export const DEFAULT_KIND = "site";
export const DOWNLOAD_NAMES = { work: "work-skin.css", site: "site-skin.css" };
export const DOWNLOAD_NAME = DOWNLOAD_NAMES.work;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function lintRowHtml(p) {
  const what = p.prop
    ? `<code>${esc(p.prop)}</code>${p.value ? `: <code>${esc(p.value.length > 60 ? p.value.slice(0, 57) + "…" : p.value)}</code>` : ""}`
    : `<code>${esc(p.selector)}</code>`;
  return `<button type="button" class="ap-lint-row ${p.severity}" data-line="${p.line}"><span class="ln">L${p.line}</span>${what}<span class="why">${esc(p.message)}</span></button>`;
}

// A kept rule none of whose selectors matches anything on the page — a
// #workskin-prefixed selector for the header, the tag block, a button row:
// AO3 stores it, the browser finds nothing, and the previewer says so instead
// of staying silent. The selector is judged as AO3 stores it (prefixed unless
// it already starts with #workskin). An invalid selector is left to the lint.
export const NO_MATCH = "matches no element inside #workskin \u2014 only the title, summary, notes and chapter text are reachable by a work skin";
export const NO_MATCH_SITE = "matches no element on this page";
export function unmatchedRules(rules, doc, kind = "work") {
  if (!doc || typeof doc.querySelector !== "function") return [];
  kind = cleanKind(kind);
  const out = [];
  for (const r of rules || []) {
    let matched = false;
    for (const raw of splitSelectors(r.selector)) {
      const s = raw.trim();
      if (!s) continue;
      const stored = storedSelector(s, kind);
      try {
        if (doc.querySelector(stored)) { matched = true; break; }
      } catch { matched = true; break; }
    }
    if (!matched) out.push({ line: r.line, selector: r.selector, code: "no_match", message: kind === "site" ? NO_MATCH_SITE : NO_MATCH, severity: "warning" });
  }
  return out;
}

export function lintHtml(problems) {
  if (!problems.length) return "";
  return problems.map(lintRowHtml).join("");
}

export function issuesLabel(problems) {
  const err = problems.filter((p) => p.severity === "error").length;
  const warn = problems.length - err;
  if (!problems.length) return { text: "AO3-clean", cls: "" };
  const bits = [];
  if (err) bits.push(`${err} dropped`);
  if (warn) bits.push(`${warn} warning${warn === 1 ? "" : "s"}`);
  return { text: bits.join(" · "), cls: err ? "has-err" : "has-warn" };
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

// The frame's document: AO3's site stylesheet as the base, the work skin on
// top, the scraped page as the body. Written with document.write rather than
// srcdoc so the same code runs under jsdom.
// AO3 stamps these on <body>; parts of the site skin key off them.
export const AO3_BODY_CLASS = "logged-in javascript";
export function frameHtml({ siteCss = "", skinCss = "", body = "", bodyClass = AO3_BODY_CLASS } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base target="_blank"><style id="apSite">${siteCss}</style><style id="apSkin">${skinCss}</style></head><body class="${bodyClass}">${body}</body></html>`;
}

export function mountPreview(
  doc = document,
  {
    storage = globalThis.localStorage,
    loadCss = () => fetchText("/ao3/default-skin.css"),
    loadHtml = () => fetchText("/ao3/default-work.html"),
    loadSite = () => fetchText("/ao3/default-skin-webscraped.css"),
  } = {},
) {
  const $ = (id) => doc.getElementById(id);
  const root = $("apRoot");
  const codeHost = $("apCode");
  const skin = $("apSkin");
  const frame = $("apFrame");
  const lint = $("apLint");
  const issues = $("apIssues");
  const expandBtn = $("apExpand");
  const root_el = doc.documentElement;
  const get = (k) => {
    try {
      return storage?.getItem(k);
    } catch (e) {
      return null;
    }
  };
  const set = (k, v) => {
    try {
      v == null ? storage?.removeItem(k) : storage?.setItem(k, v);
    } catch (e) {}
  };

  // ---- the kind of skin: work (prefixed, the work only) or site (whole page) ----
  const kindSel = $("apKind");
  const kind = () => cleanKind(get(KEY_KIND) || DEFAULT_KIND);
  if (kindSel) {
    kindSel.value = kind();
    kindSel.addEventListener("change", () => {
      set(KEY_KIND, cleanKind(kindSel.value));
      apply();
    });
  }

  // ---- the drawer ----
  const drawer = mountSideDrawer({
    grid: root,
    drawer: $("apSide"),
    grip: $("apGrip"),
    tab: $("apTab"),
    closeBtn: $("apMin"),
    key: KEY_DRAWER,
    open: true,
    storage,
  });
  // the component reads a stored state as closed when there is none; a
  // first visit should find the drawer open — it is the point of the page
  if (get(KEY_DRAWER) == null) drawer.setOpen(true);
  let expanded = get(KEY_EXPANDED) === "1";
  const paintExpanded = () => {
    root.classList.toggle("side-expanded", expanded);
    expandBtn.setAttribute("aria-pressed", String(expanded));
    expandBtn.title = expanded ? "Back to normal width" : "Expand";
  };
  expandBtn.addEventListener("click", () => {
    expanded = !expanded;
    set(KEY_EXPANDED, expanded ? "1" : null);
    if (expanded && !drawer.open) drawer.setOpen(true);
    paintExpanded();
  });
  paintExpanded();

  // ---- theme: dark by default, the browser's choice remembered ----
  const themeBtn = $("apTheme");
  const theme = () => (root_el.getAttribute("data-theme") === "light" ? "light" : "dark");
  const paintTheme = () => {
    if (!themeBtn) return;
    const t = theme();
    themeBtn.textContent = t === "dark" ? "☾" : "☀";
    themeBtn.setAttribute("aria-pressed", String(t === "dark"));
    themeBtn.title = t === "dark" ? "Switch to light" : "Switch to dark";
  };
  const setTheme = (t) => {
    root_el.setAttribute("data-theme", t === "light" ? "light" : "dark");
    set(KEY_THEME, t === "light" ? "light" : "dark");
    paintTheme();
    css?.setDark?.(theme() === "dark");
  };
  root_el.setAttribute("data-theme", get(KEY_THEME) === "light" ? "light" : "dark");
  themeBtn?.addEventListener("click", () => setTheme(theme() === "dark" ? "light" : "dark"));
  paintTheme();

  // ---- the editor (CodeMirror) ----
  // `css` is the adapter editor.js returns: .value in/out, problems in, theme.
  // Created with onChange/onSave bound to functions defined further down.
  const css = createEditor(codeHost, {
    value: "",
    dark: theme() === "dark",
    onChange: () => onEdit(),
    onSave: () => save(),
  });

  // ---- download ----
  $("apDownload")?.addEventListener("click", () => {
    const blob = new Blob([css.value], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = DOWNLOAD_NAMES[kind()];
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  // ---- the frame ----
  let siteCss = "";
  let body = "";
  const frameDoc = () => frame?.contentDocument || null;
  function writeFrame() {
    const d = frameDoc();
    if (!d) return;
    d.open();
    d.write(frameHtml({ siteCss, skinCss: skin.textContent, body }));
    d.close();
    mountInspect(d);
  }

  // ---- the inspector: hover the work, click an element, get its selector ----
  // The frame document is new after every write, so the inspector is remounted
  // there; the toggle's state carries over.
  const inspectBtn = $("apInspect");
  let inspector = null;
  const paintInspect = () => {
    const on = !!inspector?.active;
    if (!inspectBtn) return;
    inspectBtn.classList.toggle("on", on);
    inspectBtn.setAttribute("aria-pressed", String(on));
  };
  function mountInspect(d) {
    const wasOn = !!inspector?.active;
    inspector?.destroy();
    inspector = mountInspector(d, {
      kind,
      onChange: paintInspect,
      onPick: (selector) => {
        if (!drawer.open) drawer.setOpen(true);
        css.appendRule(selector);
        onEdit();
      },
    });
    if (wasOn) inspector.setActive(true);
    paintInspect();
  }
  inspectBtn?.addEventListener("click", () => inspector?.setActive(!inspector.active));

  // ---- the skin: always what AO3 would render, the cleaner's output ----
  let defaults = { css: "", html: "" };
  let last = { problems: [], cleaned: "" };
  function apply() {
    const res = lintCss(css.value, { kind: kind() });
    const fd = frameDoc();
    const unmatched = unmatchedRules(res.rules, fd?.getElementById("workskin") ? fd : null, kind());
    // one verdict per rule: a rule that matches nothing needs no prefix note on top
    const dead = new Set(unmatched.map((u) => u.line));
    const problems = [...res.problems.filter((p) => !(p.code === "workskin_prefix" && dead.has(p.line))), ...unmatched].sort((a, b) => a.line - b.line);
    last = { ...res, problems };
    skin.textContent = last.cleaned;
    css.setProblems(last.problems);
    const fs = fd?.getElementById("apSkin");
    if (fs) fs.textContent = skin.textContent;
    lint.innerHTML = lintHtml(last.problems);
    const label = issuesLabel(last.problems);
    issues.textContent = label.text;
    issues.className = "ap-issues " + label.cls;
  }
  // ---- saving: explicit, to localStorage ----
  // Typing only paints; Save is what keeps the CSS for next time. The button
  // reads "Saved" while the box matches what is stored (or the default when
  // nothing is), so an unsaved edit is always visible.
  const saveBtn = $("apSave");
  const savedCss = () => get(KEY_CSS) ?? defaults.css;
  const paintDirty = () => {
    const dirty = css.value !== savedCss();
    if (saveBtn) {
      saveBtn.disabled = !dirty;
      saveBtn.textContent = dirty ? "Save CSS" : "Saved";
    }
  };
  const save = () => {
    set(KEY_CSS, css.value);
    paintDirty();
  };
  saveBtn?.addEventListener("click", save);
  let timer = null;
  function onEdit() {
    paintDirty();
    clearTimeout(timer);
    timer = setTimeout(apply, 120);
  }
  // a lint row selects its line in the editor
  lint.addEventListener("click", (e) => {
    const row = e.target.closest?.(".ap-lint-row");
    if (!row) return;
    css.gotoLine(Number(row.dataset.line) || 1);
  });

  $("apResetCss")?.addEventListener("click", () => {
    css.value = defaults.css;
    set(KEY_CSS, null);
    paintDirty();
    apply();
  });

  // ---- load the shipped defaults, prefer the saved CSS ----
  const ready = Promise.all([
    loadCss().catch(() => ""),
    loadHtml().catch(() => ""),
    loadSite().catch(() => ""),
  ]).then(([c, h, site]) => {
    defaults = { css: c, html: h };
    siteCss = site;
    css.value = savedCss();
    body = h;
    paintDirty();
    // the frame first: the no-match check reads the page
    writeFrame();
    apply();
  });

  return {
    ready,
    drawer,
    apply,
    save,
    editor: css,
    frameDoc,
    get kind() {
      return kind();
    },
    setKind(k) {
      set(KEY_KIND, cleanKind(k));
      if (kindSel) kindSel.value = cleanKind(k);
      apply();
    },
    get inspector() {
      return inspector;
    },
    get inspecting() {
      return !!inspector?.active;
    },
    setTheme,
    theme,
    get expanded() {
      return expanded;
    },
    get problems() {
      return last.problems;
    },
    get cleaned() {
      return last.cleaned;
    },
  };
}
