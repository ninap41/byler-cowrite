// The fandom content pack: prompts, achievements and quotes live together in
// one directory so an alternate fandom can swap the whole set by pointing
// COWRITE_CONTENT_DIR elsewhere (same shape as COWRITE_REF_DIR). No I/O at
// import — lib/ can import it without gaining side effects. readContent()
// is how a pack file is read: through src/storage.js, so in production it
// comes from the database and locally from the directory.
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { storage, getJson } from "./storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = process.env.COWRITE_CONTENT_DIR || join(__dirname, "..", "content");
export const contentPath = (name) => join(CONTENT_DIR, name);
// "prompts.json" -> the parsed pack file, or null when missing/malformed.
export const readContent = (name) => getJson("content", String(name).replace(/\.json$/, ""));
export const writeContent = (name, text) => storage.put("content", String(name).replace(/\.json$/, ""), text);
