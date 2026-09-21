# Replit run notes

## Run

- Workflow command: `npm start`
- Application port: `3000`
- `.replit` maps port `3000` to external port `80`.
- Deployment target: Reserved VM (`deploymentTarget = "vm"`), not Autoscale.

## Storage

The app uses PostgreSQL when `DATABASE_URL` is available. The managed Replit
PostgreSQL database is attached to this workspace and deployments.

On startup, confirm the log begins with:

```text
storage: postgres (...)
```

If it reports `storage: files`, `DATABASE_URL` is not reaching the process and
data will not survive a redeploy.

## Saving, restarts and getting words back

- **A restart is safe only once the log says so.** On SIGTERM (every publish) the server prints `SIGTERM: flushing storage before exit`, gives every queued and owed database write one more go, then exits. `storage: exiting with rows still owed: …` or `storage: flush timed out` names rows the database never took — those stories roll back to their last landed copy on boot. Before publishing, `/api/admin/storage` (admin) should show `"unlanded": []` and no recent `lastError`.
- **A writer lost words — in order:** (1) in the editor, Document → 🕘 Version history: the copy from just before a big drop is always kept (14 days), plus one every ~10 minutes of writing and one a day; Restore is undoable. (2) Their browser's draft: reopening the story offers "You have unsaved changes from a previous session" whenever the draft differs from what is stored. (3) Only then the database: Replit's Postgres keeps point-in-time history — restore a COPY to a moment before the loss and take the one row (`SELECT doc FROM cowrite_blobs WHERE kind='doc' AND name='<story id>'`); history copies are rows of `kind='dochist'` whose `name` starts with the story id. Don't restore over live: everyone else's work since that moment goes with it.
- Words typed but never saved exist only in that browser. The head row's Saved/Unsaved is the truth: "Saved" now means the database took it (a refused write answers 503 and the page stays Unsaved).

## Announcements (admin blog)

`/announcements` is the admins' blog. Its posts are ONE document,
`announcements/announcements` in the `cowrite_blobs` table (locally
`data/announcements.json`), written through `src/storage.js` like every other
document — so **nothing to configure**: with `DATABASE_URL` set they are in
PostgreSQL and survive redeploys. Do not add a separate table, file, or
Replit storage bucket for them, and do not treat `data/announcements.json` as
the store in production (the VM's disk resets on publish). The startup log's
`announcements N` count confirms the row is loaded.

## Email

Password-reset emails use Nodemailer over **Brevo**'s SMTP relay. The five
`SMTP_*` secrets (`SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`,
`SMTP_USER`, `SMTP_PASS` = the Brevo SMTP key, `SMTP_FROM` = a sender address
verified in Brevo) are set on the workspace and the deployment — see the
README's "Where data lives" section. Without `SMTP_HOST`, reset links are
logged to the server console for local development only. When SMTP is
configured, `PUBLIC_APP_URL` must also contain the canonical HTTPS origin used
in reset links.
