# Owner Export Checklist

Use this checklist before handing the system to another operator or developer.

## 1. Decide What You Are Giving Them

Choose one:

- **Code only:** they get the bot logic and build their own database.
- **Code plus empty database:** best for a new operator.
- **Code plus cloned database:** only if they are legally allowed to receive the historical contacts/messages.
- **Code plus GHL workflow instructions:** usually required.
- **Full managed setup:** you deploy and operate it for them.

## 2. Protect Private Data

The database can contain:

- Names.
- Phone numbers.
- Emails.
- SMS conversations.
- Injury details.
- Legal/insurance context.
- Appointment history.
- Internal notes and decision logs.

Do not share a raw database unless you have permission and compliance approval.

If the recipient does not need historical data, give them an empty database.

## 3. Things To Export

Give them:

- Repo access or a private fork.
- This `docs/handoff/` folder.
- A sanitized env template, not your real `.env`.
- GoHighLevel workflow setup instructions.
- Slack channel setup instructions.
- Appointment title/tag guide from `docs/call-disposition-guide.md`.
- A database dump only if approved.
- A separate secrets package through a password manager.

Do not give them:

- Your live `.env`.
- Your live database URL in chat.
- Your OpenAI key in a document.
- Your Slack bot token in a document.
- Your GHL API token in a document.
- Your Render admin password in a document.

## 4. Secrets They Need To Provide Or Receive Securely

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `WEBHOOK_SECRET`
- `GHL_API_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_CALENDAR_ID`
- `SLACK_BOT_TOKEN`
- `SLACK_ESCALATION_CHANNEL`
- `SLACK_LEADS_CHANNEL`
- `SLACK_BOT_ERRORS_CHANNEL`
- `SLACK_BOOKING_CHANNEL`
- `OPENAI_API_KEY`

## 5. GoHighLevel Items To Collect

From their GHL:

- Location/sub-account ID.
- Calendar ID.
- Private integration token or OAuth app installation.
- List of tags they use for states/firms.
- Timezone/state tag naming convention.
- Existing NR/no-response workflow location.
- Appointment workflow access.
- Ability to create webhooks in workflows.
- Ability to install Marketplace app/webhook for outbound message events if they need human manual text detection.

## 6. Slack Items To Collect

From their Slack:

- Workspace.
- Slack app bot token.
- Channel IDs for escalation, leads, booking, bot errors.
- Confirmation that bot was added to private channels.

## 7. Deployment Items To Collect

From Render/Railway/VPS:

- Public HTTPS app URL.
- Postgres connection string.
- Logs access.
- Environment variable access.
- Auto-deploy preference.
- Uptime monitor.

## 8. Handoff Safety Before They Go Live

Ask them to prove:

- `/health` is green.
- `/integrations` shows GHL, Slack, OpenAI, and calendar checks passing.
- GHL ping webhook lands in `/webhooks/ghl/ping-status`.
- Inbound SMS test is received.
- NR enrollment test sends exactly one first message.
- Appointment sync creates reminders.
- No-show webhook creates no-show jobs.
- STOP cancels everything.
- NQ/signed/follow-up/human_hold tags stop or pause as expected.

