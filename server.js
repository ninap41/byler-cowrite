// Byler Cowrite — thin entry point. The real code lives in:
//   src/sanitize.js   sanitizers (the server-side trust boundary) + palette
//   src/passwords.js  scrypt hashing
//   src/store.js      the JSON user store + public shapes + badge migration
//   src/game.js       session state machine, persistence, Socket.IO handlers
//   src/routes.js     all HTTP API routes
//   lib/achievements.js, lib/streak.js  pure game rules
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { storage, describeStorage } from "./src/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pick the store BEFORE store.js/game.js load — they read it at import.
// DATABASE_URL set (Replit Postgres): the database is the store, loaded into
// memory here. Unset (local dev, tests): the JSON files under data/ and saves/.
await storage.init();
console.log(describeStorage());
const { SITE, renderPage } = await import("./src/site.js"); // reads the content pack — after init
const { createGame } = await import("./src/game.js");
const { registerRoutes } = await import("./src/routes.js");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
// Pages, ES modules, and CSS must never be served stale: a cached old module
// mixed with a new one breaks the whole import graph (buttons render but no
// handler attaches). Sounds are immutable-ish and may cache.
app.use((req, res, next) => {
  if (!req.path.startsWith("/sounds/")) res.set("Cache-Control", "no-store");
  next();
});
// Pages are rendered, not served raw: renderPage() fills the {{SITE_NAME}}-style
// tokens from the content pack's site.json. Registered BEFORE the static
// middleware so /index.html can't leak an unrendered copy. Auth is enforced
// client-side + on every API/socket call — these are still just files.
const PAGES = ["index", "dashboard", "game", "archive", "stories", "profile", "settings", "write", "writes", "inbox", "admin", "ranks", "reset"];
const pageHtml = new Map();
const servePage = (page) => (_req, res) => {
  if (!pageHtml.has(page)) pageHtml.set(page, renderPage(readFileSync(join(__dirname, "public", page + ".html"), "utf-8")));
  res.type("html").send(pageHtml.get(page));
};
app.get("/", servePage("index"));
for (const page of PAGES) {
  app.get("/" + page + ".html", servePage(page));
  if (page !== "index") app.get("/" + page, servePage(page));
}
app.use(express.static(join(__dirname, "public")));
app.use("/sounds", express.static(join(__dirname, "sounds"), { maxAge: "7d" }));
app.use(express.json({ limit: "2mb" })); // the admin prompt editor PUTs the whole library

const game = createGame(io); // owns sessions, presence, saves/, socket handlers
registerRoutes(app, game);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`${SITE.name} running on http://localhost:${PORT}`);
});
