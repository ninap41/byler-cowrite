# Moving to Node 22

A plan, not a change. Nothing in the repo moves until each step below is done in order.

## Where we stand

| Where | Node today | Pinned by |
|---|---|---|
| Replit (dev + the deployed VM) | 20 | `.replit` → `modules = ["nodejs-20", …]` |
| GitHub Actions (typecheck + tests) | 22 | `.github/workflows/ci.yml` → `node-version: 22` |
| Local machines | whatever is installed (25 at the time of writing) | nothing — no `.nvmrc`, no `engines` in `package.json` |

So the suite already passes on 22 in CI and on 25 locally; production is the only place still on 20. Every dependency is happy on 22 — the tightest is jsdom 29 at `^20.19.0 || ^22.13.0 || >=24.0.0`; esbuild, pg, socket.io, express, nodemailer and TypeScript all accept anything from 18 up.

## Why 22, and why now

- **Node 20 leaves maintenance in April 2026.** 22 is the current LTS line (maintenance to April 2027).
- **Type stripping is on by default from 22.18.** `node file.ts` runs a TypeScript file with the types erased, no flag, no loader. That is exactly what `scripts/build.mjs` does for the browser today, done by the runtime for the server instead — it is the door to writing `src/` and `lib/` in TypeScript later without adding a build step for them, and to tests importing `client/*.ts` directly instead of the emitted twins. (Only *erasable* syntax: no `enum`, no `namespace`, no parameter properties. `verbatimModuleSyntax` in `tsconfig.json` already enforces the import/export half of that rule.)
- **`require(esm)` is unflagged from 22.12**, `fetch`/`WebSocket` are stable globals, `node --test` grows glob support and `--test-isolation`. None of this is needed today; all of it removes a future excuse.

## The plan

Each step is its own commit and the suite runs after each one.

### Server (Replit)

1. **Pin the floor** in `package.json`:
   ```json
   "engines": { "node": ">=22.13" }
   ```
   `22.13` is jsdom's floor on the 22 line. This is advisory (npm only refuses with `engine-strict`), but it documents the intent and Replit's deploy reads it.
2. **Add `.nvmrc`** containing `22` so `nvm use` / `fnm use` land every contributor on the same line.
3. **Switch Replit**: in `.replit`, `modules = ["nodejs-22", "web", "postgresql-16"]`. Open the Replit shell, run `node --version` to confirm the module took, then `npm ci && npm test`. The suite is hermetic (temp data dirs, `DATABASE_URL` blanked by `test/helpers.mjs`), so this touches nothing in Postgres.
4. **Run the dev server on 22** with the Run button and click through a game, a solo write and `/admin` once. There is no code path that depends on a Node version, so this is a smoke test, not a hunt.
5. **Redeploy**. The deployment VM uses the same module, so the deploy after step 3 is the production switch. First boot after the deploy is a normal boot — `storage.init()` loads from Postgres as always; nothing reseeds.
6. **Rollback** is reverting the `.replit` line and redeploying. Nothing on disk or in the database changes shape between 20 and 22.

### Client (build, tests, CI)

The browser never sees Node, so "client on 22" means the tooling around `client/`:

7. **CI stays on 22** (already there). Once production is on 22 too, the matrix is one line, not two — don't add a 20 job "just in case"; the point is one runtime everywhere.
8. **`scripts/build.mjs`** is unchanged: esbuild is the emitter for the browser regardless of the Node version, because browsers don't strip types.
9. **Tests may import the `.ts` sources directly** once everything is on ≥22.18. `test/client-*.test.mjs` currently import `../public/js/*.js` (the emitted twins); pointing them at `../client/*.ts` makes a failure point at the file you edit. Keep `test/build.test.mjs` importing the emitted files — its job is to prove the twins are current — and keep the three tests that regex an emitted file's source (`pages`, `gimmicks`, `inbox`) on `public/js`, since esbuild's spellings are what ships.
10. **Then, optionally, `src/` and `lib/` as TypeScript**: with type stripping on, `server.js` can `import "./src/game.ts"` and the `checkJs` JSDoc typedefs added on 2026-09-15 (`User`, `Session`, `Writer`…) become real `interface`s. That is a separate plan; this one only removes the runtime obstacle to it.

## What not to do

- Don't set `engine-strict=true` in `.npmrc` — it turns an advisory floor into a hard `npm ci` failure on any machine that drifts, which is a worse day than a warning.
- Don't jump to 24 for production. It is LTS too, but Replit's module for it lags and there is nothing in 24 this app needs.
- Don't change `.replit` and the deploy in the same sitting as a content or schema change. If something breaks, one variable at a time is how you find out which.

## Done when

`node --version` prints a 22.x on Replit, in CI and in `.nvmrc`; `package.json` carries the `engines` floor; the suite is green on the deployed VM; and this file's "Where we stand" table has one row.
