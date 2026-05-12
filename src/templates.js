const coldOutreachTemplates = {
  day_1_am: "Hi [NAME]! 👋👋 It's William from Accident Support Desk, I was looking over your accident info and it looks very similar to another accident we just settled for a pretty significant amount. I think we can help show you how to do the same, just had a few quick questions for us to understand the situation a bit better. We can handle this over text message real quick, should only take a minute. Do you remember the date of the accident?",
  day_1_pm: "Hey [NAME], William here. Before I close this out for today, I wanted to make sure you had a chance to check your options. People often leave money on the table because they wait or talk to insurance too early. What was the date of the accident?",
  day_2_am: "Hi [NAME] 👋, William here. I know getting a message out of nowhere feels weird but I genuinely think you might be sitting on more than you realize. People in accidents like yours often don't know what they qualify for until someone walks them through it. What was the date of the accident?",
  day_2_pm: "William from Accident Support Desk here. Some of what you shared looks like the insurance company may already be using tactics against you. I can help you get ahead of it, just need one detail. What was the date of the accident?",
  day_3_am: "Hey [NAME] 🤔, quick honest question. Has the other driver's insurance reached out to you yet? If they have, there's a reason for that and it's not in your favor. I can explain what's happening on their end. Just need to know, were you at fault?",
  day_3_pm: "Hey [NAME]! it's William. Based on the info you gave, there might be some injury-related protections you qualify for if we act quickly. I can check for you real fast. What was the date of the accident?",
  day_4_am: "Hi [NAME], it's William. I've been doing this long enough to know that the people who wait the longest usually end up with the least. Not trying to scare you just being honest. Did you need to see a doctor after the accident at all?",
  day_4_pm: "Hi [NAME], William again. I noticed you might be missing out on lost wage compensation it's something people often overlook. A couple quick questions will tell us for sure. What was the date of the accident?",
  day_5_am: "Hey [NAME] 👋 William here. Were there any passengers in your car when the accident happened? That detail actually matters more than most people think for how a claim gets valued.",
  day_5_pm: "Hi [NAME], it's William. Just thinking, even if you feel mostly okay physically, there can be things that show up later that you'd want documented now. Did you have any pain or soreness after the accident, even minor?",
  day_6_am: "Hey [NAME], William from Accident Support Desk. I still have your file open and I keep coming back to it. What was the date of the accident?",
  day_6_pm: "[NAME], no pressure here at all. I just don't want you looking back in 6 months wishing you'd asked. Were you at fault for the accident?",
  day_7_am: "Hey [NAME], William here. Haven't heard back so I wasn't sure if you still wanted help with the accident stuff. If you do, what was the date of the accident?",
  day_7_pm: "Hi [NAME], wrapping up the week and still have your file open. Were you injured in the accident at all, even something that seemed minor at the time?",
  day_8_am: "Hey [NAME] ⏳, William here. New week, wanted to start fresh. There's a legal deadline on accident claims and once it passes there's nothing I or anyone else can do for you. What was the date of your accident so I can check where you stand?",
  day_8_pm: "Hi [NAME], William from Accident Support Desk. There's a chance you may qualify for compensation most people don't even know exists in situations like yours. I just need a quick detail to double-check. What was the date of the accident?",
  day_9_am: "[NAME], real talk. Insurance companies have entire teams whose job is to pay you as little as possible. I'm on the other side of that. I want to make sure you're not walking away from something you're actually owed. Were you at fault for the accident?",
  day_9_pm: "[NAME]!, William here, I'm looking at your file and you might qualify for additional property damage support depending on the timeline. Quick question: what was the date of the accident?",
  day_10_am: "Hi [NAME], it's William. Something I haven't asked yet, was there a police report filed after your accident? That one detail can make a big difference in what you're able to claim.",
  day_10_pm: "Hi [NAME], it's William. I know things get hectic, but I didn't want you to miss out on the help you might qualify for. Can you send me the date of the accident real quick?",
  day_11_am: "Hey [NAME] 💰, I'll be straight with you. I've seen people in similar situations get $40k, $80k, even more. I've also seen people get nothing because they waited too long. I'd hate for that to be you. What was the date of the accident?",
  day_11_pm: "Hi [NAME], William here. Did the accident affect you emotionally at all, anxiety driving, trouble sleeping, anything like that? That's actually compensable and most people never think to mention it.",
  day_12_am: "[NAME], William from Accident Support Desk. Quick thing, was anyone else injured in the accident? Not just you, but any passengers or the other driver? Helps me understand the full picture.",
  day_12_pm: "Hey [NAME] ❤️, I genuinely hope you're doing okay. Accidents take more out of people than they realize, physically and mentally. If you want to explore your options, I'm still here. Just reply with the date of the accident.",
  day_13_am: "Hi [NAME], it's William. I've been in this field a long time and I can tell when a case has real potential. Yours does. But I can only help if you respond. What was the date of the accident?",
  day_13_pm: "[NAME], one thing I haven't mentioned: even if you already settled something small with insurance, you may still have options. Did you sign anything with the insurance company after the accident?",
  day_14_am: "Hey [NAME], William here. I'll stop reaching out if you don't feel like you need guidance with your case value anymore. Did you still want some help, or should I close your file?",
  day_14_pm: "Hi [NAME], it's William. Two weeks in and I keep coming back to your file. I'd rather ask one more time than not. What was the date of the accident?",
  day_15_am: "Hey [NAME] 👋, William here. Starting week three, I know that's a lot of messages. I wouldn't keep going if I didn't genuinely think this was worth your time. Were you at fault for the accident?",
  day_15_pm: "[NAME], no guilt if you're not interested, I promise. I just want to make sure you made that choice knowingly and not because life got in the way. Still open to helping if you want it.",
  day_16_am: "Hi [NAME], William again. I've reached out a few times and wasn't sure if you were still needing help with everything going on.",
  day_16_pm: "Hey [NAME], did you ever wonder what your accident claim might actually be worth? Most people assume it's not much. They're usually wrong. I can give you a rough idea in literally two questions.",
  day_17_am: "Hi [NAME], William here. I've worked with a lot of people who were skeptical at first, thought nothing would come of it. A lot of them were really glad they responded. What was the date of your accident?",
  day_17_pm: "[NAME], I'm not going to pretend I'm not following up again. I am. Because I've seen what happens when people act and when they don't. Were you injured at all?",
  day_18_am: "Hey [NAME], William here. Before I stop reaching out I wanted to check one last time, some timelines in accident cases really do matter. What was the date of the accident?",
  day_18_pm: "Hi [NAME], it's William. If you already got help, or you're just not interested, just let me know either way and I'll stop reaching out. No hard feelings at all.",
  day_19_am: "[NAME] 🙏, William from Accident Support Desk. I keep thinking about this: people who've been in accidents are already dealing with enough. So I'll make it simple: yes or no, do you want me to take a look at your situation?",
  day_19_pm: "Hey [NAME], most people who don't respond aren't uninterested, life just gets busy. If that's you, I get it. I'm still here when you have a minute.",
  day_20_am: "Hi [NAME], William here. I've got a few cases I'm wrapping up this week and yours has been on my mind. What was the date of the accident?",
  day_20_pm: "[NAME], I've been doing this a long time. I've seen people get help they never expected and I've seen people miss out entirely. One last real push from me, were you at fault for the accident?",
  day_21_am: "Hey [NAME] 💬, it's William. I've reached out every day for three weeks because I believed there was something worth fighting for in your file. I still do. If you want help, I'm here. If not, I'll stop, no hard feelings. Just reply yes or no.",
  day_21_pm: "Hey [NAME], it's William. This will be my last message so I don't keep bothering you. Before I close out your file, let me know if you still wanted some help. Just needed to confirm a few details."
};

