// A small markdown → html renderer for announcements. Pure, no dependencies.
// It emits ONLY the story-line subset (h1–h3, p, blockquote, hr, br, ul/ol/li,
// b/i/s) so the result passes sanitizeRich() unchanged — links and images are
// deliberately not markdown features here, matching the rest of the site.
// Everything textual is escaped first, so raw html in the source is inert.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, "<i>$1</i>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<i>$2</i>");
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flush(); out.push(`<h${m[1].length}>${inline(m[2].trim())}</h${m[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i].replace(/^>\s?/, "")), i++;
      out.push(`<blockquote>${renderMarkdown(q.join("\n"))}</blockquote>`);
      continue;
    }
    if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(line))) {
      flush();
      const ordered = /\d/.test(m[1]);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length && (m = re.exec(lines[i]))) items.push(`<li>${inline(m[1])}</li>`), i++;
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join("");
}
