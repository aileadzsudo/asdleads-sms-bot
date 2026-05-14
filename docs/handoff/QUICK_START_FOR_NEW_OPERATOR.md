# Quick Start For A New Operator

This is the shortest possible version.

## What You Need

- A copy/fork of this repo.
- Render account.
- Render Postgres database.
- GHL location ID.
- GHL private integration token.
- GHL calendar ID.
- Slack bot token and channel IDs.
- OpenAI API key.

## Steps

1. Deploy repo on Render.
2. Add Postgres and `DATABASE_URL`.
3. Add every env var from `HANDOFF_ENV_TEMPLATE.env`.
4. Keep `DRY_RUN=true`.
5. Open `/health`.
6. Open `/integrations`.
7. Create GHL ping webhook and confirm `/webhooks/ghl/ping-status`.
8. Create all GHL workflows from `GHL_WORKFLOWS_AND_WEBHOOKS.md`.
9. Test one fake lead through:
   - NR enrollment
   - inbound reply
   - booking
   - reminder
   - no-show
   - human outbound SMS
   - STOP
10. Set `DRY_RUN=false`.
11. Test one real contact owned by your team.
12. Start small batch only.

## If Something Looks Wrong

1. Set `DRY_RUN=true`.
2. Pause GHL workflows.
3. Check `/health`.
4. Check `/integrations`.
5. Check dashboard issue page.
6. Check Render logs.
7. Run `npm test` locally before changing code.

