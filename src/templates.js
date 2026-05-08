const coldOutreachTemplates = {
  day_1_am: "Hi [NAME]! 👋👋 It's William from Accident Support Desk, I was looking over your accident info and it looks very similar to another accident we just settled for a pretty significant amount. I think we can help show you how to do the same, just had a few quick questions for us to understand the situation a bit better. We can handle this over text message real quick, should only take a minute. Do you remember the date of the accident?",
  day_1_pm: "Hey [NAME] 🤕 waiting any longer could actually hurt your claim. I want to make sure you get a clear picture of your compensation options. I only need a few quick questions answered. Were you at fault for the accident?",
  day_2_am: "Hi [NAME] 👋, William here. I know getting a message out of nowhere feels weird but I genuinely think you might be sitting on more than you realize. People in accidents like yours often don't know what they qualify for until someone walks them through it. What was the date of the accident?",
  day_2_pm: "William from ASD here. Some of what you shared looks like the insurance company may already be using tactics against you. I can help you get ahead of it, just need one detail. What was the date of the accident?",
  day_3_am: "Hey [NAME] 🤔 — quick honest question. Has the other driver's insurance reached out to you yet? If they have, there's a reason for that and it's not in your favor. I can explain what's happening on their end. Just need to know, were you at fault?",
  day_3_pm: "Hey [NAME]! it's William. Based on the info you gave, there might be some injury-related protections you qualify for if we act quickly. I can check for you real fast. What was the date of the accident?",
  day_4_am: "Hi [NAME], it's William. I've been doing this long enough to know that the people who wait the longest usually end up with the least. Not trying to scare you just being honest. Did you need to see a doctor after the accident at all?",
  day_4_pm: "Hi [NAME], William again. I noticed you might be missing out on lost wage compensation it's something people often overlook. A couple quick questions will tell us for sure. What was the date of the accident?",
  day_5_am: "Hey [NAME] 👋 William here. Were there any passengers in your car when the accident happened? That detail actually matters more than most people think for how a claim gets valued.",
  day_5_pm: "Hi [NAME], it's William. Just thinking — even if you feel mostly okay physically, there can be things that show up later that you'd want documented now. Did you have any pain or soreness after the accident, even minor?",
  day_6_am: "Hey [NAME], William from Accident Support Desk. I still have your file open and I keep coming back to it. What was the date of the accident?",
  day_6_pm: "[NAME] — no pressure here at all. I just don't want you looking back in 6 months wishing you'd asked. Were you at fault for the accident?",
  day_7_am: "Hey [NAME], William here. Haven't heard back so I wasn't sure if you still wanted help with the accident stuff. If you do, what was the date of the accident?",
  day_7_pm: "Hi [NAME], wrapping up the week and still have your file open. Were you injured in the accident at all, even something that seemed minor at the time?",
  day_8_am: "Hey [NAME] ⏳, William here. New week — wanted to start fresh. There's a legal deadline on accident claims and once it passes there's nothing I or anyone else can do for you. What was the date of your accident so I can check where you stand?",
  day_8_pm: "Hi [NAME], William from Accident Support Desk. There's a chance you may qualify for compensation most people don't even know exists in situations like yours. I just need a quick detail to double-check. What was the date of the accident?",
  day_9_am: "[NAME] — real talk. Insurance companies have entire teams whose job is to pay you as little as possible. I'm on the other side of that. I want to make sure you're not walking away from something you're actually owed. Were you at fault for the accident?",
  day_9_pm: "[NAME]!, William here — I'm looking at your file and you might qualify for additional property damage support depending on the timeline. Quick question: what was the date of the accident?",
  day_10_am: "Hi [NAME], it's William. Something I haven't asked yet — was there a police report filed after your accident? That one detail can make a big difference in what you're able to claim.",
  day_10_pm: "Hi [NAME], it's William. I know things get hectic, but I didn't want you to miss out on the help you might qualify for. Can you send me the date of the accident real quick?",
  day_11_am: "Hey [NAME] 💰 — I'll be straight with you. I've seen people in similar situations get $40k, $80k, even more. I've also seen people get nothing because they waited too long. I'd hate for that to be you. What was the date of the accident?",
  day_11_pm: "Hi [NAME], William here. Did the accident affect you emotionally at all — anxiety driving, trouble sleeping, anything like that? That's actually compensable and most people never think to mention it.",
  day_12_am: "[NAME], William from Accident Support Desk. Quick thing — was anyone else injured in the accident? Not just you, but any passengers or the other driver? Helps me understand the full picture.",
  day_12_pm: "Hey [NAME] ❤️ — I genuinely hope you're doing okay. Accidents take more out of people than they realize, physically and mentally. If you want to explore your options, I'm still here. Just reply with the date of the accident.",
  day_13_am: "Hi [NAME], it's William. I've been in this field a long time and I can tell when a case has real potential. Yours does. But I can only help if you respond. What was the date of the accident?",
  day_13_pm: "[NAME] — one thing I haven't mentioned: even if you already settled something small with insurance, you may still have options. Did you sign anything with the insurance company after the accident?",
  day_14_am: "Hey [NAME], William here. I'll stop reaching out if you don't feel like you need guidance with your case value anymore. Did you still want some help, or should I close your file?",
  day_14_pm: "Hi [NAME], it's William. Two weeks in and I keep coming back to your file. I'd rather ask one more time than not. What was the date of the accident?",
  day_15_am: "Hey [NAME] 👋, William here. Starting week three — I know that's a lot of messages. I wouldn't keep going if I didn't genuinely think this was worth your time. Were you at fault for the accident?",
  day_15_pm: "[NAME] — no guilt if you're not interested, I promise. I just want to make sure you made that choice knowingly and not because life got in the way. Still open to helping if you want it.",
  day_16_am: "Hi [NAME], William again. I've reached out a few times and wasn't sure if you were still needing help with everything going on.",
  day_16_pm: "Hey [NAME] — did you ever wonder what your accident claim might actually be worth? Most people assume it's not much. They're usually wrong. I can give you a rough idea in literally two questions.",
  day_17_am: "Hi [NAME], William here. I've worked with a lot of people who were skeptical at first — thought nothing would come of it. A lot of them were really glad they responded. What was the date of your accident?",
  day_17_pm: "[NAME] — I'm not going to pretend I'm not following up again. I am. Because I've seen what happens when people act and when they don't. Were you injured at all?",
  day_18_am: "Hey [NAME], William here. Before I stop reaching out I wanted to check one last time — some timelines in accident cases really do matter. What was the date of the accident?",
  day_18_pm: "Hi [NAME], it's William. If you already got help, or you're just not interested — just let me know either way and I'll stop reaching out. No hard feelings at all.",
  day_19_am: "[NAME] 🙏 — William from Accident Support Desk. I keep thinking about this: people who've been in accidents are already dealing with enough. So I'll make it simple: yes or no, do you want me to take a look at your situation?",
  day_19_pm: "Hey [NAME], most people who don't respond aren't uninterested — life just gets busy. If that's you, I get it. I'm still here when you have a minute.",
  day_20_am: "Hi [NAME], William here. I've got a few cases I'm wrapping up this week and yours has been on my mind. What was the date of the accident?",
  day_20_pm: "[NAME] — I've been doing this a long time. I've seen people get help they never expected and I've seen people miss out entirely. One last real push from me — were you at fault for the accident?",
  day_21_am: "Hey [NAME] 💬, it's William. I've reached out every day for three weeks because I believed there was something worth fighting for in your file. I still do. If you want help, I'm here. If not, I'll stop — no hard feelings. Just reply yes or no.",
  day_21_pm: "Hey [NAME], it's William. This will be my last message so I don't keep bothering you. Before I close out your file, let me know if you still wanted some help. Just needed to confirm a few details."
};