const qualificationTemplates = {
  fault: "So glad you got back to me, [NAME]! 🙌 Really quick just to understand your situation: were you at fault for the accident, or was it the other driver?",
  medical: "Have you needed to see any doctors or receive any medical treatment after the accident? 🤕",
  callAsk: "Based on what you’ve shared, we can definitely help you out! 💰 The next step is to connect you with an Accident Support Desk Specialist who can create a compensation gameplan for you. Are you open for a call now or later today? 📞",
  clarify: "I want to make sure I understood you correctly 🙏 Can you answer that last question with a quick yes, no, or not sure?",
  optOutConfirm: "No problem, we won't text you again. If you change your mind, please feel free to reach back out.",
  existingRepresentation: "No worries at all 🙏 We're always here to help. If you ever feel unsatisfied or unhappy with your current representation, please feel free to reach back out any time. We'd be happy to give you a second opinion on your case and see if we can help.",
  injuryContextCallAsk: "Got it, that definitely matters 🤕 Even if you have not treated yet, injuries are important. The next step is getting you with a Specialist. What time works best for a quick call today or tomorrow? 📞",
  callNowNoAnswer: "Hey [NAME], looks like we just tried giving you a call but missed you. No worries if you're busy 🙏 What time works best later today or tomorrow so we can reach you? 📞",
  callNow: "Perfect! 🔥 I'm connecting you with a Specialist right now, you should be getting a call within the next few minutes. Make sure your phone is on and available. What's the best number to reach you at?",
  delay: "So sorry for the small wait, our Specialist is just finishing up with another client. You're next, should be calling within the next 3-5 minutes! 📞",
  backupAsk: "Perfect, I've got you down for [TIME]! 📅 Just to make sure we don't miss each other, is there a backup time that works too, just in case something comes up on either end?",
  bookingConfirmedWithBackup: "Got it, [PRIMARY TIME] with [BACKUP TIME] as a backup. You're all set [NAME]! 🙌 Our Specialist will call from a local number so make sure to pick up even if you don't recognize it. We'll remind you before your call!",
  bookingConfirmedNoBackup: "No worries, I did not get a backup time from you, so I’ll keep you locked in for [TIME]. 📅 We’ll send you a reminder before the call. If you need to reschedule, just text me a better time.",
  noShowRebookConfirmed: "Perfect, I got you rebooked for [TIME] 📅 If something changes, just text me and we can adjust it. Our Specialist will call from a local number, so please keep your phone close.",
  sameDayBooked: "Locked you in for [TIME] today! 📅 Our Specialist will be calling from a local number so keep your phone close.",
  rescheduleAsk: "No problem 👍 What new time works best for your call today or tomorrow?",
  rescheduleNeedsSpecificTime: "No problem 👍 What specific time should I move your call to?",
  rescheduleConfirmed: "Done, I moved your Specialist call to [TIME]. 📅 We'll send you a reminder before the call, and they'll call from a local number."
};

const humanReturnTemplates = {
  needs_fault_answer: "Hey [NAME], still here with me? 🙏 I want to make sure we do not lose momentum on your case. Quick question so I know how to point you in the right direction: were you at fault, or was it the other driver?",
  needs_medical_answer: "Hey [NAME], still here with me? 🙏 I want to make sure we can help you the right way. Did you need any medical treatment after the accident, even just urgent care, ER, chiro, or one doctor visit? 🤕",
  needs_call_time: "Hey [NAME], still here with me? 🙏 I want to help get you connected so you can get answers on your case. What time works best for a quick Specialist call? 📞"
};

const freshLeadFollowUpTemplates = {
  1: "Hey [NAME] 👋 just checking that my last text came through. The accident date helps me see what options may still be open for you and whether timing could affect your claim.",
  2: "[NAME], one thing I do not want is for you to wait too long and accidentally hurt your claim 🤕 What date did the accident happen? Even a rough date is fine.",
  3: "Quick question, [NAME] 🙏 has the insurance company reached out to you yet? If they have, that may not be in your favor. They often try to get statements or details before you know what your claim may be worth.",
  4: "No worries if you're busy. I still have your file open and I want to make sure you do not miss compensation you may be entitled to 💰 What was the date of the accident?"
};

const reengagementTemplates = {
  after_date: {
    1: "Hey [NAME], William here 🙌 I saved the accident date, so we do not need to start over. Quick thing: were you at fault, or was it the other driver?",
    2: "Hi [NAME], I still have your file open. The fault detail helps me know how strong this may be. Was it your fault, the other driver's, or are you not sure?",
    3: "[NAME], even if it was partly your fault, that still helps me understand the case. Who do you believe caused the accident?",
    5: "Hey [NAME], I do not want to lose the progress we already made. Just reply with at fault, not at fault, or not sure 🙏",
    7: "Last check on this for now, [NAME]. If you still want help, send me who was at fault and I can keep this moving."
  },
  after_q1: {
    1: "Hey [NAME], William here 🤕 you already answered the fault part, so we are close. Did you get checked out or receive any medical treatment after the accident?",
    2: "Hi [NAME], quick follow-up. Even one ER, urgent care, chiro, therapy, or doctor visit can matter. Did you get any treatment after the accident?",
    3: "[NAME], this is usually the detail that helps a Specialist understand what options you may have. Did you see anyone medical after the accident?",
    5: "Hey [NAME], I do not want your file to stall when we already started. Did you receive any medical care, even if it was just one visit?",
    7: "Last check from me on this, [NAME]. If you got medical treatment after the accident, reply yes. If not, reply no."
  },
  after_call_booking: {
    1: "Hey [NAME] 👋 we were right at the point of getting you connected. What time works best for a quick Specialist call?",
    2: "Hi [NAME], William here. The call is usually quick, about 10 minutes, and can help you understand your options 📞 What time today or tomorrow works?",
    3: "[NAME], I do not want this to fall through after you already shared enough for us to help. Send me a good call time and I’ll try to get you locked in."
  }
};

const persistentReengagementTemplates = {
  after_date: {
    day_1_am: reengagementTemplates.after_date[1],
    day_1_pm: "Hey [NAME], I still just need the fault detail 🙏 Was it your fault, the other driver's, or are you unsure?",
    day_2_am: reengagementTemplates.after_date[2],
    day_2_pm: "[NAME], this does not need to be perfect. Your best understanding is enough. Who caused the accident?",
    day_3_am: reengagementTemplates.after_date[3],
    day_3_pm: "Quick reply is fine: at fault, not at fault, or not sure?",
    day_4_am: "Hey [NAME], William here. I have your accident date saved. I just need to know who was at fault so I can point this the right way.",
    day_4_pm: "Still trying to finish this for you. Were you the driver who caused it, or was it someone else?",
    day_5_am: reengagementTemplates.after_date[5],
    day_5_pm: "[NAME], the fault answer can affect what compensation options may be available. What is your best answer on who caused the accident?",
    day_6_am: "Morning [NAME], quick check: did the other driver cause the accident, or were you at fault?",
    day_6_pm: "I can keep this simple: reply with me, them, both, or not sure.",
    day_7_am: reengagementTemplates.after_date[7],
    day_7_pm: "Last message from me on this for now. If you still want help, reply with who was at fault."
  },
  after_q1: {
    day_1_am: reengagementTemplates.after_q1[1],
    day_1_pm: "Hey [NAME], I still only need this one piece 🤕 did anyone medical check you after the accident?",
    day_2_am: reengagementTemplates.after_q1[2],
    day_2_pm: "[NAME], pain can show up later too. Did you go to the ER, urgent care, chiro, therapy, or any doctor after the accident?",
    day_3_am: reengagementTemplates.after_q1[3],
    day_3_pm: "Quick yes or no is totally fine: did you get any medical care after the accident?",
    day_4_am: "Hey [NAME], William here. We already know the fault piece, so I just need the treatment piece. Did you get checked out?",
    day_4_pm: "Still trying to finish this for you. Any hospital, doctor, therapy, chiro, or treatment visits after the accident?",
    day_5_am: reengagementTemplates.after_q1[5],
    day_5_pm: "[NAME], this answer can change what options may be available. Did you receive any medical treatment or evaluation?",
    day_6_am: "Morning [NAME], quick follow-up: did you see anyone medical after the accident, even one time?",
    day_6_pm: "I can keep this simple: reply treated, not treated, or not sure.",
    day_7_am: reengagementTemplates.after_q1[7],
    day_7_pm: "Last message from me on this for now, [NAME]. If you did get treatment after the accident, reply yes and I can still help."
  },
  after_call_booking: {
    day_1_am: reengagementTemplates.after_call_booking[1],
    day_1_pm: "Hey [NAME], I can still get a Specialist on the phone with you 📞 What time today works best?",
    day_2_am: reengagementTemplates.after_call_booking[2],
    day_2_pm: "[NAME], if today got busy, no problem. What time tomorrow would be easier for a quick call?",
    day_3_am: reengagementTemplates.after_call_booking[3],
    day_3_pm: "Quick check: would morning, afternoon, or evening be better for the Specialist to call?",
    day_4_am: "Hey [NAME], William here. I do not want you to miss the chance to get answers. Send me a time that works for a quick call.",
    day_4_pm: "Still holding this open for you. Even a rough window like after 2 or tomorrow morning helps me get you connected.",
    day_5_am: "[NAME], I can still help get this on the calendar. What time should I try to reserve for you?",
    day_5_pm: "What time should the Specialist call you, [NAME]? A specific time is best, but a small window works too.",
    day_6_am: "Morning [NAME], quick scheduling check: is there a better day or time for your Specialist call?",
    day_6_pm: "Reply with any time that works today or tomorrow and I can help get the call set 📞",
    day_7_am: "Hi [NAME], last try on my end for scheduling. Do you still want to speak with a Specialist about your case?",
    day_7_pm: "Last message from me on this for now. If you still want help, send me a good call time and I’ll try to get you back on the calendar."
  }
};

