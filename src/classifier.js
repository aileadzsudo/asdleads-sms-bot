const { QUALIFICATION } = require("./constants");
const { getLocalParts, localDateToUtc } = require("./time");

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s:/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOptOut(text) {
  const t = normalize(text);
  const exact = new Set(["stop", "quit", "end", "revoke", "opt out", "cancel", "unsubscribe", "delete"]);
  if (exact.has(t)) return true;
  return [
    "remove me",
    "don't text me",
    "don t text me",
    "dont text me",
    "do not text me",
    "wrong number",
    "numero equivocado",
    "no me escribas",
    "no me mandes mensajes",
    "dejame en paz",
    "leave me alone",
    "stop texting",
    "take me off",
    "do not contact",
    "dont contact",
    "lose my number"
  ].some((phrase) => t.includes(phrase));
}

function escalationReason(text) {
  const t = normalize(text);
  if (isVerificationCode(t)) return "off_topic_verification_code";
  if (isDocumentOrReport(t)) return "document_or_report";
  const checks = [
    ["human_request", ["human", "real person", "representative", "manager", "supervisor", "agent"]],
    ["human_request", ["humano", "persona real", "representante", "supervisor", "agente"]],
    ["attorney_request", ["attorney", "lawyer", "legal counsel", "law office", "law firm", "abogado", "abogada", "licenciado", "firma legal"]],
    ["company_question", ["who is this", "what company", "where did you get", "why are you texting", "who are you", "quien eres", "quien es", "que compania", "de donde sacaron"]],
    [
      "confused_or_upset",
      ["confused", "i don't understand", "i dont understand", "mad", "angry", "upset", "concerned", "scam", "stop harassing", "confundido", "no entiendo", "enojado", "molesto", "estafa"]
    ],
    [
      "outside_question",
      [
        "how much",
        "do i need",
        "insurance",
        "settlement",
        "claim worth",
        "compensation",
        "property damage",
        "rental car",
        "car damage",
        "vehicle damage",
        "paid for",
        "only paid",
        "never gave me",
        "gave me anything",
        "money for the accident",
        "cuanto",
        "aseguranza",
        "seguro",
        "compensacion",
        "danos",
        "renta",
        "carro"
      ]
    ],
    [
      "post_intake_or_firm_issue",
      ["case manager", "my case", "your office", "your firm", "docusign", "already signed", "i signed", "missed call", "mi caso", "su oficina", "tu oficina", "ya firme", "llamada perdida"]
    ]
  ];
  for (const [reason, phrases] of checks) {
    if (phrases.some((phrase) => t.includes(phrase))) return reason;
  }
  if (t.split(" ").length > 28) return "detailed_information";
  return "";
}

function isVerificationCode(text) {
  const t = normalize(text);
  return (
    /\bverification code\b/.test(t) ||
    /\bjustcall account login\b/.test(t) ||
    /\b\d{4,8}\s+is your\b/.test(t) ||
    /\bg-\d{4,8}\b/.test(t)
  );
}

function isDocumentOrReport(text) {
  const t = normalize(text);
  return [
    "file attachment",
    "download it here",
    "ghl-attachments",
    "ghl-unsupported",
    "bucket.blooio",
    "police report",
    "accident report",
    "insurance card",
    "driver license",
    "drivers license",
    "claim#",
    "claim #",
    "policy#",
    "policy #",
    "badge#",
    "badge #",
    "license plate",
    "send documents",
    "send it over",
    "send pictures",
    "send photos"
  ].some((phrase) => t.includes(phrase));
}