const qualificationTemplates = {
  fault: "So glad you got back to me, [NAME]! 🙌 Really quick just to understand your situation: were you at fault for the accident, or was it the other driver?",
  medical: "Have you needed to see any doctors or receive any medical treatment after the accident? 🤕",
  callAsk: "Based on what you’ve shared, we can definitely help you out! 💰 The next step is to connect you with a ASD Specialist who can create a compensation gameplan for you are you open for a call now or later today? 📞",
  clarify: "I want to make sure I understood you correctly 🙏 Can you answer that last question with a quick yes, no, or not sure?",
  optOutConfirm: "No problem — we won't text you again. If you change your mind, please feel free to reach back out.",
  callNow: "Perfect! 🔥 I'm connecting you with a Specialist right now — you should be getting a call within the next few minutes. Make sure your phone is on and available. What's the best number to reach you at?",
  delay: "So sorry for the small wait — our Specialist is just finishing up with another client. You're next, should be calling within the next 3-5 minutes! 📞",
  backupAsk: "Perfect, I've got you down for [TIME]! 📅 Just to make sure we don't miss each other — is there a backup time that works too, just in case something comes up on either end?",
  bookingConfirmedWithBackup: "Got it — [PRIMARY TIME] with [BACKUP TIME] as a backup. You're all set [NAME]! 🙌 Our Specialist will call from a local number so make sure to pick up even if you don't recognize it. We'll remind you before your call!",
  bookingConfirmedNoBackup: "No worries! You're locked in for [TIME]. We'll send you a reminder before the call — just keep your phone nearby 📱",
  sameDayBooked: "Locked you in for [TIME] today! 📅 Our Specialist will be calling from a local number so keep your phone close.",
  rescheduleAsk: "No problem 👍 What new time works best for your call today or tomorrow?",
  rescheduleNeedsSpecificTime: "No problem 👍 What specific time should I move your call to?",
  rescheduleConfirmed: "Done — I moved your Specialist call to [TIME]. 📅 We'll send you a reminder before the call, and they'll call from a local number."
};