const warmFollowUpTemplates = {
  needs_fault_answer: {
    1: "Hey [NAME], quick check 🙌 was the accident your fault, the other driver's, or are you not sure?",
    2: "This answer helps me know how to point you. Who do you believe caused the accident?",
    3: "Even if it was partly your fault, that still matters. Would you say it was you, them, both, or not sure?",
    4: "I have the date saved, just need the fault piece now. Were you at fault or was someone else?",
    5: "[NAME], I do not want this to stall if there is something here. Reply at fault, not at fault, or not sure.",
    6: "I am going to pause after this for now. If you still want help, send me who was at fault and I’ll keep it moving."
  },
  needs_medical_answer: {
    1: "Hey [NAME], quick check 🤕 did you get checked out or receive any medical treatment after the accident?",
    2: "This helps me understand what options you may have. Did you go to the ER, urgent care, chiro, therapy, or a doctor?",
    3: "Even one medical visit can matter here. Did anyone treat or evaluate you after the accident?",
    4: "We are close to having enough info. Did you receive medical care after the accident, yes or no?",
    5: "[NAME], I do not want this to stall if there is a real claim here. Did you get any treatment or medical evaluation?",
    6: "I am going to pause after this for now. If you got treatment, reply yes. If not, reply no."
  },
  needs_call_time: {
    1: "Hey [NAME], I can still get you connected today 📞 What time works best for a quick call?",
    2: "The call is quick, usually around 10 minutes. Would now, later today, or tomorrow work better?",
    3: "I do not want you to miss the window to get answers 💰 Send me a time that works and I’ll try to get you locked in.",
    4: "Still here with you, [NAME] 🙏 If today is busy, no problem. What time today or tomorrow should I put you down for?",
    5: "We already have enough to get you connected with a Specialist. What time should they call you?",
    6: "Last check for today, [NAME]. I do not want to keep bothering you, but I also do not want you to miss out. Reply with a good call time and I’ll help set it up."
  },
  needs_call_time_specific: {
    1: "Got it, later works 👍 What exact time should I put you down for?",
    2: "I just need the actual time so I do not guess wrong. What time works best for your Specialist call? 📞",
    3: "[NAME], I can still get this scheduled. Send me the exact time that works today or tomorrow.",
    4: "Quick check, should I aim for afternoon, evening, or a specific time?",
    5: "I do not want this to fall through. What exact call time works for you?",
    6: "I am going to pause after this for now. When you are ready, send me the exact time you want the call."
  }
};

const reminderTemplates = {
  nextDayEvening: "Hey [NAME]! 👋 Just a quick reminder, you have a call scheduled with your Accident Support Desk Specialist tomorrow at [TIME]. They'll call from a local number, so keep your phone close 📞",
  nextDayMorning: "Good morning [NAME]! 👋 Quick reminder, you have a call scheduled with your Accident Support Desk Specialist today at [TIME]. They'll call from a local number, so please keep your phone close 💪",
  nextDayOneHour: "Hi [NAME], William here! Quick reminder, your Specialist call is in about an hour at [TIME] ⏰ They'll call from a local number, so please keep your phone close.",
  nextDayFiveMinutes: "[NAME] your Specialist is calling you in 5 minutes! 📞 Pick up even if the number looks unfamiliar, that's them. You're almost at the finish line! 🏁",
  sameDayOneHour: "Hey [NAME]! Quick reminder, your Specialist call is coming up in about an hour at [TIME] ⏰ They'll call from a local number, so please keep your phone close.",
  sameDayFiveMinutes: "[NAME], your Specialist is calling in 5 minutes! 📞 Pick up even if the number looks unfamiliar, that's them. Can't wait to get you some clarity on your case 💪"
};

const missedCallTemplates = {
  after10Minutes: "Hey [NAME], looks like we just missed each other! Our Specialist tried calling at [TIME] but couldn't get through. No worries at all, can we get you rescheduled? What time works best for you today or tomorrow?",
  after3Hours: "Hi [NAME], William here. Just wanted to make sure you didn't miss out, we had a Specialist standing by for you earlier. It only takes about 10 minutes and could make a real difference for your case. When can we try again?",
  nextDay: "Hey [NAME] 👋, I know we missed yesterday but I don't want you to lose your spot. Our Specialists book up fast and I held yours as long as I could. Can I get you back on the calendar today?"
};

const noShowTemplates = {
  same_day_now: "Hey [NAME], looks like we just missed you for your Specialist call at [TIME] 📞 No worries, I still want to help you get answers. What time can we try you again today?",
  same_day_15: "[NAME], I do not want you to miss the chance to understand what compensation you may be entitled to after the accident 💰 Can I get you back on the calendar today?",
  same_day_60: "Quick check, [NAME] 🙏 our Specialist had time set aside for you. If something came up, no problem. What time works later today for a quick 5-minute call?",
  same_day_120: "[NAME], medical treatment and timing can matter a lot after an accident. I want to make sure you do not lose momentum. Can we try your Specialist call again today?",
  same_day_240: "Still here, [NAME]. You already made it to the call step, so I do not want your file to go cold now. Reply with a time today or tomorrow and I’ll help get you rescheduled 📞",
  same_day_360: "Last check for today, [NAME]. I do not want you missing out if there is compensation available for your accident. What time should we call you back?",
  day_2_am: "Good morning [NAME] 👋 you may be entitled to more than you realize after the accident. We missed your call, but I can still get you a free 5-minute consultation. What time works today?",
  day_2_pm: "[NAME], has the insurance company reached out yet? If so, it is worth talking before accepting anything too quickly. Can we get your Specialist call rescheduled today?",
  day_3_am: "Hey [NAME], I know this can feel stressful and confusing. We have helped a lot of people in similar situations understand what they may qualify for. What time can we try your free consultation?",
  day_3_pm: "[NAME], you might be sitting on compensation you do not even know you are entitled to 💰 The call only takes a few minutes. What time today or tomorrow works?",
  day_4_am: "[NAME], quick follow-up from Accident Support Desk. We missed your scheduled call, but your accident situation may still be worth reviewing. What time can a Specialist call?",
  day_4_pm: "Insurance companies do not always explain every option, [NAME]. Before you move forward alone, let us give you a free breakdown. What time works for a quick call? 📞",
  day_5_am: "Morning [NAME], I know it might feel scary dealing with all this after an accident. The consultation is free and only takes about 5 minutes. Can we reschedule your call today?",
  day_5_pm: "[NAME], I do not want your file to go cold after you already had a call scheduled. You may still have options. Are you available today or tomorrow?",
  day_6_am: "Hey [NAME] 👋 we can still get you answers. If you had treatment, pain, or insurance pressure, it is worth a quick conversation. What time works?",
  day_6_pm: "Checking once more, [NAME]. A quick Specialist call can help explain what compensation you might qualify for. Reply with a time and I’ll get you rescheduled.",
  day_7_am: "Hi [NAME], I know we missed the call, but your situation may still be worth reviewing. Do you still want a free consultation about your accident?",
  day_7_pm: "[NAME], if the insurance company has reached out, be careful with early offers. You may not know the full value yet. What time can a Specialist call?",
  day_8_am: "Good morning [NAME] 🙏 I still want to make sure you do not miss a possible compensation window. Can we get your Specialist call rescheduled today?",
  day_8_pm: "[NAME], your file is still open on my end. We have helped people in similar accidents get clarity fast. Send me a time that works and I’ll help rebook you.",
  day_9_am: "Hey [NAME], accident symptoms can show up or get worse later. If you had any treatment or pain, it is worth getting answers. Can we try your Specialist call again today?",
  day_9_pm: "Quick follow-up, [NAME]. The call is just to review your options and see what help may be available. What time works for you?",
  day_10_am: "[NAME], I do not want you looking back wishing you had checked your options sooner. The consultation is free. Can we reschedule your Specialist call?",
  day_10_pm: "Still available to help, [NAME]. If today is not good, send me a better time for tomorrow and I’ll work around it.",
  day_11_am: "Good morning [NAME] 👋 I’m still trying to help you get clarity on your accident claim. What time should a Specialist call?",
  day_11_pm: "[NAME], this only takes a few minutes. If you still want to know what your case may qualify for, reply with a time that works.",
  day_12_am: "Hey [NAME], I know life gets busy. I just do not want this missed call to be the reason you lose out on help. Can we try again today?",
  day_12_pm: "[NAME], if you are still dealing with pain, treatment, or insurance issues, it is worth getting answers. What time can we call?",
  day_13_am: "Morning [NAME]. We were already at the call step, so I know this was important at some point. Should I get you back on the calendar?",
  day_13_pm: "[NAME], you may have options you have not been told about yet. Let us give you a free second look. Reply with a time today or tomorrow.",
  day_14_am: "Hey [NAME], last day I’ll keep pushing on this. Do you still want a Specialist to call you about your accident case?",
  day_14_pm: "Last message from me for now, [NAME]. If you want help, send me a call time and we’ll try to get you back on the calendar 📞"
};

const backupReminderTemplates = {
  afterPrimaryMissed: "Hey [NAME], looks like we missed you at [PRIMARY TIME] 📞 No worries, I still have your backup time as [BACKUP TIME]. We'll try you then. If that no longer works, text me a better time.",
  thirtyBefore: "Quick reminder [NAME], we're going to try you at your backup time around [BACKUP TIME] 📞 Keep your phone close.",
  fiveBefore: "[NAME], your backup call time is coming up in about 5 minutes 📞 Please pick up even if the number looks unfamiliar."
};

