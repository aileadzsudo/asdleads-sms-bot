const ENGAGEMENT = Object.freeze({
  NEW_LEAD: "new_lead",
  CALLED_NO_ANSWER: "called_no_answer",
  INITIAL_SMS_SENT: "initial_sms_sent",
  COLD_OUTREACH: "cold_outreach",
  ACTIVE_CONVERSATION: "active_conversation",
  WARM_FOLLOW_UP: "warm_follow_up",
  RE_ENGAGEMENT: "re_engagement",
  READY_FOR_CALL: "ready_for_call",
  CALL_SCHEDULED: "call_scheduled",
  MISSED_CALL: "missed_call",
  ESCALATED_TO_HUMAN: "escalated_to_human",
  OPTED_OUT: "opted_out"
});

const QUALIFICATION = Object.freeze({
  NEEDS_FAULT: "needs_fault_answer",
  NEEDS_MEDICAL: "needs_medical_answer",
  NEEDS_CALL_TIME: "needs_call_time",
  CALL_BOOKED: "call_booked",
  COMPLETE: "complete"
});

module.exports = { ENGAGEMENT, QUALIFICATION };