function parseAccidentDate(text) {
  const t = normalize(text);
  const numeric = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    return { value: numeric[0], confidence: 0.9 };
  }
  const named = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/
  );
  if (named) return { value: named[0], confidence: 0.85 };
  const relative = t.match(
    /\b(yesterday|yeserday|yesterdy|today|last night|this morning|last week|last month|a week ago|about a week ago|around a week ago|a month ago|couple days ago|a couple days ago|few days ago|a few days ago|couple weeks ago|a couple weeks ago|few weeks ago|a few weeks ago|two days ago|three days ago|day before yesterday|\d+\s+days?\s+ago|\d+\s+weeks?\s+ago|\d+\s+months?\s+ago|last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/
  );
  if (relative) return { value: relative[0], confidence: 0.75 };
  const spanishRelative = t.match(
    /\b(ayer|hoy|anoche|esta manana|la semana pasada|el mes pasado|hace una semana|hace como una semana|hace un mes|hace unos dias|hace dos dias|hace tres dias|anteayer|hace\s+\d+\s+dias?|hace\s+\d+\s+semanas?|hace\s+\d+\s+meses?|el\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+pasado|el\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/
  );
  if (spanishRelative) return { value: spanishRelative[0], confidence: 0.75 };
  return null;
}

function parseFaultAnswer(text) {
  const t = normalize(text);
  if (/\b(not sure|unsure|maybe|partially|partial|both|kind of|kinda|no estoy seguro|no se|tal vez|parcial|ambos|los dos)\b/.test(t)) {
    return { value: "unsure_or_partial", confidence: 0.85 };
  }
  if (
    /\b(other driver|their fault|his fault|her fault|not my fault|i was not at fault|wasn't my fault|i wasn't driving|i was not driving|i wasnt driving|passenger|rideshare passenger|uber passenger|lyft passenger|lyft driver|uber driver|pedestrian|walking|crosswalk|no|not me|they hit me|driver hit me|driver hit my|driver hit|hit my car|hit my vehicle|hit my front|hit my fender|kept going|rear ended me|rear-ended me|i got hit|hit me|parked|otro conductor|culpa del otro|no fue mi culpa|yo no tuve la culpa|no manejaba|no estaba manejando|pasajero|peaton|caminando|cruce peatonal|me chocaron|me pegaron|me golpearon|chocaron mi carro|le pegaron a mi carro|me dieron por detras|estaba estacionado)\b/.test(
      t
    )
  ) {
    return { value: "not_at_fault", confidence: 0.9 };
  }
  if (/\b(my fault|i was at fault|it was my fault|yes|yeah|yep|si|fue mi culpa|yo tuve la culpa|culpable)\b/.test(t)) {
    return { value: "at_fault", confidence: 0.9 };
  }
  return null;
}

function parseMedicalAnswer(text) {
  const t = normalize(text);
  if (/\b(no|not yet|haven't|havent|did not|didn't|none|not seen|no doctor|no treatment|todavia no|aun no|no he ido|no fui|ninguno|sin tratamiento|no doctor|no medico)\b/.test(t)) {
    return { value: "no", confidence: 0.85 };
  }
  if (
    /\b(yes|yeah|yep|si|doctor|hospital|er|e r|urgent care|chiro|chiropractor|therapy|physical therapy|pt|treatment|medical|clinic|ambulance|ortho|orthopedic|pain management|primary care|pcp|mri|xray|x-ray|medico|clinica|ambulancia|terapia|tratamiento|quiropractico|fisioterapia|radiografia|resonancia)\b/.test(
      t
    )
  ) {
    return { value: "yes", confidence: 0.9 };
  }
  return null;
}

function hasExpectedAnswerSignal(progress, text) {
  const t = normalize(text);
  if (progress === QUALIFICATION.NEEDS_FAULT) {
    return /\b(other driver|their fault|his fault|her fault|not my fault|i was not at fault|wasn't my fault|i wasn't driving|i was not driving|i wasnt driving|passenger|rideshare passenger|uber passenger|lyft passenger|lyft driver|uber driver|pedestrian|walking|crosswalk|my fault|i was at fault|at fault|they hit me|hit me|rear ended|rear-ended|not sure|unsure|partially|partial|otro conductor|culpa del otro|no fue mi culpa|pasajero|peaton|me chocaron|me dieron por detras|fue mi culpa|culpable|no estoy seguro)\b/.test(t);
  }
  if (progress === QUALIFICATION.NEEDS_MEDICAL) {
    return /\b(doctor|hospital|er|e r|urgent care|chiro|chiropractor|therapy|physical therapy|treatment|medical|clinic|ambulance|ortho|orthopedic|pain management|primary care|pcp|mri|xray|x-ray|no doctor|no treatment|not seen|haven't|havent|didn't|didnt|medico|clinica|ambulancia|terapia|tratamiento|quiropractico|sin tratamiento|no he ido)\b/.test(t);
  }
  if (progress === QUALIFICATION.NEEDS_CALL_TIME) {
    return /\b(now|today|tomorrow|morning|afternoon|evening|tonight|noon|ahora|hoy|manana|tarde|noche|mediodia|\d{1,2}(?::\d{2})?\s*(am|pm)?)\b/.test(t);
  }
  return false;
}

function classifyHumanContextIntent(text, progress) {
  const t = normalize(text);
  if (!t) return null;

  const busy =
    /\b(currently busy|busy right now|i'm busy|im busy|i am busy|busy|at work|working|in a meeting|driving|can't talk|cant talk|cannot talk|not available|occupied|ocupado|estoy ocupado|trabajando|en el trabajo|manejando|no puedo hablar|no disponible)\b/.test(t);
  const apology = /\b(sorry|my bad|apologize|apologies|perdon|disculpa|lo siento)\b/.test(t);
  const prefersText = /\b(text me|text is better|can we text|over text|just text|message me|por texto|mandame texto|mensajeame|texto es mejor)\b/.test(t);

  if (busy && !hasExpectedAnswerSignal(progress, t)) {
    return { intent: "busy_now", confidence: apology ? 0.92 : 0.88 };
  }
  if (prefersText && !hasExpectedAnswerSignal(progress, t)) {
    return { intent: "prefers_text", confidence: 0.86 };
  }
  return null;
}

function isCallNow(text) {
  const t = normalize(text);
  return /\b(call me now|call now|right now|now is fine|now is good|now is ok|now is okay|available now|i'm available now|im available now|i can talk now|asap|llamame ahora|llama ahora|ahora esta bien|disponible ahora|puedo hablar ahora)\b/.test(t);
}

function isNotTodayAvailability(text) {
  const t = normalize(text);
  return (
    /\b(today|2day|todai|tday)\s+(is\s+)?(not|isn t|isnt|ain t|aint)\s+(the\s+)?(day|tha\s+day)\b/.test(t) ||
    /\b(today|2day|todai|tday)\s+(doesn t|doesnt|do not|don t|dont|won t|wont)\s+work\b/.test(t) ||
    /\b(not|no)\s+(today|2day|todai|tday|tonight)\b/.test(t) ||
    /\b(can t|cant|cannot)\s+(do|talk|speak|call|make it)\s+(today|2day|todai|tday|tonight)\b/.test(t)
  );
}

function hasClockTimeSignal(text) {
  const t = normalize(text).replace(/(\d)\s*([ap])\s*\.?\s*m\.?/g, "$1$2m");
  return (
    /\b\d{1,2}:\d{2}\s*(am|pm)?\b/.test(t) ||
    /\b\d{1,2}\s*(am|pm)\b/.test(t) ||
    /\b(?:at|after|around|about)\s*\d{1,2}\b/.test(t) ||
    /\b(noon|morning|afternoon|evening|tonight|mediodia|manana|tarde|noche)\b/.test(t)
  );
}

function removeNumericDateTokens(text) {
  return normalize(text)
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCallTime(text, contact, config, now = new Date()) {
  const t = normalize(text)
    .replace(/\ben la manana\b/g, "morning")
    .replace(/\bpor la manana\b/g, "morning")
    .replace(/\ben la tarde\b/g, "afternoon")
    .replace(/\bpor la tarde\b/g, "afternoon")
    .replace(/\ben la noche\b/g, "evening")
    .replace(/\bpor la noche\b/g, "evening")
    .replace(/\bmanana\b/g, "tomorrow")
    .replace(/\bhoy\b/g, "today")
    .replace(/\bahora\b/g, "now")
    .replace(/\bmediodia\b/g, "noon")
    .replace(/\bmas tarde\b/g, "later")
    .replace(/\bocupado\b/g, "busy")
    .replace(/\bestoy trabajando\b/g, "working")
    .replace(/\blunes\b/g, "monday")
    .replace(/\bmartes\b/g, "tuesday")
    .replace(/\bmiercoles\b/g, "wednesday")
    .replace(/\bjueves\b/g, "thursday")
    .replace(/\bviernes\b/g, "friday")
    .replace(/\bsabado\b/g, "saturday")
    .replace(/\bdomingo\b/g, "sunday")
    .replace(/(\d)\s*([ap])\s*\.?\s*m\.?/g, "$1$2m")
    .replace(/\$\s*\d[\d,.]*/g, " ")
    .replace(/\b\d{1,3},\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clockText = removeNumericDateTokens(t);
  if (isCallNow(t)) return { type: "now", confidence: 0.95 };
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const local = getLocalParts(now, timeZone);
  const explicitToday = /\btoday\b/.test(t);
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(t) || /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(t)) {
    return { type: "needs_specific_time", confidence: 0.68, reason: "date_without_time" };
  }
  if (isNotTodayAvailability(t)) {
    return { type: "needs_specific_time", confidence: 0.88, preferredDay: "tomorrow_or_later" };
  }
  const weekdayMap = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6
  };
  const weekdayMatch = t.match(/\b(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)\b/);
  const currentLocalDow = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  let dayOffset = /\btomorrow\b/.test(t) ? 1 : 0;
  if (weekdayMatch) {
    const targetDow = weekdayMap[weekdayMatch[1]];
    dayOffset = (targetDow - currentLocalDow + 7) % 7;
  }
  if (/\b(later today|later|not now|not right now|can't talk|cant talk|at work|working|busy)\b/.test(t) && !/\d/.test(t)) {
    return { type: "needs_specific_time", confidence: 0.8 };
  }
  if (/\btomorrow\b/.test(t) && !hasClockTimeSignal(clockText)) {
    return { type: "needs_specific_time", confidence: 0.84, preferredDay: "tomorrow" };
  }
  if (/\b(today|tomorrow|tonight)?\s*(early\s+)?(late\s+)?(morning|afternoon|evening)\b/.test(t) && !/\d/.test(clockText)) {
    return { type: "needs_specific_time", confidence: 0.82 };
  }
  if (weekdayMatch && !hasClockTimeSignal(clockText)) {
    return { type: "needs_specific_time", confidence: 0.84, preferredDay: "weekday", preferredDayLabel: weekdayMatch[1] };
  }
  if (/\bnoon\b/.test(t)) {
    const startsAt = localDateToUtc({ year: local.year, month: local.month, day: local.day + dayOffset, hour: 12, minute: 0 }, timeZone);
    return { type: "scheduled", startsAt: startsAt.toISOString(), confidence: 0.85 };
  }
  const colonTime = clockText.match(/\b(?:at|after|around|about)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  const simpleTime = clockText.match(
    /\b(?:at|after|around|about)?\s*(\d{1,2})\s*(am|pm)?\b(?!\s*[:/.-])(?!\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)\b)/
  );
  const match = colonTime || simpleTime;
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] && /^\d{2}$/.test(match[2]) ? match[2] : 0);
    const meridiem = colonTime ? match[3] : match[2];
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
    if (!meridiem && hour > 12) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    const startsAt = localDateToUtc(
      { year: local.year, month: local.month, day: local.day + dayOffset, hour, minute },
      timeZone
    );
    if (startsAt <= now) {
      if (explicitToday) return { type: "needs_specific_time", confidence: 0.72 };
      const futureOffset = weekdayMatch ? dayOffset + 7 : dayOffset + 1;
      const futureStartsAt = localDateToUtc(
        { year: local.year, month: local.month, day: local.day + futureOffset, hour, minute },
        timeZone
      );
      return { type: "scheduled", startsAt: futureStartsAt.toISOString(), confidence: meridiem ? 0.88 : 0.68 };
    }
    return { type: "scheduled", startsAt: startsAt.toISOString(), confidence: meridiem ? 0.9 : 0.7 };
  }
  if (/\b(anytime|any time)\b/.test(t)) {
    return { type: "needs_specific_time", confidence: 0.78 };
  }
  const relativeHours = t.match(/\b(?:in\s*|within\s*|about\s*|around\s*)?(a|an|one|\d{1,2})\s*(?:hr|hrs|hour|hours)\b/);
  if (relativeHours) {
    const rawAmount = relativeHours[1];
    const amount = rawAmount === "a" || rawAmount === "an" || rawAmount === "one" ? 1 : Number(rawAmount);
    const target = new Date(now.getTime() + amount * 60 * 60 * 1000);
    return { type: "needs_specific_time", confidence: 0.84, relativeTarget: target.toISOString() };
  }
  const relativeMinutes = t.match(/\b(?:in\s*)?(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (relativeMinutes) {
    const startsAt = new Date(now.getTime() + Number(relativeMinutes[1]) * 60 * 1000);
    return { type: "needs_specific_time", confidence: 0.84, relativeTarget: startsAt.toISOString() };
  }
  return null;
}

function parseExpectedAnswer(progress, text) {
  if (progress === QUALIFICATION.NEEDS_FAULT) return parseFaultAnswer(text);
  if (progress === QUALIFICATION.NEEDS_MEDICAL) return parseMedicalAnswer(text);
  return null;
}

module.exports = {
  normalize,
  isOptOut,
  escalationReason,
  parseAccidentDate,
  parseFaultAnswer,
  parseMedicalAnswer,
  classifyHumanContextIntent,
  parseCallTime,
  parseExpectedAnswer,
  isCallNow,
  isNotTodayAvailability,
  hasClockTimeSignal,
  isDocumentOrReport,
  isVerificationCode
};