const spanishTemplates = {
  coldOutreachTemplates: {
    day_1_am: "Hola [NAME]! 👋👋 Soy William de Accident Support Desk. Estaba revisando la información de tu accidente y parece muy similar a otro caso que acabamos de resolver por una cantidad importante. Creo que podemos ayudarte a ver si tienes opciones parecidas. Podemos hacerlo rápido por texto, solo necesito unos detalles. ¿Recuerdas la fecha del accidente?",
    day_1_pm: "Hola [NAME] 🤕 esperar más tiempo puede afectar tu reclamo. Quiero ayudarte a tener una idea clara de tus opciones de compensación. Solo necesito un detalle para empezar. ¿Cuál fue la fecha del accidente?",
    day_2_am: "Hola [NAME] 👋, soy William. Sé que recibir un mensaje así puede sentirse raro, pero de verdad creo que podrías tener más opciones de las que piensas. Muchas personas no saben para qué califican hasta que alguien las orienta. ¿Cuál fue la fecha del accidente?",
    day_2_pm: "Soy William de Accident Support Desk. Parte de lo que compartiste parece indicar que la aseguranza podría estar usando tácticas en tu contra. Puedo ayudarte a adelantarte a eso, solo necesito un dato. ¿Cuál fue la fecha del accidente?",
    day_3_am: "Hola [NAME] 🤔, pregunta rápida y honesta. ¿La aseguranza del otro conductor ya se comunicó contigo? Si lo hicieron, hay una razón y normalmente no es a tu favor. Para orientarte mejor, ¿fuiste culpable del accidente?",
    day_3_pm: "Hola [NAME]! Soy William. Según la información que diste, puede haber protecciones relacionadas con lesiones si actuamos rápido. Puedo revisarlo contigo. ¿Cuál fue la fecha del accidente?",
    day_4_am: "Hola [NAME], soy William. Llevo suficiente tiempo en esto para saber que quienes esperan demasiado muchas veces terminan recibiendo menos. No quiero asustarte, solo ser honesto. ¿Tuviste que ver a un doctor después del accidente?",
    day_4_pm: "Hola [NAME], William otra vez. Noté que podrías estar perdiendo compensación por salarios perdidos, algo que muchas personas pasan por alto. Un par de preguntas rápidas nos dirán más. ¿Cuál fue la fecha del accidente?",
    day_5_am: "Hola [NAME] 👋 William por aquí. ¿Había pasajeros en tu carro cuando ocurrió el accidente? Ese detalle puede importar más de lo que muchos piensan para valorar un reclamo.",
    day_5_pm: "Hola [NAME], soy William. Incluso si te sientes más o menos bien físicamente, hay cosas que pueden aparecer después y conviene documentarlas. ¿Tuviste dolor o molestia después del accidente, aunque fuera leve?",
    day_6_am: "Hola [NAME], soy William de Accident Support Desk. Todavía tengo tu archivo abierto y sigo pensando en tu caso. ¿Cuál fue la fecha del accidente?",
    day_6_pm: "[NAME], sin presión. Solo no quiero que en 6 meses mires atrás y desees haber preguntado. ¿Fuiste culpable del accidente?",
    day_7_am: "Hola [NAME], William por aquí. No he sabido de ti y no estaba seguro si todavía querías ayuda con lo del accidente. Si sí, ¿cuál fue la fecha del accidente?",
    day_7_pm: "Hola [NAME], estoy cerrando la semana y todavía tengo tu archivo abierto. ¿Tuviste alguna lesión en el accidente, aunque pareciera menor en ese momento?",
    day_8_am: "Hola [NAME] ⏳, William por aquí. Nueva semana, quería empezar de nuevo. Hay límites de tiempo legales en reclamos de accidente y cuando pasan ya no se puede hacer mucho. ¿Cuál fue la fecha de tu accidente para revisar dónde estás?",
    day_8_pm: "Hola [NAME], William de Accident Support Desk. Existe la posibilidad de que califiques para compensación que muchas personas ni siquiera saben que existe. Solo necesito un detalle rápido para revisar. ¿Cuál fue la fecha del accidente?",
    day_9_am: "[NAME], te hablo claro. Las aseguranzas tienen equipos completos cuyo trabajo es pagarte lo menos posible. Yo estoy del otro lado de eso. Quiero asegurarme de que no dejes pasar algo que te corresponde. ¿Fuiste culpable del accidente?",
    day_9_pm: "Hola [NAME], William por aquí. Estoy viendo tu archivo y quizá calificas para ayuda adicional por daños al vehículo dependiendo del tiempo. Pregunta rápida: ¿cuál fue la fecha del accidente?",
    day_10_am: "Hola [NAME], soy William. Algo que no te he preguntado: ¿se hizo un reporte policial después del accidente? Ese detalle puede cambiar bastante lo que puedes reclamar.",
    day_10_pm: "Hola [NAME], soy William. Sé que la vida se complica, pero no quería que perdieras ayuda para la que quizá calificas. ¿Me puedes mandar rápido la fecha del accidente?",
    day_11_am: "Hola [NAME] 💰, te lo digo directo. He visto personas en situaciones similares recibir $40k, $80k o más. También he visto personas quedarse sin nada por esperar demasiado. No quisiera que eso te pase. ¿Cuál fue la fecha del accidente?",
    day_11_pm: "Hola [NAME], William por aquí. ¿El accidente te afectó emocionalmente, como ansiedad al manejar, problemas para dormir o algo parecido? Eso también puede importar y muchas personas no lo mencionan.",
    day_12_am: "[NAME], William de Accident Support Desk. Pregunta rápida: ¿alguien más resultó lesionado en el accidente? No solo tú, también pasajeros o el otro conductor. Me ayuda a entender el panorama completo.",
    day_12_pm: "Hola [NAME] ❤️, de verdad espero que estés bien. Los accidentes afectan más de lo que uno piensa, física y mentalmente. Si quieres revisar tus opciones, sigo aquí. Solo responde con la fecha del accidente.",
    day_13_am: "Hola [NAME], soy William. Llevo mucho tiempo en este campo y puedo notar cuando un caso tiene potencial real. El tuyo puede tenerlo, pero solo puedo ayudar si respondes. ¿Cuál fue la fecha del accidente?",
    day_13_pm: "[NAME], algo que no mencioné: incluso si ya aceptaste algo pequeño de la aseguranza, puede que todavía tengas opciones. ¿Firmaste algo con la aseguranza después del accidente?",
    day_14_am: "Hola [NAME], William por aquí. Dejo de escribirte si sientes que ya no necesitas orientación sobre el valor de tu caso. ¿Todavía quieres ayuda o cierro tu archivo?",
    day_14_pm: "Hola [NAME], soy William. Ya van dos semanas y sigo regresando a tu archivo. Prefiero preguntarte una vez más que dejarlo pasar. ¿Cuál fue la fecha del accidente?",
    day_15_am: "Hola [NAME] 👋, William por aquí. Empezando la tercera semana. Sé que han sido varios mensajes, pero no seguiría si no pensara que vale tu tiempo. ¿Fuiste culpable del accidente?",
    day_15_pm: "[NAME], sin culpa si no te interesa, de verdad. Solo quiero asegurarme de que tomaste esa decisión sabiendo tus opciones y no porque la vida se ocupó. Sigo disponible si quieres ayuda.",
    day_16_am: "Hola [NAME], William otra vez. Te he escrito algunas veces y no estaba seguro si todavía necesitas ayuda con todo esto.",
    day_16_pm: "Hola [NAME], ¿alguna vez te preguntaste cuánto podría valer realmente tu reclamo de accidente? Muchas personas piensan que no es mucho. Casi siempre se equivocan. Te puedo dar una idea inicial con literalmente dos preguntas.",
    day_17_am: "Hola [NAME], William por aquí. He trabajado con muchas personas que al principio dudaban y pensaban que no pasaría nada. Muchas terminaron agradecidas de haber respondido. ¿Cuál fue la fecha de tu accidente?",
    day_17_pm: "[NAME], no voy a fingir que no estoy dando seguimiento otra vez. Lo hago porque he visto lo que pasa cuando la gente actúa y cuando no. ¿Tuviste alguna lesión?",
    day_18_am: "Hola [NAME], William por aquí. Antes de dejar de escribirte quería revisar una última vez, algunos plazos en casos de accidente sí importan mucho. ¿Cuál fue la fecha del accidente?",
    day_18_pm: "Hola [NAME], soy William. Si ya recibiste ayuda o simplemente no te interesa, dime y dejo de escribirte. Sin problema.",
    day_19_am: "[NAME] 🙏, William de Accident Support Desk. Lo sigo pensando: las personas que han tenido accidentes ya están lidiando con bastante. Lo hago simple: sí o no, ¿quieres que revise tu situación?",
    day_19_pm: "Hola [NAME], muchas personas que no responden no es que no estén interesadas, solo están ocupadas. Si ese es tu caso, lo entiendo. Sigo aquí cuando tengas un minuto.",
    day_20_am: "Hola [NAME], William por aquí. Estoy cerrando algunos casos esta semana y el tuyo sigue en mi mente. ¿Cuál fue la fecha del accidente?",
    day_20_pm: "[NAME], llevo mucho tiempo haciendo esto. He visto personas recibir ayuda que no esperaban y también perderla por completo. Un último intento real de mi parte: ¿fuiste culpable del accidente?",
    day_21_am: "Hola [NAME] 💬, soy William. Te he escrito todos los días por tres semanas porque creí que había algo en tu archivo que valía la pena pelear. Todavía lo creo. Si quieres ayuda, aquí estoy. Si no, dejo de escribirte. Solo responde sí o no.",
    day_21_pm: "Hola [NAME], soy William. Este será mi último mensaje para no seguir molestando. Antes de cerrar tu archivo, dime si todavía querías ayuda. Solo necesito confirmar unos detalles."
  },
  qualificationTemplates: {
    fault: "Qué bueno que respondiste, [NAME]! 🙌 Rápido para entender tu situación: ¿fuiste culpable del accidente o fue el otro conductor?",
    medical: "¿Has tenido que ver a algún doctor o recibir tratamiento médico después del accidente? 🤕",
    callAsk: "Por lo que me compartiste, definitivamente podemos ayudarte! 💰 El siguiente paso es conectarte con un Especialista de Accident Support Desk para crear un plan de compensación. ¿Puedes tomar una llamada ahora o más tarde hoy? 📞",
    clarify: "Quiero asegurarme de haberte entendido bien 🙏 ¿Puedes responder la última pregunta con un sí, no o no estoy seguro?",
    optOutConfirm: "Sin problema, no te volveremos a escribir. Si cambias de opinión, puedes comunicarte con nosotros cuando quieras.",
    existingRepresentation: "No hay problema 🙏 Siempre estamos aquí para ayudar. Si en algún momento no estás satisfecho con tu representación actual, puedes escribirnos cuando quieras. Con gusto te damos una segunda opinión sobre tu caso para ver si podemos ayudar.",
    injuryContextCallAsk: "Entiendo, eso definitivamente importa 🤕 Incluso si todavía no has recibido tratamiento, las lesiones son importantes. El siguiente paso es conectarte con un Especialista. ¿Qué hora te queda mejor para una llamada rápida hoy o mañana? 📞",
    callNowNoAnswer: "Hola [NAME], parece que acabamos de llamarte pero no pudimos comunicarnos. No hay problema si estás ocupado 🙏 ¿Qué hora te queda mejor más tarde hoy o mañana para poder llamarte? 📞",
    callNow: "Perfecto! 🔥 Te estoy conectando con un Especialista ahora mismo. Deberías recibir una llamada en los próximos minutos. Mantén tu teléfono disponible. ¿Cuál es el mejor número para llamarte?",
    delay: "Perdón por la pequeña espera, nuestro Especialista está terminando con otro cliente. Sigues tú, debería llamarte en unos 3 a 5 minutos! 📞",
    backupAsk: "Perfecto, te tengo anotado para [TIME]! 📅 Para asegurarnos de no perdernos, ¿hay una hora de respaldo que también te funcione por si algo pasa?",
    bookingConfirmedWithBackup: "Listo, [PRIMARY TIME] con [BACKUP TIME] como respaldo. Ya quedaste confirmado, [NAME]! 🙌 Nuestro Especialista llamará desde un número local, así que contesta aunque no reconozcas el número. Te recordaremos antes de la llamada!",
    bookingConfirmedNoBackup: "No hay problema, no recibí una hora de respaldo, así que te dejo confirmado para [TIME]. 📅 Te enviaremos un recordatorio antes de la llamada. Si necesitas cambiar la hora, mándame un mejor horario.",
    noShowRebookConfirmed: "Perfecto, te reagendé para [TIME] 📅 Si algo cambia, mándame mensaje y lo ajustamos. Nuestro Especialista llamará desde un número local, así que mantén tu teléfono cerca.",
    sameDayBooked: "Te confirmé para [TIME] hoy! 📅 Nuestro Especialista llamará desde un número local, así que mantén tu teléfono cerca.",
    rescheduleAsk: "No hay problema 👍 ¿Qué nueva hora te funciona mejor para tu llamada hoy o mañana?",
    rescheduleNeedsSpecificTime: "No hay problema 👍 ¿A qué hora exacta quieres mover tu llamada?",
    rescheduleConfirmed: "Listo, moví tu llamada con el Especialista a [TIME]. 📅 Te enviaremos un recordatorio antes de la llamada y te llamarán desde un número local."
  },
  humanReturnTemplates: {
    needs_fault_answer: "Hola [NAME], ¿sigues ahí conmigo? 🙏 Quiero asegurarme de no perder el avance en tu caso. Pregunta rápida para saber cómo orientarte: ¿fuiste culpable o fue el otro conductor?",
    needs_medical_answer: "Hola [NAME], ¿sigues ahí conmigo? 🙏 Quiero ayudarte de la manera correcta. ¿Necesitaste tratamiento médico después del accidente, aunque fuera urgencias, ER, quiropráctico o una visita al doctor? 🤕",
    needs_call_time: "Hola [NAME], ¿sigues ahí conmigo? 🙏 Quiero conectarte para que recibas respuestas sobre tu caso. ¿Qué hora te queda mejor para una llamada rápida con un Especialista? 📞"
  },
  freshLeadFollowUpTemplates: {
    1: "Hola [NAME] 👋 solo quería confirmar que recibiste mi último mensaje. La fecha del accidente me ayuda a ver qué opciones podrían seguir abiertas para ti y si el tiempo puede afectar tu reclamo.",
    2: "[NAME], algo que no quiero es que esperes demasiado y eso perjudique tu reclamo 🤕 ¿Qué fecha fue el accidente? Aunque sea una fecha aproximada está bien.",
    3: "Pregunta rápida, [NAME] 🙏 ¿la compañía de seguros ya se comunicó contigo? Si ya lo hicieron, puede que no sea a tu favor. A veces intentan obtener declaraciones o detalles antes de que sepas cuánto podría valer tu reclamo.",
    4: "No te preocupes si estás ocupado. Todavía tengo tu archivo abierto y quiero asegurarme de que no pierdas compensación a la que podrías tener derecho 💰 ¿Cuál fue la fecha del accidente?"
  },
  reengagementTemplates: {
    after_date: {
      1: "Hola [NAME], soy William 🙌 ya guardé la fecha del accidente, así que no tenemos que empezar de nuevo. Pregunta rápida: ¿fuiste culpable o fue el otro conductor?",
      2: "Hola [NAME], todavía tengo tu archivo abierto. El detalle de culpa me ayuda a saber qué tan fuerte puede ser esto. ¿Fue tu culpa, la del otro conductor o no estás seguro?",
      3: "[NAME], aunque haya sido parcialmente tu culpa, eso me ayuda a entender el caso. ¿Quién crees que causó el accidente?",
      5: "Hola [NAME], no quiero perder el avance que ya hicimos. Solo responde culpable, no culpable o no estoy seguro 🙏",
      7: "Última revisión sobre esto por ahora, [NAME]. Si todavía quieres ayuda, dime quién tuvo la culpa y puedo seguir avanzando."
    },
    after_q1: {
      1: "Hola [NAME], William por aquí 🤕 ya respondiste la parte de culpa, así que estamos cerca. ¿Te revisaron o recibiste tratamiento médico después del accidente?",
      2: "Hola [NAME], seguimiento rápido. Incluso una visita a ER, urgencias, quiropráctico, terapia o doctor puede importar. ¿Recibiste algún tratamiento después del accidente?",
      3: "[NAME], este suele ser el detalle que ayuda a un Especialista a entender qué opciones podrías tener. ¿Viste a alguien médico después del accidente?",
      5: "Hola [NAME], no quiero que tu archivo se detenga cuando ya empezamos. ¿Recibiste atención médica, aunque fuera solo una visita?",
      7: "Última revisión de mi parte sobre esto, [NAME]. Si recibiste tratamiento médico después del accidente, responde sí. Si no, responde no."
    },
    after_call_booking: {
      1: "Hola [NAME] 👋 estábamos justo en el punto de conectarte. ¿Qué hora te funciona mejor para una llamada rápida con un Especialista?",
      2: "Hola [NAME], William por aquí. La llamada normalmente es rápida, unos 10 minutos, y puede ayudarte a entender tus opciones 📞 ¿Qué hora hoy o mañana te funciona?",
      3: "[NAME], no quiero que esto se pierda después de que ya compartiste suficiente para que podamos ayudar. Mándame una buena hora para llamar y trataré de dejarte confirmado."
    }
  },
  persistentReengagementTemplates: {
    after_date: {
      day_1_am: "Hola [NAME], soy William 🙌 ya guardé la fecha del accidente, así que no tenemos que empezar de nuevo. Pregunta rápida: ¿fuiste culpable o fue el otro conductor?",
      day_1_pm: "Hola [NAME], todavía solo necesito el detalle de culpa 🙏 ¿Fue tu culpa, la del otro conductor o no estás seguro?",
      day_2_am: "Hola [NAME], todavía tengo tu archivo abierto. El detalle de culpa me ayuda a saber qué tan fuerte puede ser esto. ¿Fue tu culpa, la del otro conductor o no estás seguro?",
      day_2_pm: "[NAME], no tiene que ser perfecto. Tu mejor respuesta es suficiente. ¿Quién causó el accidente?",
      day_3_am: "[NAME], aunque haya sido parcialmente tu culpa, eso me ayuda a entender el caso. ¿Quién crees que causó el accidente?",
      day_3_pm: "Respuesta rápida está bien: culpable, no culpable o no estoy seguro.",
      day_4_am: "Hola [NAME], William por aquí. Tengo guardada la fecha del accidente. Solo necesito saber quién tuvo la culpa para orientarte bien.",
      day_4_pm: "Todavía tratando de terminar esto para ti. ¿Tú causaste el accidente o fue otra persona?",
      day_5_am: "Hola [NAME], no quiero perder el avance que ya hicimos. Solo responde culpable, no culpable o no estoy seguro 🙏",
      day_5_pm: "[NAME], la respuesta de culpa puede afectar qué opciones de compensación podrían estar disponibles. ¿Cuál es tu mejor respuesta sobre quién causó el accidente?",
      day_6_am: "Buenos días [NAME], pregunta rápida: ¿el otro conductor causó el accidente o fuiste tú?",
      day_6_pm: "Lo hago simple: responde yo, ellos, ambos o no estoy seguro.",
      day_7_am: "Última revisión sobre esto por ahora, [NAME]. Si todavía quieres ayuda, dime quién tuvo la culpa y puedo seguir avanzando.",
      day_7_pm: "Último mensaje de mi parte sobre esto por ahora. Si todavía quieres ayuda, responde quién tuvo la culpa."
    },
    after_q1: {
      day_1_am: "Hola [NAME], William por aquí 🤕 ya respondiste la parte de culpa, así que estamos cerca. ¿Te revisaron o recibiste tratamiento médico después del accidente?",
      day_1_pm: "Hola [NAME], todavía solo necesito esta parte 🤕 ¿alguien médico te revisó después del accidente?",
      day_2_am: "Hola [NAME], seguimiento rápido. Incluso una visita a ER, urgencias, quiropráctico, terapia o doctor puede importar. ¿Recibiste algún tratamiento después del accidente?",
      day_2_pm: "[NAME], el dolor también puede aparecer después. ¿Fuiste a ER, urgencias, quiropráctico, terapia o algún doctor después del accidente?",
      day_3_am: "[NAME], este suele ser el detalle que ayuda a un Especialista a entender qué opciones podrías tener. ¿Viste a alguien médico después del accidente?",
      day_3_pm: "Con un sí o no está bien: ¿recibiste alguna atención médica después del accidente?",
      day_4_am: "Hola [NAME], William por aquí. Ya sabemos la parte de culpa, solo necesito la parte médica. ¿Te revisaron?",
      day_4_pm: "Todavía tratando de terminar esto para ti. ¿Hubo hospital, doctor, terapia, quiropráctico o tratamiento después del accidente?",
      day_5_am: "Hola [NAME], no quiero que tu archivo se detenga cuando ya empezamos. ¿Recibiste atención médica, aunque fuera solo una visita?",
      day_5_pm: "[NAME], esta respuesta puede cambiar qué opciones podrían estar disponibles. ¿Recibiste tratamiento o evaluación médica?",
      day_6_am: "Buenos días [NAME], seguimiento rápido: ¿viste a alguien médico después del accidente, aunque fuera una sola vez?",
      day_6_pm: "Lo hago simple: responde tratado, no tratado o no estoy seguro.",
      day_7_am: "Última revisión de mi parte sobre esto, [NAME]. Si recibiste tratamiento médico después del accidente, responde sí. Si no, responde no.",
      day_7_pm: "Último mensaje sobre esto por ahora, [NAME]. Si recibiste tratamiento después del accidente, responde sí y todavía puedo ayudar."
    },
    after_call_booking: {
      day_1_am: "Hola [NAME] 👋 estábamos justo en el punto de conectarte. ¿Qué hora te funciona mejor para una llamada rápida con un Especialista?",
      day_1_pm: "Hola [NAME], todavía puedo conectarte con un Especialista 📞 ¿Qué hora te funciona mejor hoy?",
      day_2_am: "Hola [NAME], William por aquí. La llamada normalmente es rápida, unos 10 minutos, y puede ayudarte a entender tus opciones 📞 ¿Qué hora hoy o mañana te funciona?",
      day_2_pm: "[NAME], si hoy se complicó, no hay problema. ¿Qué hora mañana sería más fácil para una llamada rápida?",
      day_3_am: "[NAME], no quiero que esto se pierda después de que ya compartiste suficiente para que podamos ayudar. Mándame una buena hora para llamar y trataré de dejarte confirmado.",
      day_3_pm: "Pregunta rápida: ¿te funciona mejor mañana, tarde o noche para que te llame el Especialista?",
      day_4_am: "Hola [NAME], William por aquí. No quiero que pierdas la oportunidad de recibir respuestas. Mándame una hora para una llamada rápida.",
      day_4_pm: "Todavía mantengo esto abierto para ti. Incluso una ventana como después de las 2 o mañana en la mañana me ayuda a conectarte.",
      day_5_am: "[NAME], todavía puedo ayudarte a poner esto en el calendario. ¿Qué hora intento reservar para ti?",
      day_5_pm: "¿A qué hora debe llamarte el Especialista, [NAME]? Una hora específica es mejor, pero una ventana corta también funciona.",
      day_6_am: "Buenos días [NAME], revisión rápida de horario: ¿hay un mejor día u hora para tu llamada con el Especialista?",
      day_6_pm: "Responde con cualquier hora que funcione hoy o mañana y puedo ayudarte a dejar la llamada lista 📞",
      day_7_am: "Hola [NAME], último intento de mi parte para programar. ¿Todavía quieres hablar con un Especialista sobre tu caso?",
      day_7_pm: "Último mensaje por ahora. Si todavía quieres ayuda, mándame una buena hora para llamar y trataré de ponerte de nuevo en el calendario."
    }
  },
  warmFollowUpTemplates: {
    needs_fault_answer: {
      1: "Hola [NAME], pregunta rápida 🙌 ¿fue tu culpa el accidente, fue el otro conductor o no estás seguro?",
      2: "Esta respuesta me ayuda a saber cómo orientarte. ¿Quién crees que causó el accidente?",
      3: "Aunque haya sido parcialmente tu culpa, eso importa. ¿Dirías que fuiste tú, ellos, ambos o no estás seguro?",
      4: "Tengo la fecha guardada, solo necesito la parte de culpa. ¿Fuiste culpable o fue otra persona?",
      5: "[NAME], no quiero que esto se detenga si puede haber algo aquí. Responde culpable, no culpable o no estoy seguro.",
      6: "Voy a pausar después de esto por ahora. Si todavía quieres ayuda, dime quién tuvo la culpa y sigo avanzando."
    },
    needs_medical_answer: {
      1: "Hola [NAME], pregunta rápida 🤕 ¿te revisaron o recibiste tratamiento médico después del accidente?",
      2: "Esto me ayuda a entender qué opciones podrías tener. ¿Fuiste a ER, urgencias, quiropráctico, terapia o un doctor?",
      3: "Incluso una visita médica puede importar aquí. ¿Alguien te trató o evaluó después del accidente?",
      4: "Estamos cerca de tener suficiente información. ¿Recibiste atención médica después del accidente, sí o no?",
      5: "[NAME], no quiero que esto se detenga si hay un reclamo real aquí. ¿Recibiste tratamiento o evaluación médica?",
      6: "Voy a pausar después de esto por ahora. Si recibiste tratamiento, responde sí. Si no, responde no."
    },
    needs_call_time: {
      1: "Hola [NAME], todavía puedo conectarte hoy 📞 ¿Qué hora te funciona mejor para una llamada rápida?",
      2: "La llamada es rápida, normalmente unos 10 minutos. ¿Te funciona ahora, más tarde hoy o mañana?",
      3: "No quiero que pierdas la oportunidad de recibir respuestas 💰 Mándame una hora que funcione y trataré de dejarte confirmado.",
      4: "Sigo aquí contigo, [NAME] 🙏 Si hoy estás ocupado, no hay problema. ¿Qué hora hoy o mañana te pongo?",
      5: "Ya tenemos suficiente para conectarte con un Especialista. ¿A qué hora debe llamarte?",
      6: "Última revisión por hoy, [NAME]. No quiero molestarte, pero tampoco quiero que pierdas esta oportunidad. Responde con una buena hora y te ayudo a programarlo."
    },
    needs_call_time_specific: {
      1: "Entiendo, más tarde está bien 👍 ¿A qué hora exacta te pongo?",
      2: "Solo necesito la hora exacta para no adivinar mal. ¿Qué hora te funciona mejor para la llamada con el Especialista? 📞",
      3: "[NAME], todavía puedo programarlo. Mándame la hora exacta que te funcione hoy o mañana.",
      4: "Pregunta rápida, ¿apunto a la tarde, noche o una hora específica?",
      5: "No quiero que esto se pierda. ¿Qué hora exacta te funciona para la llamada?",
      6: "Voy a pausar después de esto por ahora. Cuando estés listo, mándame la hora exacta para la llamada."
    }
  },
  reminderTemplates: {
    nextDayEvening: "Hola [NAME]! 👋 Recordatorio rápido: tienes una llamada programada con tu Especialista de Accident Support Desk mañana a las [TIME]. Te llamarán desde un número local, así que mantén tu teléfono cerca 📞",
    nextDayMorning: "Buenos días [NAME]! 👋 Recordatorio rápido: tienes una llamada programada con tu Especialista de Accident Support Desk hoy a las [TIME]. Te llamarán desde un número local, así que mantén tu teléfono cerca 💪",
    nextDayOneHour: "Hola [NAME], soy William! Tu llamada con el Especialista es en aproximadamente una hora a las [TIME] ⏰ Te llamarán desde un número local, así que mantén tu teléfono cerca.",
    nextDayFiveMinutes: "[NAME], tu Especialista te llamará en 5 minutos! 📞 Contesta aunque el número no te parezca familiar. Ya casi llegamos! 🏁",
    sameDayOneHour: "Hola [NAME]! Tu llamada con el Especialista es en aproximadamente una hora a las [TIME] ⏰ Te llamarán desde un número local, así que mantén tu teléfono cerca.",
    sameDayFiveMinutes: "[NAME], tu Especialista te llamará en 5 minutos! 📞 Contesta aunque el número no te parezca familiar. Queremos darte claridad sobre tu caso 💪"
  },
  missedCallTemplates: {
    after10Minutes: "Hola [NAME], parece que no pudimos comunicarnos! Nuestro Especialista intentó llamarte a las [TIME] pero no entró la llamada. No hay problema, ¿podemos reagendar? ¿Qué hora te funciona hoy o mañana?",
    after3Hours: "Hola [NAME], William por aquí. Solo quería asegurarme de que no pierdas la oportunidad. Un Especialista estaba listo para ti antes. Toma unos 10 minutos y puede hacer una diferencia real en tu caso. ¿Cuándo podemos intentar otra vez?",
    nextDay: "Hola [NAME] 👋 sé que no pudimos comunicarnos ayer, pero no quiero que pierdas tu lugar. Nuestros Especialistas se llenan rápido y mantuve tu espacio lo más que pude. ¿Puedo ponerte de nuevo en el calendario hoy?"
  },
  noShowTemplates: {
    same_day_now: "Hola [NAME], parece que no pudimos hablar en tu llamada con el Especialista a las [TIME] 📞 No hay problema, todavía quiero ayudarte a recibir respuestas. ¿Qué hora podemos intentar hoy?",
    same_day_15: "[NAME], no quiero que pierdas la oportunidad de entender qué compensación podrías recibir después del accidente 💰 ¿Te puedo poner de nuevo en el calendario hoy?",
    same_day_60: "Pregunta rápida, [NAME] 🙏 nuestro Especialista apartó tiempo para ti. Si surgió algo, no hay problema. ¿Qué hora más tarde hoy funciona para una llamada de 5 minutos?",
    same_day_120: "[NAME], el tratamiento médico y el tiempo pueden importar mucho después de un accidente. No quiero que pierdas el avance. ¿Podemos intentar tu llamada otra vez hoy?",
    same_day_240: "Sigo aquí, [NAME]. Ya llegaste al paso de la llamada, así que no quiero que tu archivo se enfríe. Responde con una hora hoy o mañana y te ayudo a reagendar 📞",
    same_day_360: "Última revisión por hoy, [NAME]. No quiero que pierdas ayuda si hay compensación disponible por tu accidente. ¿A qué hora debemos llamarte de nuevo?",
    day_2_am: "Buenos días [NAME] 👋 podrías tener derecho a más de lo que piensas después del accidente. Perdimos tu llamada, pero todavía puedo conseguirte una consulta gratis de 5 minutos. ¿Qué hora funciona hoy?",
    day_2_pm: "[NAME], ¿la aseguranza ya se comunicó contigo? Si sí, vale la pena hablar antes de aceptar algo demasiado rápido. ¿Podemos reagendar tu llamada con el Especialista hoy?",
    day_3_am: "Hola [NAME], sé que esto puede sentirse estresante y confuso. Hemos ayudado a muchas personas en situaciones parecidas a entender para qué podrían calificar. ¿Qué hora podemos intentar tu consulta gratis?",
    day_3_pm: "[NAME], podrías estar dejando compensación que ni sabes que te corresponde 💰 La llamada solo toma unos minutos. ¿Qué hora hoy o mañana funciona?",
    day_4_am: "[NAME], seguimiento rápido de Accident Support Desk. Perdimos tu llamada programada, pero tu accidente todavía puede valer una revisión. ¿A qué hora puede llamar un Especialista?",
    day_4_pm: "Las aseguranzas no siempre explican todas las opciones, [NAME]. Antes de seguir solo, déjanos darte una explicación gratis. ¿Qué hora funciona para una llamada rápida? 📞",
    day_5_am: "Buenos días [NAME], sé que puede dar miedo manejar todo esto después de un accidente. La consulta es gratis y solo toma unos 5 minutos. ¿Podemos reagendar tu llamada hoy?",
    day_5_pm: "[NAME], no quiero que tu archivo se enfríe después de que ya tenías una llamada programada. Todavía puedes tener opciones. ¿Estás disponible hoy o mañana?",
    day_6_am: "Hola [NAME] 👋 todavía podemos darte respuestas. Si tuviste tratamiento, dolor o presión de la aseguranza, vale la pena una conversación rápida. ¿Qué hora funciona?",
    day_6_pm: "Revisando una vez más, [NAME]. Una llamada rápida con un Especialista puede ayudarte a entender qué compensación podrías recibir. Responde con una hora y te reagendo.",
    day_7_am: "Hola [NAME], sé que perdimos la llamada, pero tu situación todavía puede valer una revisión. ¿Todavía quieres una consulta gratis sobre tu accidente?",
    day_7_pm: "[NAME], si la aseguranza ya se comunicó contigo, ten cuidado con ofertas tempranas. Puede que todavía no sepas el valor completo. ¿Qué hora puede llamar un Especialista?",
    day_8_am: "Buenos días [NAME] 🙏 todavía quiero asegurarme de que no pierdas una posible ventana de compensación. ¿Podemos reagendar tu llamada con el Especialista hoy?",
    day_8_pm: "[NAME], tu archivo todavía está abierto de mi lado. Hemos ayudado a personas en accidentes parecidos a recibir claridad rápido. Mándame una hora que funcione y te ayudo a reagendar.",
    day_9_am: "Hola [NAME], los síntomas de accidente pueden aparecer o empeorar después. Si tuviste tratamiento o dolor, vale la pena recibir respuestas. ¿Intentamos tu llamada con el Especialista otra vez hoy?",
    day_9_pm: "Seguimiento rápido, [NAME]. La llamada es solo para revisar tus opciones y ver qué ayuda puede estar disponible. ¿Qué hora funciona?",
    day_10_am: "[NAME], no quiero que después mires atrás deseando haber revisado tus opciones antes. La consulta es gratis. ¿Podemos reagendar tu llamada con el Especialista?",
    day_10_pm: "Todavía disponible para ayudar, [NAME]. Si hoy no funciona, mándame una mejor hora para mañana y me adapto.",
    day_11_am: "Buenos días [NAME] 👋 todavía estoy tratando de ayudarte a tener claridad sobre tu reclamo de accidente. ¿A qué hora debe llamar un Especialista?",
    day_11_pm: "[NAME], esto solo toma unos minutos. Si todavía quieres saber para qué podría calificar tu caso, responde con una hora que funcione.",
    day_12_am: "Hola [NAME], sé que la vida se ocupa. Solo no quiero que esta llamada perdida sea la razón por la que pierdas ayuda. ¿Podemos intentar otra vez hoy?",
    day_12_pm: "[NAME], si todavía tienes dolor, tratamiento o problemas con la aseguranza, vale la pena recibir respuestas. ¿A qué hora podemos llamar?",
    day_13_am: "Buenos días [NAME]. Ya estábamos en el paso de la llamada, así que sé que esto fue importante en algún momento. ¿Te pongo de nuevo en el calendario?",
    day_13_pm: "[NAME], podrías tener opciones que todavía no te han explicado. Déjanos darte una segunda revisión gratis. Responde con una hora hoy o mañana.",
    day_14_am: "Hola [NAME], último día que seguiré insistiendo. ¿Todavía quieres que un Especialista te llame sobre tu caso de accidente?",
    day_14_pm: "Último mensaje por ahora, [NAME]. Si quieres ayuda, mándame una hora para la llamada y trataremos de ponerte otra vez en el calendario 📞"
  },
  backupReminderTemplates: {
    afterPrimaryMissed: "Hola [NAME], parece que no pudimos hablar a las [PRIMARY TIME] 📞 No hay problema, todavía tengo tu hora de respaldo como [BACKUP TIME]. Intentaremos llamarte entonces. Si ya no te funciona, mándame otra hora.",
    thirtyBefore: "Recordatorio rápido [NAME], vamos a intentar llamarte en tu hora de respaldo alrededor de [BACKUP TIME] 📞 Mantén tu teléfono cerca.",
    fiveBefore: "[NAME], tu llamada de respaldo es en unos 5 minutos 📞 Contesta aunque el número no te parezca familiar."
  }
};

