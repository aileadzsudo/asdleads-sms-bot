# Accident Support Desk Bot Logic Audit

Last updated: May 9, 2026

Purpose: this is the blunt internal source-of-truth for the Accident Support Desk SMS bot. It explains what the bot does, why it does it, where it can fail, what has already failed live, and what must be tested before the bot is trusted at larger volume.

This document is intentionally operational, not polished. The point is to find gaps before leads are lost.

Sources used:

- `src/flow.js`
- `src/classifier.js`
- `src/templates.js`
- `src/server.js`
- `src/time.js`
- `src/timezoneResolver.js`
- `src/adapters/ghl.js`
- `src/adapters/slack.js`
- `test/flow.test.js`
- `docs/lead-lifecycle-map.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `reports/production-audit-current.json`
- `reports/production-audit-2026-05-09.json`
- Live issue history from this build thread

## 1. Executive Summary

The bot is a memory-based intake assistant. It is not just a drip campaign.

It tracks:

- Whether the lead is cold, active, scheduled, paused, escalated, opted out, or human-owned.
- What qualification question is still unanswered.
- What jobs are pending.
- What tags should stop or pause automation.
- What the last inbound and outbound messages were.
- What calendar appointment and backup time are attached to the contact.
- Whether a human or the bot currently owns the contact.

The highest-risk areas are:

1. Message interpretation when the lead gives context plus a time.
2. Stop tags and human-owned tags not being honored.
3. Timezone source being wrong or stale.
4. Appointment booking before the lead gives an exact intended call time.
5. Human handoff not pausing the bot consistently.
6. Slack becoming too noisy to notice urgent issues.
7. Old NR backfill leads entering the wrong stage.
8. Duplicate GHL contacts with the same phone number.
9. Manual GHL actions not syncing back to the bot.
10. Dashboard not clearly explaining why the bot acted or stayed silent.

## 2. Current Lead Lifecycle

1. Lead enters GHL.
2. Team or system calls the lead twice.
3. If both calls are unanswered, GHL sends an NR/no-response webhook or tag event.
4. Bot normalizes the payload and stores/updates the contact.
5. Bot hydrates current GHL tags when possible.
6. Bot checks safety stops: STOP, DNC, NQ, signed, contract, follow up, missed follow up, QR, human hold, manual hold, DND/send block, and duplicate-phone conditions.
7. If safe and inside texting window, bot sends Day 1 AM cold outreach immediately.
8. If outside texting window, bot queues the first message for the next legal window.
9. Bot schedules cold outreach for 21 days.
10. Fresh leads also get same-day follow-ups at 15 and 60 minutes.
11. When the lead replies, the inbound is buffered for 30 seconds so rapid messages can be read together.
12. Bot cancels cold/fresh/warm/re-engagement jobs that no longer apply.
13. Bot checks opt-out, tags, manual hold, signed/contract/follow-up status, and current bot state.
14. Bot saves accident date if the reply answers accident timing.
15. Bot asks the next missing qualification question.
16. Bot asks for call time after fault and medical are captured, or earlier if the lead gives clear call intent.
17. Exact call time creates a GHL appointment.
18. Bot asks for backup time.
19. Bot schedules appointment reminders.
20. If the lead no-shows, no-show recovery starts.
21. If the bot cannot safely classify the message, it escalates to human.
22. Human can pause, acknowledge, call, text, return to bot, or tag the lead terminal.

## 3. State Model

Engagement status answers: what is happening right now?

- `new_lead`: lead exists but not yet processed.
- `called_no_answer`: lead was called and did not answer.
- `initial_sms_sent`: first no-response SMS was sent.
- `cold_outreach`: lead has not responded and is in cold sequence.
- `active_conversation`: lead is replying or recently replied.
- `warm_follow_up`: lead stopped after an active question.
- `re_engagement`: lead went cold after partial qualification.
- `ready_for_call`: lead wants a call now.
- `call_scheduled`: GHL appointment exists.
- `missed_call`: call/no-show recovery is active.
- `escalated_to_human`: human should own the lead.
- `opted_out`: no more automation.

Qualification progress answers: what information is missing?

- `needs_fault_answer`: bot still needs fault answer. Accident date may be saved separately.
- `needs_medical_answer`: bot has fault and needs medical.
- `needs_call_time`: bot has enough to ask for scheduling.
- `call_booked`: appointment is booked.
- `complete`: bot flow is done or should not continue.

Important rule: engagement can go cold without resetting qualification. If the lead answered fault, then disappears, the bot must resume at medical, not ask fault again.

## 4. Entry Points And Webhooks

- `/webhooks/ghl/disposition`: starts NR flow from no-response disposition.
- `/webhooks/ghl/tag`: starts or controls bot based on tags.
- `/webhooks/ghl/nr-tag`: starts NR flow from NR tag.
- `/webhooks/ghl/inbound-sms`: buffers inbound SMS and routes it.
- `/webhooks/ghl/missed-call`: missed call follow-up.
- `/webhooks/ghl/no-show`: no-show recovery.
- `/webhooks/ghl/appointment-no-show`: no-show recovery alias.
- `/webhooks/ghl/bot-control`: pause, return, NQ, signed, refresh timezone, no-show, call started.
- `/webhooks/ghl/human-outbound`: human sent SMS, bot pauses.
- `/webhooks/ghl/human-active`: human call started, bot pauses.
- `/jobs/tick`: scheduled job runner.

## 5. Stop And Pause Rules

Absolute no-more-bot conditions:

- Lead says STOP, unsubscribe, wrong number, remove me, do not text me, leave me alone, or similar.
- GHL says contact is unsubscribed or DND blocks SMS.
- Contact has `NQ` or equivalent not-qualified tag.
- Contact has `signed`, `contract`, `contract set`, `contract_sent`, or `contract_signed`.
- Contact has `QR`, `human_hold`, `manual_hold`, `manual_follow_up`, `follow up`, or `missed follow up`.
- Contact is already completed and later message is post-intake or firm-support.

Expected behavior:

- Cancel all relevant pending jobs.
- Do not send another automated message unless it is a legally allowed opt-out confirmation and GHL permits it.
- Do not alert Slack for expected DND/unsubscribed send blocks.
- Show blocked/skipped state in dashboard.

## 6. Qualification Logic

Accident date:

- Saved if lead says `yesterday`, `last Saturday`, `May 7`, `1/26/2026`, `last week`, etc.
- Accident date alone does not answer fault.
- If the initial cold message asks accident date and the lead answers with accident date, the next message should ask fault.

Fault:

- Valid: other driver, their fault, not my fault, they hit me, rear-ended me, parked, my fault, partially, both at fault, not sure.
- Invalid: who is this, call me, how much, do I need a lawyer, insurance questions, document uploads.

Medical:

- Valid yes: doctor, hospital, ER, urgent care, chiro, therapy, treatment, MRI, X-ray, pain management.
- Valid no: no, not yet, did not go, no doctor, no treatment, have not seen anyone.
- Injury context should not block scheduling. If lead says injuries after medical ask, it may count as medical yes.

Call time:

- Exact time can book only when the message is clearly about a call.
- Vague time must ask for exact time.
- Relative time like `in an hour` must ask for exact target or options.
- Accident timing cannot become call timing.

## 7. Call Booking Rules

Call now:

- Send call-now message.
- Mark `ready_for_call`.
- Alert Slack urgent call now.
- Pause automation.
- Human team calls immediately.

Exact call time:

- Parse in contact timezone.
- Create GHL calendar appointment.
- Ask for backup time.
- Send booking Slack notification.
- Schedule reminders.
- Set `call_scheduled` and `call_booked`.

Vague call time:

- `later`, `tomorrow afternoon`, `in an hour`, `morning`, `after work`, `anytime today` should not book.
- Ask a specific follow-up question.
- Schedule warm follow-ups because this is a hot lead.

Backup time:

- Exact backup time is stored in contact state and appointment notes.
- Backup time window such as `2-4pm` is saved as a window in notes.
- The bot does not create a second tentative appointment right now.
- If no backup response after 15 minutes, confirm primary only and keep reminders.

## 8. Reminder And No-Show Logic

Same-day appointment:

- If enough time remains, schedule 1-hour and 5-minute reminders.
- If appointment is too soon, only schedule reminders that are still useful and not in the past.

Future-day appointment:

- Morning reminder.
- 1-hour reminder.
- 5-minute reminder.

No-show:

- If GHL no-show webhook fires, cancel old appointment reminders.
- If backup time is upcoming, send backup no-show reminder flow.
- If no backup exists, send no-show same-day recovery messages at 10, 45, 120, 240, and 360 minutes when allowed.
- Continue no-show recovery days 2-7 AM/PM.

## 9. Human Escalation Logic

Escalate when:

- Lead asks for a human, attorney, lawyer, specialist, or case manager.
- Lead is angry, upset, confused, concerned, or asks who this is.
- Lead asks legal, medical, insurance, settlement, property damage, or compensation questions.
- Lead gives detailed legal/medical/insurance facts outside the current question.
- Lead mentions signed-client support, firm issues, DocuSign, photos, reports, documents, license, insurance card.
- Bot or LLM cannot classify with enough confidence.
- Appointment booking fails.
- Duplicate phone conflict cannot be safely resolved.

Slack escalation should be compact:

- Name
- Message
- GHL contact link

Slack should not receive:

- DND noise
- Expected opt-out send block
- Repeated duplicate escalation for the same unresolved issue
- Operational skipped jobs
- Long unknown fields like `Fault: unknown`

## 10. Human Handoff And Return-To-Bot

If human sends SMS:

- Bot pauses.
- Bot records human outbound.
- If lead goes quiet, bot may return after 5 minutes unless protected by tags, appointment state, or human hold.

If human starts call:

- Bot pauses for 30 minutes.
- It should not text while the team is on the call.

If lead replies while human is working:

- If reply is scheduling intent, bot may assist scheduling.
- If reply is a human-managed issue, bot stays quiet and records the inbound.

Return-to-bot:

- Can happen from dashboard or `return_to_bot` tag.
- Bot resumes from saved qualification progress.
- It must not start over.

## 11. Quiet Hours

Default automated texting window:

- 8:00 AM to 9:00 PM contact local time.

Inbound exception:

- If lead texts first after-hours, bot can reply because the lead initiated.
- If lead stops replying after-hours, bot can send one follow-up, then wait for next texting window.

Timezone source must be visible:

- Firm tag
- Owner/state
- Contact state
- Message correction
- Default

## 12. LLM Fallback Rules

LLM is used only when hard-coded parsing cannot confidently classify.

LLM should classify, not freestyle:

- accident date
- fault
- medical
- call now
- call later
- opt-out
- human request
- needs escalation
- acknowledgement
- unknown

Important current fix:

- At call-time stage, `call_now` or `call_later` with reasonable confidence should not be downgraded to generic yes/no clarification.

If LLM fails:

- Escalate to human.
- Log operational issue.
- Do not spam Slack repeatedly.

## 13. Dashboard Requirements

The dashboard must answer three questions:

1. What is happening now?
2. Why did the bot do or not do something?
3. What should the team do next?

Every contact should show:

- Current engagement status
- Current qualification progress
- Last inbound and outbound
- Pending jobs
- Failed/skipped jobs
- Stop tags and pause reason
- Timezone and timezone source
- Appointment and backup time
- Reminder jobs
- Human escalation status
- Decision log
- Recommended action

Dashboard must include:

- Command center
- Conversations
- Issues/stuck states
- Appointments
- Templates and A/B testing
- Performance
- Lead lifecycle map
- Backfill control
- Integration checks

## 14. Known Live Failure Log

These are real issues from the build. They should stay in this doc until the logic and tests prove they cannot repeat.

1. Terrill Grany
   - Lead said: `William the accident happened last Saturday around 3pm`.
   - Bot mistake: booked a call for 3:00 PM instead of saving accident date and asking fault.
   - Root cause: parser saw `3pm` before checking accident timing context.
   - Fix added: accident/wreck/crash timing cannot become call time unless call intent is present.
   - Required test: accident date sentence with time is not booked as call.

2. Craig Hollowell
   - GHL tags: `contract`, `follow up`, `missed follow up`.
   - Bot mistake: sent messages even though contact should be human-owned.
   - Root cause: stop rule only recognized `signed` and `contract_set`, not plain `contract` or follow-up tags.
   - Fix added: `contract`, contract variants, `follow up`, and `missed follow up` pause automation.
   - Required test: contract/follow-up tags prevent outreach and queued sends.

3. Craig Hollowell call-time reply
   - Lead replied `Yes` after call ask.
   - LLM classified `call_now` but confidence was below strict threshold.
   - Bot mistake: sent yes/no/not sure clarification.
   - Root cause: generic confidence threshold overrode call-stage context.
   - Fix added: call-stage `call_now` and `call_later` are accepted at clarify threshold.

4. Chiquita Benard
   - Cold lead replied `Ok`.
   - Bot mistake: moved into fault warm-follow-up spam instead of asking accident date again.
   - Root cause: acknowledgement path repeated current qualification question instead of honoring cold date need.
   - Fix added: cold acknowledgement asks for accident date.

5. Sritha Srinivasan
   - Slack sent repeated escalation messages for the same person/message.
   - Bot mistake: duplicate Slack spam.
   - Root cause: stuck-state healer reprocessed already-escalated contact.
   - Fix added: suppress duplicate human escalation unless state changes.

6. Pedro Avalos
   - Lead gave accident date plus details.
   - Bot mistake: originally escalated or mishandled detailed answer.
   - Root cause: detailed info was treated as outside flow even though it answered current question.
   - Fix added: if detailed answer includes the current expected answer, advance instead of escalating.

7. Pedro Avalos timezone / booking
   - Lead had PST context but bot produced wrong EST/CST style booking.
   - Root cause: timezone source and tag mapping were not enforced consistently enough.
   - Required gap: every booking/reminder must show timezone source and use firm tag mapping before parsing.

8. Behnaz Alisalehi
   - Lead gave medical/injury context and later availability.
   - Bot failed to naturally ask for exact time at first.
   - Root cause: call-time and medical context were competing.
   - Required gap: if in scheduling stage and lead says `later`, `sick`, `surgery`, or availability context, ask specific call time with empathetic copy.

9. Leslie Hernandez
   - Appointment/reminder/no-show behavior was unclear.
   - Root cause: manual GHL no-show and reminder reconciliation were not visible enough.
   - Required gap: appointment sync and no-show dashboard controls must show backup and reminder state.

10. Yohana Nasif
   - Lead gave medical/no medical and then injury context.
   - Bot escalated or followed too aggressively in earlier flow.
   - Root cause: rapid messages and context were not buffered and reinterpreted together.
   - Required gap: maintain 30-second inbound buffer and make decision log show combined message.

11. Francisco Gonzalez
   - Backup time window was saved incorrectly as duplicate primary time.
   - Root cause: range parsing treated start as exact backup.
   - Fix/gap: backup windows must stay windows in notes and not duplicate primary time.

12. George Maddox
   - Lead said wreck was in Colorado and later was in Texas, plus tomorrow late afternoon.
   - Bot booked without exact time.
   - Root cause: vague daypart was interpreted too strongly.
   - Required gap: never book `late afternoon` without exact time.

13. Eric Johnson
   - Lead gave relative timing like `in an hour`.
   - Bot booked at top of hour rather than clarifying exact time.
   - Required gap: relative times must ask for exact option unless explicitly confirmed.

14. Adam Orr
   - Lead said available anytime after 2:30 PM / in about 40 minutes.
   - Bot sent call-now message.
   - Root cause: future availability phrasing contained urgency/time words.
   - Required gap: future availability must win over call-now keywords.

15. McKinley Kekona
   - Fresh NR lead got fault questions instead of cold accident date flow.
   - Root cause: stale qualification memory or wrong enrollment state.
   - Required gap: new NR always starts with cold script unless already actively qualified.

16. Regina Myles
   - Follow-up tag blocked bot from messaging.
   - Business decision changed: follow-up tag should stop bot.
   - Current rule: follow-up tag is manual hold.

17. David Dadey
   - Bot did not re-engage after no response.
   - Required gap: stuck-state scanner must flag active conversations with no warm jobs.

18. Chiquita Benard repeated messages
   - Bot sent multiple fault-question warm messages to a cold lead.
   - Root cause: cold acknowledgement was treated as active qualification.
   - Fix added: cold ack needs accident date.

19. Nadia Alfaro
   - NR tag did not send initial message.
   - Root cause: webhook dedupe/tag lookup failure path could prevent send.
   - Fix added: fresh NR queues retry if initial SMS cannot safely send.

20. Brianna Sendra
   - Lead said STOP, GHL blocked opt-out confirmation, Slack got error.
   - Root cause: expected GHL unsubscribe block was treated as bot error.
   - Fix added: permanent SMS block is dashboard/skipped, not Slack error.

## 15. Do Not Let This Happen Again Checklist

- Accident time cannot become appointment time.
- `contract`, `signed`, `NQ`, `QR`, `follow up`, `missed follow up`, and human-hold tags cannot receive automated bot messages.
- A cold acknowledgement cannot start warm qualification spam.
- One unresolved Slack escalation per person/message unless state changes.
- Call-time `yes` after call ask cannot trigger yes/no/not sure clarification.
- Vague call times cannot create appointments.
- Time windows cannot be saved as duplicate exact backup times.
- Contact timezone source must be visible before booking.
- GHL DND/unsubscribed blocks cannot spam Slack.
- Manual human SMS or call must pause bot.
- Bot must not text while human is actively on a call.
- No-show recovery must not restart qualification.
- Appointment reminders must be reconciled after reschedule.
- Old NR backfill must start with cold outreach, not qualification.
- Duplicate phones must route only to one active bot thread or pause for human review.
- LLM failure must escalate once, not repeatedly.
- Stale tag lookup must defer sends, not send blindly.
- Dashboard must show why a contact is silent.
- Dashboard must allow safe repair of bad appointment state.
- Every new bug gets a regression test.

## 16. Logic Gap Register

GAP-001: NR enrollment must prove lead was intentionally enrolled.
- Current: NR disposition/tag starts flow.
- Expected: only enrolled contacts get bot replies.
- Risk: bot answers random inbound messages.
- Example: new inbound not in bot memory.
- Required: keep ignore behavior and test unknown inbound.
- Priority: P0

GAP-002: NR webhook dedupe must not suppress repeat legitimate NR events.
- Current: improved after duplicate contact-id issue.
- Expected: dedupe by event id only when true event id exists.
- Risk: Nadia Alfaro style no initial SMS.
- Required: monitor `initial_sms_not_sent` retries.
- Priority: P0

GAP-003: Tag lookup failure must defer, not send.
- Current: send is skipped/deferred if tag lookup fails.
- Expected: no blind sends when tags unknown.
- Risk: signed/NQ lead gets text.
- Required: dashboard issue for tag lookup failures.
- Priority: P0

GAP-004: Contract tag must stop bot.
- Current: fixed for `contract` and variants.
- Expected: no bot messages.
- Risk: signed/contracted lead receives sales text.
- Example: Craig Hollowell.
- Required: regression test exists; add dashboard stop-tag display.
- Priority: P0

GAP-005: Follow-up tags must stop bot.
- Current: fixed for `follow up` and `missed follow up`.
- Expected: human-owned.
- Risk: human follow-up lead gets automation.
- Example: Regina Myles/Craig Hollowell class.
- Required: regression test exists.
- Priority: P0

GAP-006: QR/manual hold/human hold must stop auto-return.
- Current: tags block manual timeout return.
- Expected: human-owned until tag removed or explicit return.
- Risk: bot texts a firm-owned lead.
- Required: dashboard surface hold tags.
- Priority: P0

GAP-007: Accident timing must not be parsed as call timing.
- Current: fixed after Terrill.
- Expected: save accident date and ask fault.
- Risk: fake appointments.
- Example: Terrill Grany.
- Required: regression test exists.
- Priority: P0

GAP-008: Vague daypart must never book.
- Current: parse asks specific for dayparts.
- Expected: `tomorrow afternoon` asks exact time.
- Risk: invented appointment.
- Example: George Maddox.
- Required: scenario test for late afternoon.
- Priority: P0

GAP-009: Relative time must be clarified.
- Current: relative hour/minute returns needs_specific_time.
- Expected: ask exact time or offer options.
- Risk: wrong appointment time.
- Example: Eric Johnson.
- Required: scenario test for `in an hour`.
- Priority: P0

GAP-010: Future availability must override call-now words.
- Current: tests exist for future availability.
- Expected: `after 2:30` books/asks backup, not call now.
- Risk: wrong urgent call alert.
- Example: Adam Orr.
- Required: keep test coverage.
- Priority: P0

GAP-011: Call-stage `yes` must use previous outbound context.
- Current: fixed via LLM call-stage threshold.
- Expected: yes after call ask means call now/open now.
- Risk: insulting clarification.
- Example: Craig Hollowell.
- Required: regression test exists.
- Priority: P0

GAP-012: Cold acknowledgement must ask date.
- Current: fixed.
- Expected: `ok` after cold date ask asks date again.
- Risk: warm fault spam.
- Example: Chiquita Benard.
- Required: regression test exists.
- Priority: P0

GAP-013: Cold lead cannot receive multiple warm qualification chases.
- Current: warm job skip for cold ack exists.
- Expected: stay in cold/date path.
- Risk: spamming wrong question.
- Example: Chiquita Benard.
- Required: scanner for cold contact in warm sequence.
- Priority: P0

GAP-014: Detailed answer that answers current question should advance.
- Current: fixed for detailed fault/date.
- Expected: save usable answer.
- Risk: unnecessary escalation.
- Example: Pedro Avalos.
- Required: add examples to training set.
- Priority: P1

GAP-015: Police report info should not block date/fault extraction.
- Current: handled when current answer is extractable.
- Expected: save what is needed, escalate only if still needed.
- Risk: lost hot lead.
- Required: scenario tests.
- Priority: P1

GAP-016: Medical injury context should count as medical yes when appropriate.
- Current: parser catches common medical terms.
- Expected: `I have injuries` after medical/call ask should not get ignored.
- Risk: wrong escalation or repeated question.
- Example: Yohana Nasif.
- Required: add injury context cases.
- Priority: P1

GAP-017: Busy context should not count as yes/no answer.
- Current: humanized busy intent exists.
- Expected: respond naturally and re-ask current question.
- Risk: fake medical/fault answer.
- Required: maintain tests.
- Priority: P1

GAP-018: Existing lawyer should get polite second-opinion stop.
- Current: handled.
- Expected: no human escalation needed for simple representation statement.
- Risk: Slack noise.
- Required: scenario test for `I already have a lawyer`.
- Priority: P1

GAP-019: Documents/photos/reports should escalate.
- Current: document/report detection exists.
- Expected: human handles.
- Risk: bot mishandles legal/medical docs.
- Required: no automated advice.
- Priority: P0

GAP-020: Post-signed client support must escalate or pause.
- Current: firm issue detection exists.
- Expected: no intake bot replies.
- Risk: signed client gets sales flow.
- Required: stronger signed/contract tag sync.
- Priority: P0

GAP-021: Duplicate phone single active match routing must be visible.
- Current: active phone match routing exists.
- Expected: route safely and log.
- Risk: wrong duplicate gets message.
- Required: dashboard duplicate queue.
- Priority: P1

GAP-022: Duplicate phone multiple active matches must pause.
- Current: pause/escalation path exists.
- Expected: human routes.
- Risk: cross-contact privacy issue.
- Required: dashboard issue.
- Priority: P0

GAP-023: Slack escalation dedupe must persist by person/message.
- Current: duplicate escalation suppression exists.
- Expected: one unresolved alert.
- Risk: Slack unusable.
- Example: Sritha Srinivasan.
- Required: dashboard unresolved escalation state.
- Priority: P0

GAP-024: Slack bot-error should be only true failures.
- Current: DND/unsubscribe/tag lookup operational-only reduced.
- Expected: no Slack spam for expected blocks.
- Risk: team ignores real outages.
- Required: error categorization dashboard.
- Priority: P0

GAP-025: Booking Slack should be compact.
- Current: reduced noisy qualification fields.
- Expected: name, time, link, key needed data.
- Risk: booking channel unreadable.
- Required: audit Slack format.
- Priority: P1

GAP-026: Escalation Slack should be compact.
- Current: requested name/message/link.
- Expected: no unknown fields.
- Risk: team misses message.
- Required: snapshot tests for Slack copy.
- Priority: P1

GAP-027: Timezone must be resolved from firm tag first.
- Current: firm tag resolver exists.
- Expected: CA -> Pacific, CO -> Mountain, TX -> Central, etc.
- Risk: wrong appointment time.
- Example: Pedro/Francisco/Behnaz timezone issues.
- Required: timezone audit dashboard.
- Priority: P0

GAP-028: Timezone source must be stored and displayed.
- Current: dashboard has timezoneSource fields in summaries.
- Expected: every booking/reminder shows source.
- Risk: invisible bad assumptions.
- Required: detail rail and decision log.
- Priority: P0

GAP-029: Timezone correction after message must preserve intended wall-clock.
- Current: tests exist.
- Expected: if lead says California, 4 PM stays 4 PM local.
- Risk: reschedule to wrong UTC.
- Required: scenario tests.
- Priority: P0

GAP-030: GHL default CST cannot override firm state.
- Current: resolver handles default override.
- Expected: firm tag/owner wins.
- Risk: PST leads booked CST.
- Required: audit all EST/default contacts.
- Priority: P0

GAP-031: Appointment create failure must escalate once.
- Current: booking failure escalates.
- Expected: one alert and no repeated retries without repair.
- Risk: Slack spam, no appointment.
- Required: scanner flag.
- Priority: P0

GAP-032: Bad appointment must be clearable.
- Current: repair action added.
- Expected: delete GHL event, clear bot state, cancel reminders.
- Risk: false reminders.
- Example: Terrill Grany.
- Required: dashboard button.
- Priority: P0

GAP-033: Appointment reminders must not be scheduled in the past.
- Current: reminder cadence checks timing.
- Expected: only useful future reminders.
- Risk: instant spam.
- Required: tests for same-hour booking.
- Priority: P1

GAP-034: Manual appointment edits must reconcile reminders.
- Current: ensure reminders exists, but webhook sync is incomplete.
- Expected: appointment updated/cancelled webhooks update jobs.
- Risk: wrong reminder time.
- Example: Leslie Hernandez class.
- Required: GHL appointment sync.
- Priority: P0

GAP-035: Backup time should be notes-only unless explicitly changed.
- Current: notes/window stored, no second appointment.
- Expected: team sees backup in notes and dashboard.
- Risk: double booking confusion.
- Required: dashboard field and no-show handling.
- Priority: P1

GAP-036: Backup time window must remain window.
- Current: window parser exists.
- Expected: `2-4pm` not duplicated as `2pm`.
- Risk: misleading confirmation.
- Example: Francisco Gonzalez.
- Required: window test coverage.
- Priority: P0

GAP-037: Backup timeout must acknowledge no backup.
- Current: template says no backup received.
- Expected: confirm primary and reschedule option.
- Risk: lead thinks ignored.
- Required: template review.
- Priority: P1

GAP-038: No-show webhook must be reliable.
- Current: no-show endpoints exist.
- Expected: GHL no-show action triggers recovery.
- Risk: missed scheduled leads not chased.
- Required: real webhook test.
- Priority: P0

GAP-039: Backup no-show reminders must use backup time.
- Current: backup reminder templates exist.
- Expected: if primary missed and backup upcoming, remind backup.
- Risk: wasted second chance.
- Required: manual live test.
- Priority: P1

GAP-040: Human SMS must pause bot.
- Current: human-outbound webhook exists.
- Expected: no bot texts while human active.
- Risk: bot fights team.
- Example: Mukul Panchal class.
- Required: validate GHL workflow.
- Priority: P0

GAP-041: Human call must pause bot for 30 minutes.
- Current: human-active/call action exists.
- Expected: no text during call.
- Risk: embarrassing double contact.
- Required: validate GHL call workflow.
- Priority: P0

GAP-042: Human follow-up timeout must resume only safe leads.
- Current: 5 minutes SMS, 30 minutes call.
- Expected: not if appointment/signed/NQ/hold exists.
- Risk: bot returns too early.
- Required: scanner and tests.
- Priority: P0

GAP-043: Return-to-bot must use last inbound if it already answers.
- Current: some smart return logic exists.
- Expected: do not repeat answered question.
- Risk: annoying lead.
- Required: more examples.
- Priority: P1

GAP-044: Ready-for-call should stay human-owned.
- Current: call-now pauses and alerts.
- Expected: bot should not continue until human outcome known.
- Risk: bot texts while team calling.
- Required: status dashboard.
- Priority: P0

GAP-045: Old NR backfills need controlled cadence.
- Current: backfill queues initial SMS; large pending jobs exist.
- Expected: old leads start with cold outreach, not wrong active state.
- Risk: mass wrong messages.
- Required: batch dashboard and pause switch.
- Priority: P0

GAP-046: Recently touched NR contacts need separate review.
- Current: GHL search gives dateUpdated, not clean last SMS/call.
- Expected: exclude recent human activity unless approved.
- Risk: over-contact.
- Required: better recent-activity source.
- Priority: P1

GAP-047: Fresh lead cadence may be too light.
- Current: 15 and 60 minutes.
- Expected: decide whether to add 120 and 240 minutes.
- Risk: hot fresh lead cools off.
- Required: business decision and test.
- Priority: P1

GAP-048: Cold outreach count per day must not exceed allowed plan.
- Current: 21-day AM/PM plus fresh leads.
- Expected: no spam beyond intended cadence.
- Risk: complaints/opt-outs.
- Required: per-contact daily cap visible.
- Priority: P0

GAP-049: Quiet-hours exception must be exact.
- Current: inbound reply can be answered after hours.
- Expected: only one after-hours follow-up if they stop.
- Risk: TCPA exposure.
- Required: quiet-hour decision log.
- Priority: P0

GAP-050: State stricter windows remain configurable.
- Current: config supports state windows.
- Expected: legal/business windows set when known.
- Risk: compliance issue.
- Required: state rule input.
- Priority: P1

GAP-051: STOP confirmation must not alert if GHL blocks it.
- Current: permanent block skipped.
- Expected: no Slack error.
- Example: Brianna Sendra.
- Required: keep regression test.
- Priority: P0

GAP-052: DND active must be dashboard-only.
- Current: DND skipped jobs are info.
- Expected: no Slack bot-error.
- Risk: Slack flooding.
- Required: dashboard DND bucket.
- Priority: P0

GAP-053: LLM should not send custom messages.
- Current: LLM classifies; bot uses hard-coded templates.
- Expected: LLM is router/classifier only.
- Risk: uncontrolled copy/legal statements.
- Required: keep interface strict.
- Priority: P0

GAP-054: LLM confidence thresholds need stage awareness.
- Current: call-stage exception added.
- Expected: thresholds vary by context.
- Risk: obvious answers clarified or wrong answers accepted.
- Required: stage-specific tests.
- Priority: P1

GAP-055: LLM failures should not create repeated Slack noise.
- Current: operational-only for LLM fallback failure, escalation once.
- Expected: one human path plus dashboard.
- Risk: noise and missed leads.
- Required: scanner grouping.
- Priority: P1

GAP-056: Template edits need versioning.
- Current: dashboard supports template management/A-B concepts.
- Expected: every sent message stores template group/key/version.
- Risk: cannot audit performance.
- Required: template version field.
- Priority: P2

GAP-057: A/B tests must not silently change live copy.
- Current: push-live should be explicit.
- Expected: log who/when/what changed.
- Risk: untracked conversion drops.
- Required: template change log.
- Priority: P2

GAP-058: Dashboard performance must not crash on object source.
- Current: source normalization exists.
- Expected: never render `[object Object]`.
- Risk: unusable dashboard.
- Required: safe value normalizer everywhere.
- Priority: P1

GAP-059: Decision log must exist for every action.
- Current: many actions record decisions, but coverage should be audited.
- Expected: send, skip, pause, book, remind, repair, escalate all logged.
- Risk: cannot explain behavior.
- Required: dashboard contact decision log.
- Priority: P0

GAP-060: Stuck-state scanner must be treated as critical.
- Current: scanner exists in dashboard direction but needs hardening.
- Expected: active/no follow-up, scheduled/no reminder, awaiting backup, bad timezone, failed job, DND.
- Risk: leads silently die.
- Required: daily review dashboard.
- Priority: P0

GAP-061: Bot pause reason must be human-readable.
- Current: fields exist but dashboard clarity needs work.
- Expected: admin sees exact reason and next action.
- Risk: team returns bot incorrectly.
- Required: dashboard copy.
- Priority: P1

GAP-062: Manual GHL tags need clear meanings.
- Current: many tags are recognized.
- Expected: tag dictionary in dashboard and team guide.
- Risk: team applies wrong tag.
- Required: team training table.
- Priority: P1

GAP-063: Bad live behavior needs emergency pause.
- Current: admin actions exist, but broad kill switch should be obvious.
- Expected: pause queue/batches quickly.
- Risk: mass bad sends.
- Required: dashboard emergency controls.
- Priority: P0

GAP-064: Production backups must be routine.
- Current: Render Postgres and GitHub are source locations.
- Expected: backup before major batches and pushes.
- Risk: losing bot memory.
- Required: runbook checklist.
- Priority: P0

GAP-065: Every fixed bug needs a named regression.
- Current: many named tests exist.
- Expected: each live failure becomes a test.
- Risk: repeated mistakes.
- Required: maintain this doc plus test matrix.
- Priority: P0

## 17. Scenario Test Matrix

1. NR lead enters during allowed hours.
   - Expected: initial cold SMS sends, cold/fresh jobs scheduled.

2. NR lead enters during quiet hours.
   - Expected: initial SMS queued for next legal window.

3. Old NR backfill lead starts.
   - Expected: Day 1 cold message only, no qualification jump.

4. Lead replies `yesterday`.
   - Expected: save accident date, ask fault.

5. Lead replies `the accident happened last Saturday around 3pm`.
   - Expected: save accident date, ask fault, no appointment.

6. Lead replies `other driver hit me`.
   - Expected: save not-at-fault, ask medical.

7. Lead replies `both at fault`.
   - Expected: save unsure/partial, ask medical.

8. Lead replies `I went to the hospital`.
   - Expected: save medical yes, ask call time.

9. Lead replies `no I did not go`.
   - Expected: save medical no, ask call time.

10. Lead says `later`.
   - Expected: ask exact time, schedule hot follow-ups.

11. Lead says `tomorrow afternoon`.
   - Expected: ask exact time tomorrow.

12. Lead says `in an hour`.
   - Expected: ask exact time/options.

13. Lead says `today at 2pm`.
   - Expected: book in contact timezone, ask backup.

14. Lead says `after 2:30pm`.
   - Expected: clarify or schedule correctly as future availability, not call now.

15. Lead says `yes` after call-now/later ask.
   - Expected: treat as call-now intent if context supports it.

16. Lead gives backup `4pm`.
   - Expected: save exact backup in appointment notes.

17. Lead gives backup `2-4pm`.
   - Expected: save backup window, not duplicate primary.

18. Lead does not give backup.
   - Expected: timeout confirms primary only.

19. Lead says `okay` after booking.
   - Expected: no escalation; mark acknowledgement.

20. Lead says `thank you` after booking.
   - Expected: no escalation.

21. Lead asks to reschedule.
   - Expected: parse new time, update appointment, replace reminders.

22. Appointment is manually edited in GHL.
   - Expected: future appointment sync should replace reminders.

23. Appointment no-show webhook fires.
   - Expected: no-show sequence starts, not qualification restart.

24. Backup time exists after no-show.
   - Expected: backup reminders fire.

25. Human sends SMS.
   - Expected: bot pauses and waits.

26. Human starts call.
   - Expected: bot pauses for 30 minutes.

27. Human sends SMS and lead goes quiet.
   - Expected: bot may auto-return after 5 minutes if safe.

28. Human call and lead goes quiet.
   - Expected: bot may auto-return after 30 minutes if safe.

29. Human hold tag exists.
   - Expected: no auto-return.

30. NQ tag appears.
   - Expected: cancel jobs and stay silent.

31. Signed/contract tag appears.
   - Expected: cancel jobs and stay silent.

32. Follow-up/missed follow-up tag appears.
   - Expected: manual hold and stay silent.

33. STOP message arrives.
   - Expected: opt out, cancel jobs, no Slack error if GHL blocks confirmation.

34. DND blocks SMS.
   - Expected: skipped/dashboard-only, no bot-error Slack.

35. Duplicate phone has one active bot thread.
   - Expected: route to active thread and log.

36. Duplicate phone has multiple active bot threads.
   - Expected: pause and human review.

37. LLM says needs escalation.
   - Expected: one escalation.

38. LLM fails.
   - Expected: human escalation plus operational dashboard issue.

39. GHL appointment API fails.
   - Expected: one escalation and dashboard issue.

40. GHL tag lookup fails.
   - Expected: defer/skip send and retry, not blind send.

41. Same-day appointment is under one hour away.
   - Expected: only useful future reminders.

42. Contact says California after booking.
   - Expected: timezone correction preserves wall-clock time.

43. Contact with CA firm tag but CST account timezone.
   - Expected: Pacific timezone wins.

44. Cold lead says `ok`.
   - Expected: ask accident date, not fault spam.

45. Lead gives long detailed answer that includes current answer.
   - Expected: extract answer and advance.

46. Lead sends photos/document links.
   - Expected: escalate.

47. Lead says they already have a lawyer.
   - Expected: polite second-opinion message, pause.

48. Lead asks who this is.
   - Expected: escalation or identity-safe response based on policy.

49. Lead is angry/upset.
   - Expected: escalation.

50. Bot bad appointment is discovered.
   - Expected: clear bad appointment, delete/void GHL event, cancel reminders, pause for review.

## 18. Recommended Next Build Order

1. Finish decision log coverage and expose it per contact.
2. Rebuild dashboard around operations, not vanity analytics.
3. Add stuck-state scanner with one-click repair.
4. Add timezone audit page and timezone source display.
5. Add appointment created/updated/cancelled/no-show sync from GHL.
6. Add emergency pause/batch controls.
7. Add template versioning and A/B governance.
8. Add full scenario automation from this test matrix.
9. Add daily audit report for wrong sends, skipped sends, escalations, bookings, and stuck states.
10. Add a clear tag dictionary for the team.

## 19. Operator Rules

- If a lead is signed, contract, NQ, QR, follow-up, or human hold, do not return them to the bot.
- If the bot made a wrong appointment, clear the bad appointment before doing anything else.
- If a human is actively calling or texting, pause the bot.
- If a lead gives vague time, ask exact time.
- If a lead gives accident date/time, do not book.
- If Slack starts spamming, pause the related contact and check duplicate escalation state.
- If dashboard cannot explain why the bot did something, that is a product gap, not an operator failure.

## 20. Current Production-Readiness Verdict

The bot is improving quickly and now has strong regression coverage for many live failures. It should still be treated as controlled-production, not fully autonomous mass automation.

Safe to do:

- Small monitored batches.
- Fresh NR leads with dashboard monitoring.
- Human-assisted booking and escalations.
- Continued test expansion.

Not safe to do without more controls:

- Large unmonitored blasts.
- Blind old NR backfills.
- Letting bot operate without dashboard issue review.
- Assuming GHL manual actions are synced unless webhook is proven.
- Trusting timezone when source is not visible.

The single biggest product need is an operational dashboard that shows the bot's reasoning, stuck states, and repair controls. The single biggest logic need is continued scenario testing from real failures.
