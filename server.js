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
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initPersistence } from "./src/persist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// With DATABASE_URL set (Replit Postgres), restore data/ and saves/ from the
// blob mirror BEFORE store.js/game.js load — they read those files at import.
const DATA_DIR = process.env.COWRITE_DATA_DIR || join(__dirname, "data");
await initPersistence({
  dataDir: DATA_DIR,
  saveDir: process.env.COWRITE_SAVE_DIR || join(__dirname, "saves"),
  docDir: process.env.COWRITE_DOC_DIR || join(DATA_DIR, "docs"),
});
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
app.use(express.static(join(__dirname, "public")));
app.use("/sounds", express.static(join(__dirname, "sounds"), { maxAge: "7d" }));
app.use(express.json());

// Clean page URLs for the multi-page app (auth is enforced client-side +
// on every API/socket call — these are just static files).
for (const page of ["dashboard", "game", "archive", "stories", "profile", "settings", "write", "writes"])
  app.get("/" + page, (_req, res) => res.sendFile(join(__dirname, "public", page + ".html")));

const game = createGame(io); // owns sessions, presence, saves/, socket handlers
registerRoutes(app, game);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Byler Cowrite running on http://localhost:${PORT}`);
});