Object.assign(noShowTemplates, {
  sameDay10: noShowTemplates.same_day_now,
  sameDay45: noShowTemplates.same_day_60,
  sameDay120: noShowTemplates.same_day_120,
  sameDay240: noShowTemplates.same_day_240,
  sameDayLast: noShowTemplates.same_day_360
});

Object.assign(spanishTemplates.noShowTemplates, {
  sameDay10: spanishTemplates.noShowTemplates.same_day_now,
  sameDay45: spanishTemplates.noShowTemplates.same_day_60,
  sameDay120: spanishTemplates.noShowTemplates.same_day_120,
  sameDay240: spanishTemplates.noShowTemplates.same_day_240,
  sameDayLast: spanishTemplates.noShowTemplates.same_day_360
});

function normalizeTagForLanguage(tag) {
  return String(tag || "")
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

function languageTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.flatMap(languageTags);
  if (typeof tags === "object") return [tags.name, tags.label, tags.value, tags.tag, tags.text].flatMap(languageTags).filter(Boolean);
  const raw = String(tags || "");
  return raw.split(",").flatMap((part) => {
    const value = normalizeTagForLanguage(part);
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? [value, ...parts] : [value];
  });
}

function isSpanishContact(contact = {}) {
  if (["es", "spanish", "espanol", "español"].includes(String(contact.language || "").toLowerCase())) return true;
  return languageTags(contact.tags).some((tag) => ["spanish", "espanol", "español", "spanish lead", "spanish funnel"].includes(tag));
}

