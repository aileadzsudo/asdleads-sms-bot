# Environment Variables

Never commit real values. Put production values in Render/Railway/VPS environment variables.

## Required App Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `NODE_ENV` | yes | `production` | Production store requires `DATABASE_URL`. |
| `PORT` | platform | `3000` | Render supplies this automatically. |
| `HOST` | yes | `0.0.0.0` | Use `0.0.0.0` in hosted production. |
| `PUBLIC_BASE_URL` | yes | `https://your-app.onrender.com` | Public app URL used in links and webhook docs. |
| `ADMIN_PASSWORD` | yes | secure random string | Protects admin APIs/dashboard. |
| `WEBHOOK_SECRET` | yes | secure random string | Must match GHL webhook custom data/header. |
| `DATABASE_URL` | yes | Postgres URL | Use managed Postgres. Do not share publicly. |
| `DRY_RUN` | yes | `true` then `false` | Start true. Production live SMS requires false. |

## GoHighLevel Variables

| Variable | Required | Notes |
|---|---:|---|
| `GHL_API_TOKEN` | yes | Private integration token or API token with contact, conversation, calendar, notes access. |
| `GHL_LOCATION_ID` | yes | The GHL sub-account/location ID. |
| `GHL_CALENDAR_ID` | yes | Calendar where Specialist calls are booked. |
| `GHL_API_BASE` | yes | Usually `https://services.leadconnectorhq.com`. |
| `GHL_APP_BASE_URL` | optional | Usually `https://app.gohighlevel.com`. |

## Slack Variables

| Variable | Required | Notes |
|---|---:|---|
| `SLACK_BOT_TOKEN` | yes | Bot token beginning with `xoxb-`. |
| `SLACK_ESCALATION_CHANNEL` | yes | SMS/human escalation channel ID or name. |
| `SLACK_LEADS_CHANNEL` | yes | Urgent call-now leads channel ID. |
| `SLACK_BOT_ERRORS_CHANNEL` | yes | True system errors only. |
| `SLACK_BOOKING_CHANNEL` | yes | Booking/no-show/rebook notices. |
| `SLACK_SEND_IN_DRY_RUN` | optional | Usually `false`. |

Use channel IDs for private channels. The Slack bot must be invited into each private channel.

## OpenAI Variables

| Variable | Required | Recommended |
|---|---:|---|
| `OPENAI_API_KEY` | yes if LLM enabled | Use recipient's own key. |
| `OPENAI_CLASSIFIER_MODEL` | yes | `gpt-5-mini` |
| `LLM_FALLBACK_ENABLED` | yes | `true` |
| `LLM_MIN_CONFIDENCE` | optional | `0.85` |
| `LLM_CLARIFY_CONFIDENCE` | optional | `0.60` |
| `LLM_DECISION_GATE_ENABLED` | yes | `true` |
| `LLM_DECISION_GATE_MODEL` | yes | `gpt-5-mini` |
| `LLM_DECISION_GATE_MIN_CONFIDENCE` | optional | `0.82` |

## Texting Window Variables

| Variable | Required | Example |
|---|---:|---|
| `DEFAULT_TIMEZONE` | yes | `America/Chicago` |
| `DEFAULT_TEXTING_START` | yes | `08:00` |
| `DEFAULT_TEXTING_END` | yes | `21:00` |
| `STATE_TEXTING_WINDOWS_JSON` | optional | `{}` |
| `BOT_NAME` | yes | `William` |

`STATE_TEXTING_WINDOWS_JSON` can be used for stricter state rules.

Example:

```json
{"FL":{"start":"08:00","end":"20:00"},"OK":{"start":"08:00","end":"20:00"}}
```

## Training/Batch Variables

Only needed if importing historical SMS for training/audit:

| Variable | Required | Notes |
|---|---:|---|
| `TRAINING_DB_PATH` | optional | Defaults to `data/training.sqlite`. |
| `AUTO_APPLY_LLM_BATCH` | optional | Usually `false`. |
| `BATCH_POLL_INTERVAL_MS` | optional | Batch polling interval. |

## Secret Rotation Rule

When handing this system to another party:

1. Create new keys for them.
2. Do not give your existing keys.
3. If you accidentally shared a key in chat/email, rotate it immediately.

