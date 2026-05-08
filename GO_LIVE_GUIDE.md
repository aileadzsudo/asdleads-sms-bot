# Accident Support Desk SMS Bot Go-Live Guide

This guide is the simple step-by-step path for taking the bot live safely.

The rule for launch is:

1. Test locally.
2. Deploy with `DRY_RUN=true`.
3. Confirm Railway, Postgres, GHL, Slack, OpenAI, and dashboard work.
4. Test with your own contact.
5. Turn `DRY_RUN=false`.
6. Start with a small 25-contact batch.

Do not skip straight to sending live SMS.

## Current Project Folder

The bot is built here:

```text
/Users/collins/asdleads-sms-bot
```

## Section 1: Local Prep

Goal:

Make sure the app works on your computer before deploying it.

What Codex checks:

- The code can start.
- Automated tests pass.
- The health page works.
- The dashboard opens.
- The tester opens.

Commands:

```bash
cd /Users/collins/asdleads-sms-bot
npm test
npm start
```

Local links:

```text
http://127.0.0.1:3000/health
http://127.0.0.1:3000/dashboard
http://127.0.0.1:3000/tester
http://127.0.0.1:3000/integrations
http://127.0.0.1:3000/backfill
```

Safe setting:

```text
DRY_RUN=true
```

When `DRY_RUN=true`, the bot can be tested without sending real SMS, creating real calendar appointments, or posting real Slack messages.

## Section 2: Railway Setup

Goal:

Put the app on the internet so GHL can send it webhooks.

Needed in Railway:

- One Node app/service.
- One Postgres database.
- Environment variables copied from `.env`, but with production values.

Important production values:

```text
HOST=0.0.0.0
DRY_RUN=true
DATABASE_URL=Railway Postgres URL
WEBHOOK_SECRET=a long private secret
ADMIN_PASSWORD=a dashboard password
PUBLIC_BASE_URL=your Railway app URL
```

Keep `DRY_RUN=true` for the first deploy.

## Section 3: GHL Webhooks

Goal:

Tell GHL where to send bot events.

Webhook URLs:

```text
POST https://your-live-url/webhooks/ghl/disposition
POST https://your-live-url/webhooks/ghl/inbound-sms
POST https://your-live-url/webhooks/ghl/missed-call
POST https://your-live-url/webhooks/ghl/bot-control
```

Every webhook should include this header:

```text
x-webhook-secret: same secret as WEBHOOK_SECRET
```

The bot starts when GHL sends a disposition/control value of:

```text
no response
NR
```

## Section 4: First Live Test

Goal:

Test one contact before testing a batch.

Steps:

1. Keep `DRY_RUN=true`.
2. Trigger NR on your own test contact in GHL.
3. Check the dashboard.
4. Check `/health`.
5. Check `/integrations`.
6. Confirm the bot records the contact and pending jobs.
7. Turn `DRY_RUN=false` only after this works.
8. Trigger one real SMS test to your own phone.

## Section 5: Small Batch Test

Goal:

Start with 25 existing NR leads, not hundreds.

Use:

```text
/backfill
```

Recommended first batch:

```text
Max contacts: 25
Spacing: 5 to 10 minutes
Tag/disposition: NR
```

Watch:

- Dashboard
- Slack escalation channel
- Slack booking channel
- Slack bot error channel
- GHL contact conversations
- `/health`

If anything looks wrong, pause before increasing volume.

## Stop Conditions

Stop the batch if:

- Bot sends the wrong type of message.
- GHL messages fail.
- Slack errors are firing.
- Duplicate contacts are being paused too often.
- Inbound replies are not appearing in the dashboard.
- App health is failing.
- Human escalations are not reaching Slack.

## Next Scale Step

If the 25-contact test looks good for 24 hours:

```text
Next batch: 50 contacts
Then: 100 contacts
Then: full NR backlog
```

Do not jump straight from 25 to all contacts.