const reengagementTemplates = {
  after_date: {
    1: "Hey [NAME], William here — looks like we got cut off 🙌 I have the accident date, just need to know: were you at fault, or was it the other driver?",
    2: "Hi [NAME], quick follow-up 👋 I do not want to lose the progress we made. Were you at fault for the accident?",
    3: "[NAME] — one quick detail and I can keep this moving. Was the accident your fault, the other driver's, or are you not sure?",
    5: "Hey [NAME], William here. Still need one answer before I can point you the right way: were you at fault?",
    7: "Last try on this from me for now, [NAME]. Were you at fault for the accident, yes, no, or not sure?"
  },
  after_q1: {
    1: "Hey [NAME], William here — looks like we got cut off! 🙌 We were right in the middle of figuring out your situation. Really quick: have you needed to see a doctor or get any medical treatment since the accident?",
    2: "Hi [NAME], just circling back. You were doing great — literally one more question and I'd have a much clearer picture of what you might be looking at. Did you get any medical treatment after the accident?",
    3: "[NAME] — William here. We were so close to having a full picture of your case. Have you seen a doctor since the accident, even just once?",
    5: "Hey [NAME], I don't want to lose the progress we made. You already answered the first question which told me a lot. Just need one more: did you receive any medical treatment after the accident?",
    7: "Hi [NAME], William here. Last try on my end — did you need medical treatment after the accident, yes or no?"
  },
  after_call_booking: {
    1: "Hey [NAME] 👋 — just making sure everything is still good for your call at [TIME]! Reply YES to confirm or let me know if you'd like to pick a different time.",
    2: "Hi [NAME], William here. I noticed we didn't hear back from you about your scheduled call 📞 Still want to connect with a Specialist? I can get you rescheduled quickly — what time works best?",
    3: "[NAME] — we still have you in the system and want to make sure you get the help you came to us for. Can we lock in a new time for your call this week?"
  }
};

