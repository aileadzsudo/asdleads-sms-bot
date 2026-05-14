# Validation Test Plan

Run this before switching `DRY_RUN=false`.

## 1. Local Code Checks

```bash
npm ci
npm test
npm run build
```

Expected:

- All tests pass.
- Dashboard build succeeds.

## 2. Health Check

Open:

```text
https://YOUR-APP/health
```

Expected:

- `ok: true`
- storage type is `postgres`
- no database errors

## 3. Integration Page

Open:

```text
https://YOUR-APP/integrations
```

Expected:

- GHL read access works.
- Slack token valid.
- Calendar configured.
- OpenAI configured.
- Dry run status is clear.

## 4. GHL Ping Test

Trigger `/webhooks/ghl/ping`.

Then open:

```text
https://YOUR-APP/webhooks/ghl/ping-status
```

Expected:

- `authorized: true`
- contact id present
- payload keys visible

## 5. NR Enrollment Test

Use a test GHL contact.

Trigger NR/no-response workflow.

Expected:

- Contact appears in dashboard.
- One initial SMS is sent or queued.
- No duplicate initial SMS.
- Cold outreach jobs exist.

## 6. Inbound Reply Test

Reply as the PC:

```text
May 10th
```

Expected:

- Accident date saved.
- Bot asks next needed qualification question.

Reply:

```text
The other driver
```

Expected:

- Fault saved as not at fault.
- Bot asks medical question.

Reply:

```text
Yes I went to the hospital
```

Expected:

- Medical saved.
- Bot asks for call timing.

## 7. Call Now Test

Reply:

```text
Call me now
```

Expected:

- Urgent Slack alert goes to leads channel.
- Bot does not keep asking qualification questions.
- Human team calls.

## 8. Exact Booking Test

Reply:

```text
Tomorrow at 3pm
```

Expected:

- GHL appointment created.
- Booking Slack notice sent.
- Reminder jobs scheduled.
- Timezone looks correct.

## 9. Manual Appointment Sync Test

Human creates appointment in GHL.

Expected:

- `/webhooks/ghl/appointment-sync` processes it.
- Contact becomes `call_scheduled`.
- Reminders are scheduled.
- Booking Slack notice sent once.

## 10. No-Show Test

Mark test appointment no-show in GHL.

Expected:

- `/webhooks/asd/no-show` receives the event.
- Contact becomes `missed_call`.
- Old reminders are cancelled.
- No-show follow-up jobs are scheduled.
- Dashboard no-show log shows `jobs_scheduled` or `backup_flow_started`.

## 11. Human Manual Text Test

Human sends an SMS manually from GHL.

Expected:

- `/webhooks/asd/human-outbound` receives the event.
- Message is stored as `human_outbound`.
- Bot pauses and schedules human reply timeout.
- If the human text contains a call time in a scheduling state, bot can assist booking.

## 12. Human Call Activity Test

Human places short outbound call.

Expected:

- `/webhooks/ghl/human-active` receives it.
- Bot pauses.
- Call outcome watchdog is scheduled.
- If no outcome tag is added, dashboard/Slack shows no call disposition recorded.

## 13. Stop/NQ/Signed Tests

STOP:

- Reply `STOP`.
- Expected: opted out, jobs cancelled, no Slack error for expected GHL unsubscribe block.

NQ:

- Add `NQ`.
- Expected: bot stops, no more follow-up.

Signed:

- Add `signed`.
- Expected: terminal stop, reminders/no-show recovery cancelled.

## 14. Lead-Requested Pause Test

Reply:

```text
Not a good time. I'll text when I'm free. Please don't blow up my phone
```

Expected:

- One polite acknowledgement.
- All pending jobs cancelled.
- Team gets an escalation/alert.
- Bot does not opt them out.
- Bot resumes only when lead texts again.

## 15. Duplicate Safety Test

Create or simulate duplicate same-phone contacts where one is NQ/signed.

Expected:

- Bot does not continue texting the wrong duplicate.
- Dashboard shows duplicate issue if needed.

## Go-Live Gate

Only set `DRY_RUN=false` after all required tests pass.

After go-live:

- Watch Slack for 1 hour.
- Watch dashboard issues.
- Send only a small first batch.
- Do not bulk enroll hundreds of contacts until duplicate and DND behavior looks clean.

