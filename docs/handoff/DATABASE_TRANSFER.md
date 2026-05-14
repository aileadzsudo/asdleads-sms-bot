# Database Transfer Guide

This bot uses Postgres in production.

The database contains private lead/contact/SMS data. Treat it as sensitive.

## What Is In The Database

Tables:

- `contacts`
- `jobs`
- `messages`
- `escalations`
- `decision_logs`
- `webhook_events`
- `settings`

The `contacts` and `messages` tables can contain personal, medical, legal, and insurance information.

## Option A: Start With Empty Database

Best for a new operator.

Steps:

1. Create new Postgres database.
2. Set `DATABASE_URL`.
3. Start app.
4. App creates tables automatically.
5. Configure GHL workflows.
6. Start live traffic after testing.

No historical contacts/messages are transferred.

## Option B: Clone Full Database

Use only if the recipient is allowed to receive all historical data.

### Export

Run from a trusted machine with Postgres tools installed:

```bash
mkdir -p private-handoff
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "private-handoff/asdleads_sms_bot_$(date +%Y-%m-%d).dump"
```

Encrypt before sending:

```bash
gpg -c --cipher-algo AES256 "private-handoff/asdleads_sms_bot_$(date +%Y-%m-%d).dump"
```

Send the `.gpg` file separately from the password.

Do not commit database dumps.

### Restore

On the recipient environment:

```bash
gpg -o private-handoff/asdleads_sms_bot.dump -d private-handoff/asdleads_sms_bot_YYYY-MM-DD.dump.gpg
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --dbname "$NEW_DATABASE_URL" \
  private-handoff/asdleads_sms_bot.dump
```

Then start the app and check:

```text
GET /health
GET /dashboard
```

## Option C: Clone Only Bot Logic, Not Contacts

Recommended if the second operator has their own GHL leads.

Steps:

1. Do not restore old contacts/messages/jobs.
2. Deploy code.
3. Configure new GHL location and calendar.
4. Start with fresh NR enrollment.

## Important Cutover Warning

Never have two live services sending SMS for the same GHL location/contact list.

Safe migration:

1. Old bot stays live.
2. New bot is deployed with `DRY_RUN=true`.
3. New bot webhooks tested on test contact only.
4. Old bot webhooks disabled.
5. New bot `DRY_RUN=false`.
6. GHL workflows switched to new URL.

## Jobs Table Warning

The `jobs` table contains pending scheduled messages.

If cloning a database for another operator, decide whether pending jobs should come over:

- If they are cloning the same live operation, keep jobs.
- If they are starting a new operation, clear pending jobs before live use.

Clear jobs only if you are sure:

```sql
update jobs
set status = 'cancelled',
    data = data || '{"cancelReason":"handoff reset"}'::jsonb,
    updated_at = now()
where status = 'pending';
```

## Training Database

Historical training import may also exist locally:

```text
data/training.sqlite
```

This is not the production bot memory. Transfer it only if they need the review/training examples.

It may also contain private SMS text, so treat it as sensitive.

