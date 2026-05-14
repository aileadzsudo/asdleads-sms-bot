# Implementation Manifest

This file explains what has been built so another developer can understand the system quickly.

## Core Runtime

- Runtime: Node.js 20+.
- Server entry: `src/server.js`.
- Start command: `npm start`.
- Build command: `npm run build`.
- Tests: `npm test`.
- Production storage: Postgres through `src/postgresStore.js`.
- Local/dev storage: JSON store through `src/store.js` when `DATABASE_URL` is not set.

## Data Model

Production Postgres creates these tables automatically:

- `contacts`: full bot memory per GHL contact.
- `jobs`: scheduled outbound messages, reminders, re-engagement jobs, no-show jobs, watchdogs.
- `messages`: inbound, outbound, and human outbound messages.
- `escalations`: human escalation records and notification events.
- `decision_logs`: explanation of why the bot sent, skipped, paused, escalated, booked, or repaired.
- `webhook_events`: idempotency/dedupe for webhook events.
- `settings`: operational logs such as webhook diagnostics and integration checks.

Most detailed state lives inside JSONB `data` columns so new fields can be added without manual migrations.

## Contact State Stored

Important contact fields include:

- `id`, `ghlContactId`, `name`, `phone`
- `timezone`, `timezoneSource`
- `leadSource`
- `engagementStatus`
- `qualificationProgress`
- `accidentDate`
- `faultAnswer`
- `medicalTreatmentAnswer`
- `preferredCallTime`, `preferredCallTimeIso`
- `backupCallTime`, `backupCallTimeIso`
- `appointmentId`, `appointmentType`, `appointmentTitle`
- `lastInboundMessage`, `lastOutboundMessage`
- `lastResponseTimestamp`, `lastOutboundTimestamp`
- `optOutStatus`
- `humanEscalationStatus`, `humanEscalationStage`
- `automationPaused`, `automationPauseReason`
- `currentSequenceName`, `currentSequenceDay`, `currentSequenceSlot`
- `noShowCount`, `repeatNoShow`, `previousAppointmentMissed`
- `lastLlmGateDecision`, `lastLlmGateReason`, and related LLM fields

## Main Bot Flows

### NR / No-Response Enrollment

Trigger:

- GHL no-response disposition.
- GHL `NR` tag.

Behavior:

- Checks terminal/pause tags.
- Sends Day 1 initial cold SMS immediately for fresh NR.
- Queues same-day aggressive follow-up and long-term cold outreach.
- Does not resend the initial cold SMS if the lead is already enrolled.

### Cold Outreach

Used when the lead has not replied yet.

- Day 1 fresh leads can receive aggressive same-day messages if legally allowed.
- Long-term cold cadence continues up to 21 days.
- PM slot is 6 PM local time.
- Stop conditions: reply, opt-out, signed, NQ, manual hold, DND/SMS block, appointment, human escalation.

### Inbound SMS Router

Trigger:

- `/webhooks/ghl/inbound-sms`

Behavior:

- Buffers quick consecutive messages.
- Checks STOP/opt-out first.
- Checks signed/NQ/manual hold.
- Detects lead-requested pause messages like "not a good time, I'll text when free, don't blow up my phone."
- Resumes from qualification memory instead of restarting.
- Uses deterministic parsers first.
- Uses LLM fallback/gate only where needed.

### Lead-Requested Pause

Messages like "not a good time" plus "I'll text when I'm free" or "don't blow up my phone" do this:

- Send one polite acknowledgement.
- Cancel pending bot jobs.
- Create a human-visible escalation/Slack alert.
- Do not mark opt-out.
- Resume only when the lead texts back again.

### Qualification Memory

Current simplified flow:

- Accident date can be captured from cold replies.
- Fault.
- Medical treatment.
- Call timing.

The bot should not ask for a field that was already answered.

### Warm Follow-Up / Re-Engagement

Used when someone started replying but stops mid-flow.

- Warm follow-up is faster than cold outreach.
- If still no response, the bot enters a question-specific re-engagement sequence.
- Progress is not reset.

### Booking

The bot books through the GHL calendar when it has a safe call time.

High-risk booking/reschedule/confirmation actions go through the LLM decision gate where enabled.

Appointment types:

- `initial`: bot-created first specialist call.
- `qualified_follow_up`: human-created follow-up after intake looks qualified.
- `contract_review`: human-created agreement/contract review call.

### Appointment Reminders

Reminder jobs are built from `preferredCallTimeIso`.

- Future-day appointments: morning, 1-hour, 5-minute reminders when timing allows.
- Same-day appointments: 1-hour and 5-minute reminders when timing allows.
- Very near appointments may only receive the 5-minute reminder.
- Appointment sync/update cancels stale reminders and rebuilds current reminders.

### No-Show Recovery

Trigger:

- GHL no-show webhook or dashboard/admin mark-no-show.

Behavior:

- Sets `engagementStatus=missed_call`.
- Cancels normal appointment reminders.
- Uses backup time flow if backup exists and is still upcoming.
- Otherwise starts no-show recovery follow-up.
- Rebooked no-shows are tagged/stored as no-show rebooks.
- Third no-show escalates to human.

### Human Escalation

Escalation pauses the bot and alerts Slack.

The bot can notify on new inbound replies while still paused so humans see additional PC responses.

Some soft escalations can auto-return after timeout if safe, but hard human work states remain paused.

### Human Manual Text / Human Call Activity

These require GHL webhooks.

- Human outbound SMS tells the bot a human took over.
- Human call activity pauses the bot.
- Short/unknown-duration calls require an outcome tag.
- Missing call outcome creates a dashboard/Slack alert.

### Call Outcome Tags

Team-facing tags/actions:

- `call_no_answer`
- `call_drop`
- `call_connected_follow_up`
- `return_to_bot`
- `NQ`
- `contract_sent`, `contract`, `contract_set`
- `signed`, `contract_signed`
- `follow_up`, `QR`, `human_hold`

## Safety Stops

Hard stops:

- STOP / opt-out language.
- `signed` / `contract_signed`.
- `NQ`.
- GHL unsubscribed/DND/SMS blocked.
- Duplicate terminal same-phone contacts.

Manual pause/hold:

- `follow_up`
- `QR`
- `human_hold`
- `call_connected_follow_up`
- `admin_pause`

Contract pending:

- `contract_sent`, `contract`, `contract_set` stop intake/cold outreach but still allow appointment reminders and no-show recovery.

## Slack Channels

Expected Slack channels:

- SMS escalation channel: general human escalation.
- Leads channel: urgent "call now" alerts.
- Booking channel: appointments, no-shows, rebooks.
- Bot errors channel: true system failures only.

Expected non-urgent items should go to dashboard, not Slack:

- DND/SMS blocked.
- Skipped jobs.
- Operational warnings where no human action is needed immediately.

## Admin UI

Main dashboard is under:

- `/dashboard`

Utility pages:

- `/tester`
- `/backfill`
- `/integrations`
- `/training-status`
- `/review`
- `/dashboard-legacy`

Important dashboard concepts:

- Command center.
- Conversations/contact drilldown.
- Issues/stuck states.
- Appointments.
- Performance.
- Templates/A-B testing.
- Pause audit.
- Lifecycle map.

