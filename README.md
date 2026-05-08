# Accident Support Desk SMS Bot

Small custom backend for SMS follow-up, qualification, re-engagement, Slack escalation, and GoHighLevel call booking.

## Run

```bash
cp .env.example .env
npm start
```

No npm install is required for the MVP because it uses only Node built-ins.

## Local Test Checklist

Run the automated checks:

```bash
npm test
```

Start the server:

```bash
npm start
```

Open the visual tester:

```text
http://127.0.0.1:3000/tester
```

Open the admin dashboard:

```text
http://127.0.0.1:3000/dashboard
```

Open the controlled NR backfill screen:

```text
http://127.0.0.1:3000/backfill
```

Open the GHL reply review database:

```text
http://127.0.0.1:3000/review
```

The tester lets you:

- start a fake no-response lead
- reply back and forth as the PC
- see outbound bot messages
- inspect engagement status and qualification progress
- view pending scheduled jobs
- advance the next scheduled job immediately
- auto-advance one scheduled job every 60 seconds
- reset the test store

The backfill screen lets you preview and queue existing NR leads in small batches instead of blasting every old lead at once.

The dashboard shows lifecycle counts, message volume, escalation volume, human speed-to-lead, failed jobs, due jobs, duplicate phone conflicts, missing timezone records, paused contacts, recent contacts, recent messages, and a clickable issue queue. Contact detail includes conversation history, full event timeline, pending/completed jobs, escalation history, collected qualification answers, admin notes, and controls to acknowledge, pause, return to bot, or mark DNC.

The admin dashboard also includes:

- Hot lead command center
- Escalation SLA tracker
- Bot confusion / low-confidence queue
- Lifecycle funnel
- Search, filters, and guarded bulk actions
- Appointment pipeline
- Automation safety monitor
- Source performance
- Reply-time heatmap
- LLM usage estimate
- Quality review queue
- Replay simulator link
- Live template editor for all bot SMS templates
- A/B testing dashboard for SMS template variants, traffic split, and response-rate reporting

By default `DRY_RUN=true`, so the tester does not send real GHL SMS, create real appointments, or post to Slack.

## GHL SMS History Import

Add these to `.env`:

```bash
GHL_API_TOKEN=your_private_integration_token
GHL_LOCATION_ID=your_location_id
DRY_RUN=true
```

Initialize the SQLite database:

```bash
python3 scripts/ghl_training_db.py init
```

Import a small sample:

```bash
python3 scripts/ghl_training_db.py import --max-pages 1 --page-size 100
```

Import more pages:

```bash
python3 scripts/ghl_training_db.py import --max-pages 10 --page-size 100
```

Review imported lead replies at:

```text
http://127.0.0.1:3000/review
```

The importer stores raw GHL API pages, normalized SMS messages, and lead-reply training examples in `data/training.sqlite`.

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Simulate GHL marking a lead as no response:

```bash
curl -X POST http://127.0.0.1:3000/webhooks/ghl/disposition \
  -H 'Content-Type: application/json' \
  -d '{"contactId":"test-1","name":"Alex","phone":"+15550001111","timezone":"America/Chicago","leadSource":"local test","disposition":"no response"}'
```

Simulate a reply that starts qualification:

```bash
curl -X POST http://127.0.0.1:3000/webhooks/ghl/inbound-sms \
  -H 'Content-Type: application/json' \
  -d '{"contactId":"test-1","message":"No the other driver was at fault"}'
```

Simulate opt-out:

```bash
curl -X POST http://127.0.0.1:3000/webhooks/ghl/inbound-sms \
  -H 'Content-Type: application/json' \
  -d '{"contactId":"test-2","name":"Sam","phone":"+15550002222","message":"STOP"}'
```

For local GoHighLevel webhook testing, expose the server with a tunnel:

```bash
ngrok http 3000
```

Use the HTTPS ngrok URL as the base URL in GHL webhook settings.

## Deployment