const exactSpanishMessageMap = new Map();

function addExactTranslations(english, spanish) {
  if (typeof english === "string" && typeof spanish === "string") {
    exactSpanishMessageMap.set(english, spanish);
    return;
  }
  if (!english || !spanish || typeof english !== "object" || typeof spanish !== "object") return;
  for (const [key, value] of Object.entries(english)) {
    addExactTranslations(value, spanish[key]);
  }
}

function spanishTemplate(group, key, fallback = "") {
  const groupMap = spanishTemplates[group];
  if (!groupMap) return fallback;
  const value = groupMap[key];
  return typeof value === "string" ? value : fallback;
}

function localizeDynamicSpanish(message) {
  const raw = String(message || "");
  if (!raw) return raw;
  if (/^Based on what you.ve shared, we can definitely help you out!/i.test(raw) && /tomorrow or the next day/i.test(raw)) {
    return "Por lo que me compartiste, definitivamente podemos ayudarte! 💰 El siguiente paso es conectarte con un Especialista de Accident Support Desk para crear un plan de compensación. ¿Qué hora te funciona mejor mañana o pasado mañana? 📞";
  }
  if (/^Based on what you.ve shared, we can definitely help you out!/i.test(raw) && /this evening or tomorrow/i.test(raw)) {
    return "Por lo que me compartiste, definitivamente podemos ayudarte! 💰 El siguiente paso es conectarte con un Especialista de Accident Support Desk para crear un plan de compensación. ¿Puedes tomar una llamada esta tarde/noche o mañana? 📞";
  }
  if (/^What specific time works best for your call today or tomorrow\?/i.test(raw)) {
    return "¿Qué hora específica te funciona mejor para tu llamada hoy o mañana?";
  }
  if (/^What specific time later today works best\?/i.test(raw)) {
    return "¿Qué hora específica más tarde hoy te funciona mejor?";
  }
  if (/^What specific time tomorrow works best\?/i.test(raw)) {
    return "¿Qué hora específica mañana te funciona mejor?";
  }
  if (/^What exact time tomorrow (morning|afternoon|evening) works best\?/i.test(raw)) {
    const part = raw.match(/tomorrow (morning|afternoon|evening)/i)?.[1]?.toLowerCase();
    const translated = { morning: "en la mañana", afternoon: "en la tarde", evening: "en la noche" }[part] || "";
    return `¿Qué hora exacta mañana ${translated} te funciona mejor?`;
  }
  if (/^No problem, we can do tomorrow or another day/i.test(raw)) {
    return "No hay problema, podemos hacerlo mañana u otro día 🙏 ¿Qué hora específica te funciona mejor para la llamada con el Especialista?";
  }
  if (/^No worries, I hope you feel better/i.test(raw)) {
    return "No te preocupes, espero que te mejores 🙏 ¿Qué hora mañana o pasado mañana sería más fácil para una llamada rápida con el Especialista?";
  }
  if (/^No problem 👍 What exact time tomorrow/i.test(raw)) {
    return raw.includes("morning")
      ? "No hay problema 👍 ¿A qué hora exacta mañana en la mañana quieres mover tu llamada?"
      : raw.includes("afternoon")
        ? "No hay problema 👍 ¿A qué hora exacta mañana en la tarde quieres mover tu llamada?"
        : raw.includes("evening")
          ? "No hay problema 👍 ¿A qué hora exacta mañana en la noche quieres mover tu llamada?"
          : "No hay problema 👍 ¿A qué hora exacta mañana quieres mover tu llamada?";
  }
  if (/^No worries at all/i.test(raw) && /were you at fault/i.test(raw)) {
    return "No hay problema 🙏 Podemos hacerlo rápido por texto. Solo necesito unos detalles del accidente para ver si podemos ayudar. Primero, ¿fuiste culpable del accidente o fue el otro conductor?";
  }
  if (/^No worries at all/i.test(raw) && /medical treatment/i.test(raw)) {
    return "No hay problema 🙏 Podemos hacerlo rápido por texto. Solo necesito unos detalles del accidente para ver si podemos ayudar. ¿Has tenido que ver a un doctor o recibir tratamiento médico después del accidente? 🤕";
  }
  if (/^No worries at all/i.test(raw) && /Specialist call/i.test(raw)) {
    return "No hay problema 🙏 ¿Qué hora te funciona mejor mañana o pasado mañana para una llamada rápida con un Especialista? 📞";
  }
  if (/^Absolutely, we can keep this over text/i.test(raw)) {
    return raw.replace(/^Absolutely, we can keep this over text 🙏\s*/i, "Claro, podemos seguir por texto 🙏 ");
  }
  return raw;
}

