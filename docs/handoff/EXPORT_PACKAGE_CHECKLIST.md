# Export Package Checklist

Use this when preparing a complete handoff.

## Files/Folders To Include

Include:

- Full repo or private fork.
- `docs/handoff/`
- `README.md`
- `RENDER_DEPLOY_GUIDE.md`
- `GO_LIVE_GUIDE.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/call-disposition-guide.md`
- `docs/team-guide.md`
- `docs/bot-logic-audit.md`
- `docs/lead-lifecycle-map.md`
- `render.yaml`
- `.env.example`

Do not include:

- `.env`
- `data/`
- `reports/` if reports contain private info
- database dumps unless encrypted and approved
- screenshots with private keys/tokens

## Suggested Private Handoff Folder

Create this outside the repo:

```text
private-handoff/
  database/
  secrets/
  screenshots/
  ghl-workflow-notes/
```

Keep `private-handoff/` out of Git.

## Suggested Public/Safe Handoff Folder

This repo folder is safe to commit:

```text
docs/handoff/
```

It should contain instructions and templates only.

## What To Tell The Recipient

Tell them:

1. Start with `docs/handoff/README.md`.
2. Use `RECIPIENT_SETUP_CHECKLIST.md`.
3. Use `HANDOFF_ENV_TEMPLATE.env` for variables.
4. Configure GHL workflows exactly from `GHL_WORKFLOWS_AND_WEBHOOKS.md`.
5. Do not go live until `VALIDATION_TEST_PLAN.md` passes.

