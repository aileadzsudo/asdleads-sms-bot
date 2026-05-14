# Recipient Setup Checklist

This is the step-by-step checklist for the receiving team.

## Phase 1: Get The Code

1. Get access to the repo or a private fork.
2. Clone it:

```bash
git clone <repo-url>
cd asdleads-sms-bot
npm ci
npm test
npm run build
```

3. Confirm tests pass before changing anything.

## Phase 2: Create Hosting

Recommended:

- Render Web Service.
- Render managed Postgres.

Required settings:

- Runtime: Node 20+
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/health`
- Auto deploy: on for production branch if you want automatic updates.

Do not deploy as serverless. The bot has scheduled jobs and needs an always-on process.

## Phase 3: Create Database

1. Create managed Postgres.
2. Add `DATABASE_URL` to the app service.
3. If importing an existing database snapshot, restore it before turning live SMS on.
4. If starting fresh, the app creates tables automatically at startup.

## Phase 4: Add Environment Variables

Use `HANDOFF_ENV_TEMPLATE.env` as the checklist.

Keep `DRY_RUN=true` first.

Only set `DRY_RUN=false` after the validation plan passes.

## Phase 5: Slack Setup

1. Create Slack app.
2. Add bot token scopes needed to post messages, usually `chat:write`.
3. Install app to workspace.
4. Add bot to private channels.
5. Copy channel IDs into env vars:
   - `SLACK_ESCALATION_CHANNEL`
   - `SLACK_LEADS_CHANNEL`
   - `SLACK_BOT_ERRORS_CHANNEL`
   - `SLACK_BOOKING_CHANNEL`
6. Test from `/integrations`.

## Phase 6: GoHighLevel Setup

1. Create or obtain private integration token.
2. Add `GHL_API_TOKEN`, `GHL_LOCATION_ID`, and `GHL_CALENDAR_ID`.
3. Create all workflows in `GHL_WORKFLOWS_AND_WEBHOOKS.md`.
4. Include `webhookSecret` or `x-webhook-secret` with every webhook.
5. Test each webhook one by one.

## Phase 7: OpenAI Setup

1. Create OpenAI API key.
2. Add `OPENAI_API_KEY`.
3. Use `gpt-5-mini` unless you intentionally choose another model.
4. Keep LLM fallback and decision gate enabled for risky actions:

```text
LLM_FALLBACK_ENABLED=true
LLM_DECISION_GATE_ENABLED=true
LLM_DECISION_GATE_MODEL=gpt-5-mini
```

## Phase 8: Local/Hosted Validation

1. Visit `/health`.
2. Visit `/integrations`.
3. Visit `/tester`.
4. Visit `/dashboard`.
5. Run the validation plan in `VALIDATION_TEST_PLAN.md`.

## Phase 9: Go Live

1. Confirm only one bot service is connected live to the same GHL account.
2. Set `DRY_RUN=false`.
3. Trigger a real test contact only.
4. Watch Slack and dashboard.
5. Start with a small batch before any bulk NR activation.