const persistentReengagementTemplates = {
  after_date: {
    day_1_am: reengagementTemplates.after_date[1],
    day_1_pm: "Hey [NAME], I still just need the fault detail 🙏 Were you at fault, not at fault, or not sure?",
    day_2_am: reengagementTemplates.after_date[2],
    day_2_pm: "[NAME], even if it was partly your fault, that helps me understand the situation. Were you at fault?",
    day_3_am: reengagementTemplates.after_date[3],
    day_3_pm: "Quick yes, no, or not sure is fine: were you at fault for the accident?",
    day_4_am: "Hey [NAME], William here. I have your accident date saved. Was the accident your fault or the other driver's?",
    day_4_pm: "Still trying to get this finished for you. Were you at fault, not at fault, or unsure?",
    day_5_am: reengagementTemplates.after_date[5],
    day_5_pm: "[NAME], this answer changes what options may be available. Were you at fault for the accident?",
    day_6_am: "Morning [NAME], quick check: was the accident your fault or the other driver's?",
    day_6_pm: "I can keep this simple: reply yes, no, or not sure. Were you at fault?",
    day_7_am: reengagementTemplates.after_date[7],
    day_7_pm: "Last message from me on this for now. If you still want help, reply with who was at fault."
  },
  after_q1: {
    day_1_am: reengagementTemplates.after_q1[1],
    day_1_pm: "Hey [NAME], I still only need this one piece 🤕 did you get any medical treatment after the accident?",
    day_2_am: reengagementTemplates.after_q1[2],
    day_2_pm: "[NAME], even one urgent care, chiro, ER, or doctor visit matters here. Did you get checked out after the accident?",
    day_3_am: reengagementTemplates.after_q1[3],
    day_3_pm: "Quick yes or no is totally fine: did you need medical treatment after the accident?",
    day_4_am: "Hey [NAME], William here. I do not want your file to stall when we already started. Did you receive any medical care after the accident?",
    day_4_pm: "Still trying to finish this for you. Were there any doctors, therapy, hospital, or treatment visits after the accident?",
    day_5_am: reengagementTemplates.after_q1[5],
    day_5_pm: "[NAME], this answer can change what options are available. Did you get medical treatment after the accident?",
    day_6_am: "Morning [NAME], quick follow-up: did you see anyone medical after the accident, even just once?",
    day_6_pm: "I can keep this simple: reply yes, no, or not sure. Did you receive medical treatment after the accident?",
    day_7_am: reengagementTemplates.after_q1[7],
    day_7_pm: "Last message from me on this for now, [NAME]. If you did get treatment after the accident, reply yes and I can still help."
  },
  after_call_booking: {
    day_1_am: reengagementTemplates.after_call_booking[1],
    day_1_pm: "Hey [NAME], I can still get a Specialist on the phone with you 📞 What time works best today?",
    day_2_am: reengagementTemplates.after_call_booking[2],
    day_2_pm: "[NAME], the next step is just a quick Specialist call. Are you open now or later today?",
    day_3_am: reengagementTemplates.after_call_booking[3],
    day_3_pm: "Quick check: should I have someone call you today, or would tomorrow be better?",
    day_4_am: "Hey [NAME], William here. I do not want you to miss the chance to get answers. What time works for a quick call?",
    day_4_pm: "Still holding this open for you. Send me a time and I can get you connected with a Specialist.",
    day_5_am: "[NAME], I can still help get this on the calendar. Are you available today for a quick call?",
    day_5_pm: "What time should the Specialist call you, [NAME]? Even a rough window works.",
    day_6_am: "Morning [NAME], quick scheduling check: when is a good time for your Specialist call?",
    day_6_pm: "Reply with any time that works today or tomorrow and I can help get the call set.",
    day_7_am: "Hi [NAME], last try on my end for scheduling. Do you still want to speak with a Specialist?",
    day_7_pm: "Last message from me on this for now. If you still want help, send me a time that works for a call."
  }
};

