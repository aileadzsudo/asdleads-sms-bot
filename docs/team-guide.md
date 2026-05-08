# Accident Support Desk SMS Bot Team Guide

Last updated: May 8, 2026

## What The Bot Is Doing

The bot is a memory-based SMS intake assistant. It follows up with no-response leads, asks the next missing qualification question, books calls, and alerts humans when the conversation should not stay automated.

The bot remembers each contact's current engagement status and qualification progress. If a lead goes cold halfway through, it does not restart them from the beginning. It resumes from the next unanswered question.

## What Starts The Bot

The normal start trigger is the GoHighLevel no-response disposition or NR workflow. The contact must be intentionally enrolled before the bot should respond to inbound messages.

The bot can also resume a contact when the team sends the contact back to the bot using the dashboard or the `return_to_bot` tag.

## What The Bot Is Not

The bot is not a lawyer, attorney, claims specialist, or human case manager. It should not answer legal, medical, insurance, settlement, signed-client, or firm-service questions.

The bot is not supposed to take over every inbound text in GoHighLevel. If a human started a conversation and the contact was not enrolled in bot memory, the bot should ignore that inbound text.

The bot is not supposed to keep talking after opt-out, signed, NQ, manual pause, or human escalation unless a human explicitly returns the contact to the bot.

## Main Response Types

The team does not need to memorize every exact script. The important part is what kind of response the bot sends.

1. Initial no-response outreach
2. Cold outreach follow-up
3. Accident date capture
4. Fault question
5. Medical treatment question
6. Time-aware call ask
7. Call-now escalation
8. Specific-time appointment booking
9. Backup-time request
10. Booking confirmation
11. Appointment reminders
12. Missed-call follow-up
13. Warm follow-up after an active lead stops replying
14. Re-engagement after a lead goes cold
15. Opt-out confirmation
16. Human escalation alert
17. Confusing-message clarification
18. Busy/not-available humanized response
19. Return-to-bot resume message
20. NQ/signed pause handling

## Humanized Context Handling

If a lead says something like "I'm sorry yes I'm currently busy," the bot should not treat the word "yes" as a medical or fault answer.

Instead, the bot treats the message as an availability/context message and replies in a more natural way, then asks the current question again.

Example:

Lead: "I'm sorry yes I'm currently busy"

Bot: "No worries at all. I can keep this quick over text. I just need a couple details about the accident to see if we can help. Have you needed to see a doctor or get any medical treatment after the accident?"

## Human Escalation

The bot escalates to Slack when a human should review the message.

Common escalation reasons:

- Lead asks for a human
- Lead asks for an attorney, lawyer, or specialist
- Lead says they want a call now
- Lead seems upset, confused, angry, or concerned
- Lead asks a legal, medical, insurance, or settlement question
- Lead gives detailed legal, medical, or insurance information
- Lead mentions signed-client or firm-service issues
- Bot cannot confidently classify the answer
- Duplicate phone conflict is detected
- LLM fallback fails

When escalated, the bot pauses automation so the team can take over.

## How To Stop The Bot

Use one of these methods:

- Dashboard: open the contact and click Pause Bot
- GHL tag: add `NQ` if the lead is not qualified
- GHL tag: add `signed` if the lead has signed and should be handled by the firm/team
- Lead opt-out: if the lead says stop, unsubscribe, wrong number, remove me, or similar, the bot marks opted out and stops

Do not rely on manually sending a normal text message to stop the bot. Use the dashboard action or tag so the bot memory updates.

## How To Send A Contact Back To The Bot

Use one of these methods:

- Dashboard: open the contact and click Return To Bot
- GHL tag: add `return_to_bot`

When returned, the bot resumes from the saved qualification progress. It should not start over.

Example:

If the contact already answered fault but never answered medical treatment, Return To Bot should ask the medical treatment question.

## Appointment Handling

If the lead wants a call now, the bot marks the contact ready for call, pauses automation, and alerts Slack.

If the lead gives a specific time, the bot should book the appointment in GoHighLevel and send a confirmation.

If the appointment is manually created by a human, the team should also close or resolve the escalation in the bot dashboard. Otherwise the bot may still think the escalation is unresolved.

## Quiet Hours

Automated outbound messages follow the contact's local texting window.

Default texting window:

- 8:00 AM to 9:00 PM local time

If a lead texts in after-hours, the bot can reply because the lead initiated the conversation. If the lead stops replying after-hours, the bot can send only one short follow-up and then waits until the next texting window.

## Team Rules

- If the bot escalates, a human owns the contact until it is returned to the bot.
- If a human fixes the issue manually, update the bot state in the dashboard.
- Use Pause Bot when the bot should stay quiet.
- Use Return To Bot only when automation should resume.
- Use NQ and signed tags only when those outcomes are true.
- Do not delete duplicate contacts just to make the bot work. Duplicate conflicts should be reviewed by a human.

## Simple Team Workflow

1. Watch Slack escalation alerts and the dashboard.
2. If you are handling an escalation, mark it acknowledged or pause the bot.
3. If you book a call manually, update the bot/dashboard so it stops treating the escalation as open.
4. If the lead should keep qualifying by SMS, click Return To Bot or add `return_to_bot`.
5. If the lead is NQ, signed, or opted out, make sure the correct tag/state is applied.
