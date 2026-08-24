// The fandom content pack: prompts, achievements and quotes live together in
// one directory so an alternate fandom can swap the whole set by pointing
// COWRITE_CONTENT_DIR elsewhere (same shape as COWRITE_REF_DIR). Pure paths,
// no I/O — lib/ can import it without gaining side effects.
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = process.env.COWRITE_CONTENT_DIR || join(__dirname, "..", "content");
export const contentPath = (name) => join(CONTENT_DIR, name);
