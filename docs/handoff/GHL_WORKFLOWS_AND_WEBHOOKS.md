# GoHighLevel Workflows And Webhooks

Every webhook should be a `POST` request to the recipient's deployed bot URL.

Base URL example:

```text
https://your-app.onrender.com
```

If GHL lets you add headers, add:

```text
x-webhook-secret: <WEBHOOK_SECRET>
Content-Type: application/json
```

If GHL does not let you add headers, add this custom data field:

```text
webhookSecret = <WEBHOOK_SECRET>
```

The bot accepts either.

## Required Workflow 1: Test Ping

Purpose:

- Confirms GHL can reach the bot and the secret works.

Webhook URL:

```text
POST /webhooks/ghl/ping
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
name = {{contact.name}}
phone = {{contact.phone}}
```

Check result:

```text
GET /webhooks/ghl/ping-status
```

## Required Workflow 2: NR / No Response Enrollment

Purpose:

- Starts the cold outreach flow after the team calls twice and marks the lead no response.

Preferred trigger:

- Opportunity moved to No Response stage, or
- Contact tag added `NR`, or
- Custom disposition `no response` / `NR`.

Webhook URL:

```text
POST /webhooks/ghl/disposition
```

Aliases also accepted:

```text
POST /webhooks/ghl/tag
POST /webhooks/ghl/nr-tag
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
name = {{contact.name}}
phone = {{contact.phone}}
email = {{contact.email}}
disposition = NR
tags = {{contact.tags}}
leadSource = {{contact.source}}
timezone = {{contact.timezone}}
state = {{contact.state}}
```

Important:

- This should only fire after the team has actually made the required calls.
- Do not fire this for signed, NQ, QR, follow_up, or human_hold contacts.

## Required Workflow 3: Inbound SMS

Purpose:

- Lets the bot see the PC's replies.

Trigger:

- Customer replied / inbound SMS / conversation message received.

Webhook URL:

```text
POST /webhooks/ghl/inbound-sms
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
name = {{contact.name}}
phone = {{contact.phone}}
email = {{contact.email}}
message = {{message.body}}
tags = {{contact.tags}}
leadSource = {{contact.source}}
timezone = {{contact.timezone}}
state = {{contact.state}}
```

If GHL uses different merge fields, map the latest inbound body into any of these accepted keys:

- `message`
- `body`
- `text`
- `messageBody`
- `message_body`

## Required Workflow 4: Appointment Created / Updated

Purpose:

- Lets the bot know when the team manually creates or edits an appointment.
- Rebuilds reminders.
- Sends booking Slack notice.

Trigger:

- Appointment created.
- Appointment updated.
- Calendar appointment created/updated.

Webhook URL:

```text
POST /webhooks/ghl/appointment-sync
```

Aliases also accepted:

```text
POST /webhooks/ghl/appointment
POST /webhooks/ghl/appointment-created
POST /webhooks/ghl/appointment-updated
POST /webhooks/ghl/calendar-appointment
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
appointmentId = {{appointment.id}}
startTime = {{appointment.start_time}}
status = {{appointment.status}}
title = {{appointment.title}}
tags = {{contact.tags}}
timezone = {{contact.timezone}}
```

Accepted appointment start fields:

- `startTime`
- `start_time`
- `startsAt`
- `starts_at`
- `scheduledTime`
- `appointmentTime`
- `appointmentStartTime`
- `startDate`
- `appointment.startTime`
- `event.startTime`

Appointment title conventions:

- `ASD Initial Specialist Call - [Name]`
- `ASD Qualified Follow-Up Call - [Name]`
- `ASD Contract Review Call - [Name]`

## Required Workflow 5: Appointment No-Show

Purpose:

- Starts no-show recovery when the team marks an appointment no-show.

Trigger:

- Appointment status changed to no-show / missed / did not show.

Recommended webhook URL:

```text
POST /webhooks/asd/no-show
```

Aliases also accepted:

```text
POST /webhooks/ghl/no-show
POST /webhooks/ghl/appointment-no-show
POST /webhooks/asd/appointment-no-show
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
appointmentId = {{appointment.id}}
startTime = {{appointment.start_time}}
status = no_show
title = {{appointment.title}}
tags = {{contact.tags}}
timezone = {{contact.timezone}}
```

Check no-show diagnostics:

```text
GET /api/admin/no-show-webhooks
```

Use the admin password header if required:

```text
x-admin-password: <ADMIN_PASSWORD>
```

## Required Workflow 6: Bot Control Tags

Purpose:

- Lets human team tags control bot behavior.

Trigger:

- Contact tag added.

Webhook URL:

```text
POST /webhooks/ghl/bot-control
```

Simple setup:

- Make one workflow per important tag.
- Hardcode the `action` value for that tag.

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
name = {{contact.name}}
phone = {{contact.phone}}
tags = {{contact.tags}}
action = <TAG_OR_ACTION_NAME>
actor = {{user.name}}
```

Supported action/tag values:

- `call_no_answer`
- `call_drop`
- `call_connected_follow_up`
- `return_to_bot`
- `NQ`
- `contract_sent`
- `contract`
- `contract_set`
- `signed`
- `contract_signed`
- `follow_up`
- `QR`
- `human_hold`
- `pause_bot`
- `urgent_call_now`
- `mark_no_show`
- `ensure_appointment_reminders`
- `refresh_timezone`

Use `NQ`, not `not_qualified`.

## Required Workflow 7: Human Call Activity

Purpose:

- Pauses the bot when a human places a call.
- Requires the team to record an outcome if the call is short or unclear.

Trigger:

- Outbound call activity.
- Manual call started/completed.

Webhook URL:

```text
POST /webhooks/ghl/human-active
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
action = manual_call
callStatus = {{call.status}}
callDuration = {{call.duration}}
callDirection = outbound
actor = {{user.name}}
```

If duration is missing or under 60 seconds, the bot treats it as needing a call outcome.

## Required Workflow 8: Human Manual Text / Outbound Message

Purpose:

- Lets the bot know a human manually texted the PC.
- Without this, the bot cannot reliably know what the human said.

Preferred method:

- GHL Marketplace app webhook event for outbound conversation messages.

Webhook URL:

```text
POST /webhooks/asd/human-outbound
```

Alias also accepted:

```text
POST /webhooks/ghl/human-outbound
```

Required event:

```text
OutboundMessage
```

Required app/webhook scope:

```text
conversations/message.readonly
```

If using a normal GHL workflow instead of Marketplace webhook, custom data should include:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
type = OutboundMessage
message = {{message.body}}
messageType = SMS
actor = {{user.name}}
```

If GHL does not expose a normal "manual SMS sent" workflow trigger, use the Marketplace app event. If that is not installed, the fallback is for the team to tag `call_connected_follow_up`, `return_to_bot`, or another bot-control tag manually.

## Optional Workflow 9: Missed Call

Purpose:

- Starts missed-call follow-up if a scheduled call was missed outside the no-show workflow.

Webhook URL:

```text
POST /webhooks/ghl/missed-call
```

Custom data:

```text
webhookSecret = <WEBHOOK_SECRET>
contactId = {{contact.id}}
appointmentId = {{appointment.id}}
callTime = {{appointment.start_time}}
status = missed
```

## Testing Each Webhook

For every workflow:

1. Trigger it on a test contact only.
2. Check Render logs.
3. Check `/integrations`.
4. Check dashboard contact timeline.
5. Check Slack if it is supposed to alert.
6. Confirm no duplicate messages were sent.

