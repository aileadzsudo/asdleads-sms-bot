export type IssueFlag = {
  type: "urgent" | "warn" | "info";
  code: string;
  label: string;
  recommendedAction?: string;
};

export type DecisionLog = {
  id?: string;
  contactId?: string;
  action?: string;
  reason?: string;
  createdAt?: string;
  trigger?: string;
  beforeStatus?: string;
  afterStatus?: string;
  beforeProgress?: string;
  afterProgress?: string;
  message?: string;
  jobId?: string;
  jobType?: string;
  meta?: Record<string, any>;
};

export type ContactSummary = {
  id: string;
  name?: string;
  phone?: string;
  leadSource?: string;
  leadSourceLabel?: string;
  leadSourceRaw?: any;
  leadSourceType?: string;
  timezone?: string;
  timezoneSource?: string;
  engagementStatus?: string;
  qualificationProgress?: string;
  currentSequenceName?: string;
  currentSequenceDay?: number;
  humanEscalationStatus?: boolean;
  humanEscalationStage?: string;
  escalationReason?: string;
  automationPaused?: boolean;
  automationPauseReason?: string;
  lastAutomationPauseAt?: string;
  lastAutomationPauseSource?: string;
  lastAutomationPauseActor?: string;
  lastAutomationPauseNote?: string;
  lastAutomationPauseAction?: string;
  lastAutomationPauseRequestPath?: string;
  lastInboundMessage?: string;
  lastOutboundMessage?: string;
  lastActivityAt?: string;
  pendingJobs?: number;
  failedJobs?: number;
  messages?: number;
  riskScore?: number;
  issueFlags?: IssueFlag[];
  stuckStateReasons?: IssueFlag[];
  recommendedAction?: string;
  nextScheduledJob?: Job | null;
  lastBotDecision?: DecisionLog | null;
  skippedJobs?: number;
  ghlContactLink?: string;
};

export type Message = {
  id?: string;
  contactId?: string;
  direction?: "inbound" | "outbound";
  body?: string;
  createdAt?: string;
  templateGroup?: string;
  templateKey?: string;
};

export type Job = {
  id?: string;
  contactId?: string;
  type?: string;
  status?: string;
  runAt?: string;
  finishedAt?: string;
  error?: string;
  lastError?: string;
  skipReason?: string;
  payload?: Record<string, any>;
};

export type ContactDetail = {
  ok: boolean;
  contact: ContactSummary & Record<string, any>;
  messages: Message[];
  jobs: Job[];
  escalations: any[];
  decisionLogs?: DecisionLog[];
  issueFlags: IssueFlag[];
  timeline: any[];
};

export type DashboardData = {
  ok: boolean;
  generatedAt: string;
  dryRun: boolean;
  totals: Record<string, number>;
  dailySummary?: Record<string, any>;
  speedToLead?: Record<string, any>;
  alerts?: Record<string, any[]>;
  breakdowns?: Record<string, Record<string, number>>;
  funnel?: any[];
  activityHistory?: any[];
  hotLeads?: ContactSummary[];
  escalationSla?: any[];
  botConfusion?: ContactSummary[];
  appointmentPipeline?: any[];
  sourcePerformance?: any[];
  llmUsage?: Record<string, any>;
  templatePerformance?: any[];
  abTesting?: any[];
  issueContacts?: ContactSummary[];
  recentContacts?: ContactSummary[];
  recentMessages?: Message[];
  recentDecisionLogs?: DecisionLog[];
  pausedContacts?: ContactSummary[];
  pauseAudit?: any[];
  scanner?: any;
  timezoneHeatmap?: any[];
};
