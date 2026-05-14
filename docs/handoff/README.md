# Accident Support Desk SMS Bot Handoff Package

This folder is the handoff package for cloning the Accident Support Desk SMS bot into another GoHighLevel account running the same personal-injury intake model.

It is written for two audiences:

- The business owner/operator who needs to know what to give another team.
- The developer/operator who needs to deploy, connect, test, and maintain the bot.

## Critical Rule

Do not hand over `.env`, database dumps, Slack tokens, OpenAI keys, GoHighLevel tokens, or Render database URLs through GitHub, email, screenshots, or chat.

Those values are secrets. Share them only through a password manager or another approved secure channel. Rotate them after any outside handoff.

## What This Bot Includes

- Node/Express backend in `src/`.
- React/Vite admin dashboard in `web/`.
- Local tester and utility pages in `public/`.
- Postgres production storage with tables for contacts, jobs, messages, escalations, decision logs, webhook events, and settings.
- SMS cold outreach, qualification, warm follow-up, re-engagement, call booking, appointment reminders, no-show recovery, human handoff, opt-out, DND handling, duplicate-phone protection, timezone resolution, Slack alerts, and LLM safety gates.
- GoHighLevel integrations for inbound SMS, NR/no-response enrollment, appointment sync, no-show, bot-control tags, human call activity, and human outbound SMS.
- Slack integrations for SMS escalations, urgent call-now leads, booking/no-show notices, and true bot errors.
- OpenAI integration for LLM fallback and high-risk decision gating.

## Handoff Folder Contents

- `IMPLEMENTATION_MANIFEST.md`: what exists in the app and why.
- `OWNER_EXPORT_CHECKLIST.md`: what Collins/operator must collect before giving this to someone.
- `RECIPIENT_SETUP_CHECKLIST.md`: step-by-step setup checklist for the receiving team.
- `ENVIRONMENT_VARIABLES.md`: every required environment variable and where to get it.
- `HANDOFF_ENV_TEMPLATE.env`: sanitized env template to give the recipient.
- `GHL_WORKFLOWS_AND_WEBHOOKS.md`: all GHL workflows/webhooks that must be created and tested.
- `DATABASE_TRANSFER.md`: how to export/import the Postgres database safely.
- `REPO_UPDATE_STRATEGY.md`: how another operator can receive future repo updates.
- `VALIDATION_TEST_PLAN.md`: how to prove the clone works before live traffic.

## Recommended Handoff Model

Best production-safe model:

1. Give the recipient access to a private fork or template copy of the repo.
2. Give them their own Render/Railway service and their own Postgres database.
3. Give them their own GHL API token, GHL location ID, calendar ID, Slack app/token, and OpenAI key.
4. Restore a database snapshot only if there is a legitimate reason to clone historical contacts/messages.
5. Keep `DRY_RUN=true` until all webhook tests pass.
6. Flip `DRY_RUN=false` only after the old bot is disabled or after you are certain the new service points to a separate GHL location.

Do not run two live bot services against the same GHL location and same contacts unless one is in `DRY_RUN=true`. That can double-text leads.

## Minimum Production Pieces

The receiving operator needs:

- GitHub repo access or a repo fork.
- Always-on Node hosting, such as Render Web Service.
- Managed Postgres database.
- Public HTTPS URL.
- GoHighLevel private integration token or OAuth app installation.
- GoHighLevel workflows listed in `GHL_WORKFLOWS_AND_WEBHOOKS.md`.
- Slack bot token and channel IDs.
- OpenAI API key.
- Admin password.
- Webhook secret shared between GHL workflows and the bot.
- Uptime monitor pointed at `/health`.

## Existing Repo Paths

- Main server: `src/server.js`
- Main flow engine: `src/flow.js`
- Classifiers/parsers: `src/classifier.js`
- LLM gate: `src/llmDecisionGate.js`
- Templates: `src/templates.js`
- GHL adapter: `src/adapters/ghl.js`
- Slack adapter: `src/adapters/slack.js`
- Postgres store: `src/postgresStore.js`
- Config/env loader: `src/config.js`
- Admin dashboard app: `web/`
- Static tester/utilities: `public/`
- Tests: `test/`

## Safe Handoff Sequence

1. Freeze current production changes by committing/pushing the repo.
2. Create a release tag in GitHub, for example `handoff-YYYY-MM-DD`.
3. Export a sanitized handoff package from this folder.
4. Export the database only if needed, encrypt it, and deliver it separately.
5. Give secrets through a password manager.
6. Recipient deploys with `DRY_RUN=true`.
7. Recipient runs the validation plan.
8. Recipient switches to `DRY_RUN=false`.
9. Monitor Slack, dashboard, and `/health` for the first live day.

