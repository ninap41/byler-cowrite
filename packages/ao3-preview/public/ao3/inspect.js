// The previewer's element inspector: hover the rendered work, see the element
// outlined with its selector named, click to hand that selector to the editor.
// The frame is same-origin (preview.js writes it with document.write), so the
// parent listens on the frame's own document. Nothing here touches the editor;
// `onPick(selector, el)` is the whole contract.

const OWN = /^ap-insp-/;
export const STYLE_ID = "apInspectStyle";
export const LABEL_CLASS = "ap-insp-label";
export const HOVER_CLASS = "ap-insp-hover";
export const OUTSIDE_CLASS = "ap-insp-outside";
export const OUTSIDE_NOTE = "outside the work \u2014 a work skin can't style this";

// Only what sits inside #workskin is reachable by a work skin (AO3 prefixes
// every selector with it). The header, the tag block, the action rows and the
// footer are site chrome; a pick there is allowed but told so.
export function outsideWork(el) {
  if (!el || el.nodeType !== 1) return false;
  return !(el.id === "workskin" || (typeof el.closest === "function" && el.closest("#workskin")));
}

const ident = (s) => String(s).replace(/([^A-Za-z0-9_ -￿-])/g, "\\$1");

// The clicked element alone, not its ancestry: "#workskin " + (#id, else
// tag.classes, else tag). #workskin itself is just "#workskin". That is
// exactly what AO3 stores — otwarchive's css_cleaner prefixes every work-skin
// selector with "#workskin " unless it already starts with it:
//   (prefix.blank? || sel.start_with?(prefix)) ? sel : "#{prefix} #{sel}"
// so the previewer writes the prefixed form up front and the lint stays quiet.
// For a SITE skin (kind "site") AO3 stores the selector as written and it
// reaches the whole page — so site chrome outside the work is picked bare
// (`#header`, `button.btn`), while anything INSIDE the work is still picked
// as `#workskin …`: that is where it lives, and the prefix keeps the rule
// scoped to the work rather than every `p` on the site.
export function selectorFor(el, { kind = "work" } = {}) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id === "workskin") return "#workskin";
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList || []).filter((c) => !OWN.test(c));
  const own = el.id ? "#" + ident(el.id) : tag + classes.map((c) => "." + ident(c)).join("");
  return kind === "site" && outsideWork(el) ? own : "#workskin " + own;
}

// The element's ancestry, outermost first, html/body left out — what the
// breadcrumb strip shows. Each step is {el, text} with text = tag#id.classes.
export function pathOf(el) {
  const out = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const tag = n.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    const classes = Array.from(n.classList || []).filter((c) => !OWN.test(c));
    out.unshift({ el: n, text: tag + (n.id ? "#" + n.id : "") + classes.map((c) => "." + c).join("") });
  }
  return out;
}

const FRAME_CSS = `
html.ap-inspecting, html.ap-inspecting * { cursor: crosshair !important; }
.${HOVER_CLASS} { outline: 2px solid #ff2d95 !important; outline-offset: -2px; background-color: rgba(255, 45, 149, 0.08) !important; }
.${HOVER_CLASS}.${OUTSIDE_CLASS} { outline-color: #9a9a9a !important; outline-style: dashed !important; background-color: rgba(120, 120, 120, 0.1) !important; }
.${LABEL_CLASS}.${OUTSIDE_CLASS} { background: #6b6b6b; }
.${LABEL_CLASS} { position: fixed; z-index: 2147483647; pointer-events: none; font: 600 12px/1.3 Menlo, Consolas, monospace; color: #fff; background: #ff2d95; padding: 2px 7px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
`;