const warmFollowUpTemplates = {
  needs_fault_answer: {
    1: "Hey [NAME], quick check 🙌 were you at fault for the accident, or was it the other driver?",
    2: "I just need this one answer to know where to point you. Were you at fault, not at fault, or not sure?",
    3: "We were right at the first detail. Even if it was partly your fault, that helps me understand it. Were you at fault?",
    4: "Last check for now - were you at fault for the accident, yes, no, or not sure?",
    5: "[NAME], I do not want this to stall if there is something here. Were you at fault for the accident?",
    6: "I am going to pause after this for now, but I still need this one answer: were you at fault?"
  },
  needs_medical_answer: {
    1: "Hey [NAME], quick check 🤕 did you need any medical treatment after the accident?",
    2: "This is the main thing I need to know before I can point you in the right direction. Did you see a doctor or get treatment?",
    3: "We were close to having enough info. Even if it was urgent care, chiro, or one doctor visit, did you get checked out?",
    4: "Last check for now - did you receive any medical treatment after the accident, yes or no?",
    5: "[NAME], I do not want this to stall if there is a real claim here. Did you get any medical care after the accident?",
    6: "I am going to pause after this for now, but I still need this one answer: did you get medical treatment after the accident?"
  },
  needs_call_time: {
    1: "Hey [NAME], I can still get you connected 📞 Are you open for a call now or later today?",
    2: "The Specialist call is the next step. What time today works best?",
    3: "I do not want you to miss the window to get answers. Can we get you on a quick call today?",
    4: "Last check for now - should I have a Specialist call you now or later today?",
    5: "[NAME], I can still hold this open. What time works for a quick Specialist call?",
    6: "I am going to pause after this for now. If you want the call, send me a time that works."
  }
};

const reminderTemplates = {
  nextDayEvening: "Hey [NAME]! 👋 Just a quick reminder — you have a call scheduled with your ASD Specialist tomorrow at [TIME]. They'll be calling from a local number so don't let it go to voicemail! Looking forward to getting you some answers 💪",
  nextDayOneHour: "Hi [NAME], William here! Your call with your Specialist is in about an hour at [TIME] ⏰ Just making sure you're still good for it. Reply YES to confirm or let me know if you need to reschedule!",
  nextDayFiveMinutes: "[NAME] your Specialist is calling you in 5 minutes! 📞 Pick up even if the number looks unfamiliar — that's them. You're almost at the finish line! 🏁",
  sameDayOneHour: "Hey [NAME]! Your call is coming up in about an hour at [TIME] ⏰ Still good to go? Reply YES to confirm or let me know if you need to push it back!",
  sameDayFiveMinutes: "[NAME] — your Specialist is calling in 5 minutes! 📞 Pick up even if the number looks unfamiliar, that's them. Can't wait to get you some clarity on your case 💪"
};

const missedCallTemplates = {
  after10Minutes: "Hey [NAME], looks like we just missed each other! Our Specialist tried calling at [TIME] but couldn't get through. No worries at all — can we get you rescheduled? What time works best for you today or tomorrow?",
  after3Hours: "Hi [NAME], William here. Just wanted to make sure you didn't miss out — we had a Specialist standing by for you earlier. It only takes about 10 minutes and could make a real difference for your case. When can we try again?",
  nextDay: "Hey [NAME] 👋 — I know we missed yesterday but I don't want you to lose your spot. Our Specialists book up fast and I held yours as long as I could. Can I get you back on the calendar today?"
};

function render(template, contact, extra = {}) {
  const values = {
    NAME: contact.name || "there",
    TIME: extra.time || contact.preferredCallTime || "",
    "PRIMARY TIME": extra.primaryTime || contact.preferredCallTime || "",
    "BACKUP TIME": extra.backupTime || contact.backupCallTime || ""
  };
  return template.replace(/\[([A-Z ]+)\]/g, (_, key) => values[key] ?? "");
}

module.exports = {
  coldOutreachTemplates,
  qualificationTemplates,
  reengagementTemplates,
  persistentReengagementTemplates,
  warmFollowUpTemplates,
  reminderTemplates,
  missedCallTemplates,
  render
};
