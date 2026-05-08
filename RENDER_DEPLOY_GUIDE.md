# Render Deploy Guide

Use this if Railway is not working.

## Why Render

Render is a managed host like Railway. It can run this Node bot as an always-on web service and connect it to Render Postgres.

Important:

Use a paid always-on web service for production. A free Render web service can spin down when idle, which is not safe for a 24/7 SMS bot.

## What Is Already Prepared

This repo includes:

```text
render.yaml
```

That file tells Render to create:

- one Node web service named `asdleads-sms-bot`
- one Postgres database named `asdleads-sms-bot-db`
- `DATABASE_URL` connected automatically from the database to the app
- `/health` as the health check
- `DRY_RUN=true` for the first deployment

## Step 1: Create Render Blueprint

1. Go to Render.
2. Choose New.
3. Choose Blueprint.
4. Connect GitHub repo:

```text
https://github.com/aileadzsudo/asdleads-sms-bot
```

5. Render should detect `render.yaml`.

## Step 2: Fill Secret Values

Render will ask for secret values that are marked `sync: false`.

Fill these:

```text
ADMIN_PASSWORD
WEBHOOK_SECRET
GHL_API_TOKEN
GHL_LOCATION_ID
GHL_CALENDAR_ID
SLACK_BOT_TOKEN
SLACK_ESCALATION_CHANNEL
SLACK_BOT_ERRORS_CHANNEL
SLACK_BOOKING_CHANNEL
OPENAI_API_KEY
```

Keep:

```text
DRY_RUN=true
```

## Step 3: Deploy

After deployment, open:

```text
https://your-render-url.onrender.com/health
```

You want:

```text
ok: true
storage.type: postgres
dryRun: true
```

## Step 4: Do Not Add GHL Webhooks Yet

First confirm:

- `/health` works
- `/dashboard` works
- `/integrations` works
- storage says `postgres`
- dry run says `true`

After that, we connect GHL webhooks.