Do not deploy this MVP as serverless. It has a scheduler and writes bot memory to `data/store.json`, so use one always-on Node service with persistent storage.

Minimum deployment requirements:

- Node 20+
- Start command: `npm start`
- Public HTTPS URL
- Postgres database configured with `DATABASE_URL`
- Webhook secret configured with `WEBHOOK_SECRET`
- Dashboard password configured with `ADMIN_PASSWORD`
- Environment variables from `.env.example`
- External uptime monitor pointed at `/health`

Recommended simple options:

- Railway Node service plus Railway Postgres.
- Render Web Service plus managed Postgres.
- A small VPS running Node with `pm2` or `systemd`.

After deployment, configure GHL webhooks:

- `POST https://your-domain.com/webhooks/ghl/disposition`
- `POST https://your-domain.com/webhooks/ghl/inbound-sms`
- `POST https://your-domain.com/webhooks/ghl/missed-call`
- `POST https://your-domain.com/webhooks/ghl/bot-control`

Then set:

- `GHL_API_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_CALENDAR_ID`
- `SLACK_BOT_TOKEN`
- `SLACK_ESCALATION_CHANNEL=#sms-esiliation`
- `SLACK_BOT_ERRORS_CHANNEL=#bot-error`
- `SLACK_BOOKING_CHANNEL=#booking`
- `DATABASE_URL`
- `WEBHOOK_SECRET`
- `ADMIN_PASSWORD`

For each GHL webhook request, include the same secret as either:

- `x-webhook-secret: <WEBHOOK_SECRET>`
- `x-asdleads-secret: <WEBHOOK_SECRET>`

## Webhooks

- `POST /webhooks/ghl/disposition`
  Starts the bot when a GHL contact receives the custom disposition `no response` or `NR`.

- `POST /webhooks/ghl/inbound-sms`
  Handles inbound SMS replies.

- `POST /webhooks/ghl/missed-call`
  Starts missed-call recovery for scheduled calls that were not answered.

- `POST /webhooks/ghl/bot-control`
  Handles a GHL custom-field/workflow control action. Use this instead of call dispositions for normal SMS bot control.
  Supported values include `human_acknowledged`, `return_to_bot`, `nq`, `signed`, and `do_not_contact`.
  For the simple tag-based setup, have a GHL workflow call this webhook when one of these tags is added, and include the contact id plus tags. Tags like `return_to_bot`, `human_ack`, `NQ`, `signed`, and `DNC` are accepted.

- `POST /api/backfill/preview`
  Previews existing NR contacts before queueing them. Accepts either a pasted `contacts` array or pulls by GHL tag when the API supports contact search.

- `POST /api/backfill/start`
  Queues a capped, staggered batch of existing NR contacts. It schedules first SMS jobs spaced apart, filters out `NQ`, `signed`, `DNC`, opt-out, and invalid-phone contacts, and does not send the whole backlog at once.

- `POST /jobs/tick`
  Runs due jobs manually. The server also runs this automatically every 60 seconds.

- `GET /health`
  Returns app and storage health for uptime monitoring.

- `GET /dashboard`
  Admin dashboard for bot performance and operational issues. Protect the metrics API by setting `ADMIN_PASSWORD` in production.

## Payload Shape

The webhook normalizer accepts flexible GoHighLevel-style keys. Include as many as available:

```json
{
  "contactId": "ghl-contact-id",
  "name": "Jane",
  "phone": "+15551234567",
  "timezone": "America/Chicago",
  "leadSource": "Facebook",
  "message": "No, the other driver was at fault",
  "disposition": "no response"
}
```

## Cost Control

The active path uses hard-coded deterministic parsing:

1. opt-out detection
2. human/escalation intent
3. current-question answer parser
4. call-now / call-time parser

No LLM is called in the MVP. Ambiguous messages clarify once, then escalate.

When `LLM_FALLBACK_ENABLED=true`, hard-coded parsing still runs first. The LLM is only used as fallback. If the LLM fails, the bot alerts the bot-error Slack channel and escalates the lead to human.
