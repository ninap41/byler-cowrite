// Bundles CodeMirror 6 (ESM-only on npm) into ONE vendored module the
// no-build app can serve: public/vendor/codemirror.js. Run after bumping the
// @codemirror/* devDependencies; the output is committed.
import { build } from "esbuild";
await build({
  entryPoints: ["scripts/codemirror-entry.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  outfile: "public/vendor/codemirror.js",
  legalComments: "none",
  banner: { js: "/* CodeMirror 6 (MIT) bundled by scripts/build-codemirror.mjs — do not edit */" },
});
console.log("wrote public/vendor/codemirror.js");
