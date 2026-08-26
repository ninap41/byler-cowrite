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

## Email

Password-reset emails go out through **Brevo**'s SMTP relay. The five
`SMTP_*` secrets (`SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`,
`SMTP_USER`, `SMTP_PASS` = the Brevo SMTP key, `SMTP_FROM` = a sender address
verified in Brevo) are set on the workspace and the deployment — see the
README's "Where data lives" section. Without them the app still runs and logs
reset links to the server console instead of sending them.