# Accident Support Desk SMS Bot Production Runbook

## What Keeps The Bot Running

- GitHub is the source of truth for the code.
- Render runs the live web service 24/7 from the `main` branch.
- Render Postgres stores live bot state, contacts, jobs, messages, template changes, and dashboard data.
- GoHighLevel sends webhooks into Render and receives outbound SMS/calendar actions from the bot.
- Slack receives escalation, booking, and real bot-error notifications.

## Daily Health Check

Open:

`https://asdleads-sms-bot.onrender.com/health`

Healthy means:

- `ok` is `true`
- `storage.ok` is `true`
- `storage.type` is `postgres`
- `dryRun` is `false` only when live sending is intended
- `llmFallbackEnabled` is `true`

## Before Any Code Push

Run locally:

```bash
npm test
npm run build
```

Do not push if either command fails.

## Rollback If A Push Breaks Production

1. Go to Render.
2. Open the `asdleads-sms-bot` service.
3. Go to Deploys.
4. Pick the last working deploy.
5. Click rollback/redeploy that older deploy.

If Render is healthy but bot behavior is wrong, use the dashboard or emergency job controls to pause/cancel batches before rolling back.

## Backups

Minimum recommended setup:

- Keep GitHub connected and pushed after every stable change.
- Enable automated Render Postgres backups if the plan supports it.
- Before large bot changes or mass batches, manually trigger/export a database backup from Render.
- Keep this repo cloned locally at `/Users/collins/asdleads-sms-bot`.

The code can be rebuilt from GitHub. The database is what preserves live bot memory, message history, pending jobs, and dashboard state.

## Critical Environment Variables

Do not delete these in Render:

- `DATABASE_URL`
- `GHL_API_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_CALENDAR_ID`
- `WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_ESCALATION_CHANNEL`
- `SLACK_BOT_ERRORS_CHANNEL`
- `SLACK_BOOKING_CHANNEL`
- `PUBLIC_BASE_URL`
- `DRY_RUN`
- `LLM_FALLBACK_ENABLED`

## When To Pause The Bot

Pause or cancel pending jobs before continuing if:

- SMS copy is wrong.
- GHL booking is failing repeatedly.
- Slack is not receiving escalations/bookings.
- A batch is sending to the wrong contacts.
- The dashboard shows unusual spikes in skipped, failed, or blocked sends.

## Human Hold Tag

Use this GHL tag to keep a lead fully manual:

`human_hold`

When this tag is present, the bot will not auto-return the lead after a human sends a manual SMS.