export function mountInspector(frameDoc, { onPick, onChange, onHover, kind = () => "work" } = {}) {
  let active = false;
  let hovered = null;
  let label = null;
  let style = null;

  const target = (e) => {
    const t = e.target;
    if (!t || t.nodeType !== 1) return null;
    if (t.classList?.contains(LABEL_CLASS)) return null;
    if (t === frameDoc.documentElement || t === frameDoc.body) return null;
    return t;
  };
  const clearHover = () => {
    hovered?.classList.remove(HOVER_CLASS, OUTSIDE_CLASS);
    hovered = null;
    if (label) label.hidden = true;
  };
  // outline t and name it; `at` places the label (a crumb hover has no pointer
  // in the frame, so it labels the element's own top-left corner)
  const paint = (t, at) => {
    const k = kind();
    const outside = k !== "site" && outsideWork(t);
    if (t !== hovered) {
      hovered?.classList.remove(HOVER_CLASS, OUTSIDE_CLASS);
      hovered = t;
      t.classList.add(HOVER_CLASS);
      t.classList.toggle(OUTSIDE_CLASS, outside);
    }
    if (label) {
      label.hidden = false;
      label.textContent = outside ? `${selectorFor(t, { kind: k })} \u00b7 ${OUTSIDE_NOTE}` : selectorFor(t, { kind: k });
      label.classList.toggle(OUTSIDE_CLASS, outside);
      const w = frameDoc.documentElement.clientWidth || 0;
      const h = frameDoc.documentElement.clientHeight || 0;
      const x = Math.max(0, Math.min((at.x ?? 0) + 14, Math.max(0, w - 260)));
      const y = (at.y ?? 0) + 18 > h - 24 ? (at.y ?? 0) - 26 : (at.y ?? 0) + 18;
      label.style.left = x + "px";
      label.style.top = y + "px";
    }
  };
  const onMove = (e) => {
    const t = target(e);
    if (!t) return clearHover();
    paint(t, { x: e.clientX, y: e.clientY });
    onHover?.(t, pathOf(t));
  };
  // the pointer leaving the frame keeps the breadcrumb (it is where the
  // pointer is going); only the outline and label go
  const onLeave = () => clearHover();
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = target(e);
    if (!t) return;
    onPick?.(selectorFor(t, { kind: kind() }), t);
  };
  const onKey = (e) => {
    if (e.key === "Escape") setActive(false);
  };

  function setActive(on) {
    on = !!on;
    if (on === active) return;
    active = on;
    const root = frameDoc.documentElement;
    if (on) {
      style = frameDoc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = FRAME_CSS;
      (frameDoc.head || root).appendChild(style);
      label = frameDoc.createElement("div");
      label.className = LABEL_CLASS;
      label.hidden = true;
      (frameDoc.body || root).appendChild(label);
      root.classList.add("ap-inspecting");
      frameDoc.addEventListener("mousemove", onMove, true);
      frameDoc.addEventListener("mouseleave", onLeave, true);
      frameDoc.addEventListener("click", onClick, true);
      frameDoc.addEventListener("keydown", onKey, true);
    } else {
      clearHover();
      root.classList.remove("ap-inspecting");
      style?.remove();
      label?.remove();
      style = label = null;
      frameDoc.removeEventListener("mousemove", onMove, true);
      frameDoc.removeEventListener("mouseleave", onLeave, true);
      frameDoc.removeEventListener("click", onClick, true);
      frameDoc.removeEventListener("keydown", onKey, true);
    }
    onChange?.(active);
  }

  return {
    setActive,
    get active() {
      return active;
    },
    // a breadcrumb's hover: outline that ancestor (label at its corner); null clears
    highlight(el) {
      if (!active) return;
      if (!el) return clearHover();
      const r = el.getBoundingClientRect?.() || { left: 0, top: 0 };
      paint(el, { x: Math.max(0, r.left), y: Math.max(0, r.top) });
    },
    // a breadcrumb's click: pick that ancestor
    pick(el) {
      if (!active || !el) return;
      onPick?.(selectorFor(el, { kind: kind() }), el);
    },
    destroy() {
      setActive(false);
    },
  };
}
