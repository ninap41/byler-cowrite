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

SMTP is intentionally not configured yet; without the `SMTP_*` settings,
password-reset links are logged to the server console.