function localizeMessage(message, contact = {}) {
  const raw = String(message || "");
  if (!isSpanishContact(contact)) return raw;
  return exactSpanishMessageMap.get(raw) || localizeDynamicSpanish(raw);
}

addExactTranslations(coldOutreachTemplates, spanishTemplates.coldOutreachTemplates);
addExactTranslations(qualificationTemplates, spanishTemplates.qualificationTemplates);
addExactTranslations(humanReturnTemplates, spanishTemplates.humanReturnTemplates);
addExactTranslations(freshLeadFollowUpTemplates, spanishTemplates.freshLeadFollowUpTemplates);
addExactTranslations(reengagementTemplates, spanishTemplates.reengagementTemplates);
addExactTranslations(persistentReengagementTemplates, spanishTemplates.persistentReengagementTemplates);
addExactTranslations(warmFollowUpTemplates, spanishTemplates.warmFollowUpTemplates);
addExactTranslations(reminderTemplates, spanishTemplates.reminderTemplates);
addExactTranslations(missedCallTemplates, spanishTemplates.missedCallTemplates);
addExactTranslations(noShowTemplates, spanishTemplates.noShowTemplates);
addExactTranslations(backupReminderTemplates, spanishTemplates.backupReminderTemplates);

function firstName(contact = {}) {
  const raw =
    contact.firstName ||
    contact.first_name ||
    String(contact.name || "")
      .trim()
      .split(/\s+/)[0] ||
    "there";
  const value = String(raw || "there").trim();
  if (!value) return "there";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function render(template, contact, extra = {}) {
  const rawTemplate = localizeMessage(typeof template === "string" ? template : "", contact);
  const values = {
    NAME: firstName(contact),
    TIME: extra.time || contact.preferredCallTime || "",
    "PRIMARY TIME": extra.primaryTime || contact.preferredCallTime || "",
    "BACKUP TIME": extra.backupTime || contact.backupCallTime || ""
  };
  return rawTemplate.replace(/\[([A-Z ]+)\]/g, (_, key) => values[key] ?? "");
}

module.exports = {
  coldOutreachTemplates,
  qualificationTemplates,
  humanReturnTemplates,
  freshLeadFollowUpTemplates,
  reengagementTemplates,
  persistentReengagementTemplates,
  warmFollowUpTemplates,
  reminderTemplates,
  missedCallTemplates,
  noShowTemplates,
  backupReminderTemplates,
  spanishTemplates,
  isSpanishContact,
  localizeMessage,
  spanishTemplate,
  render,
  firstName
};
