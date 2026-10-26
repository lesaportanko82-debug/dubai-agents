export type Role = 'adult' | 'child' | 'elder' | 'helper';
export type Lang = 'ru' | 'en' | 'tl' | 'ar' | 'tr' | 'hi';
export type HouseholdMode = 'classic' | 'quest' | 'care' | 'flat';
export type MessageStyle = 'direct' | 'quest' | 'gentle' | 'formal';

export interface Member {
  id: string;
  name: string;
  role: Role;
  age?: number;           // required for children
  lang: Lang;
  telegramId?: string;
  skills: string[];       // e.g. 'drive', 'cook', 'shop', 'water_plants', 'homework_help'
  /** 0..6, Monday = 0 */
  dayOff?: number[];
  /** working hours for helpers, local time "HH:MM" */
  workHours?: { from: string; to: string };
  /** busy slots: ISO start/end */
  busy: { from: string; to: string; what?: string }[];
  dailyLimit: number;
  /** adults who may change rules */
  isAdmin?: boolean;
  /** how the bot talks to this person */
  messageStyle: MessageStyle;
  /** weekly availability: array of { day: 0..6 (Mon=0), from: "HH:MM", to: "HH:MM" }. Default 08:00–22:00 every day. */
  availability?: { day: number; from: string; to: string }[];
  /** Google Calendar ID (email) for availability checks */
  calendarId?: string;
}

export type TaskStatus = 'new' | 'assigned' | 'accepted' | 'done' | 'declined' | 'unassigned' | 'cancelled';

export interface Task {
  id: string;
  authorId: string;
  text: string;                 // normalized, in family language
  dueAt?: string;               // ISO
  place?: string;
  minutes: number;
  skills: string[];
  kidSafe: boolean;             // can a child do it
  recurring?: 'daily' | 'weekly';
  assigneeId?: string;
  assignedAt?: string;
  candidateIds: string[];       // ranked, allowed only
  declinedBy: string[];
  status: TaskStatus;
  reminderLevel: 0 | 1 | 2 | 3; // 0 none, 1 gentle, 2 humorous, 3 board
  assignReason?: string;
  createdAt: string;
  doneAt?: string;
  /** time-critical (pickups, medicine): silence or decline → immediate swap, no rescheduling */
  urgent?: boolean;
  /** the task is about this person (take granny to the clinic) — they cannot be the executor */
  aboutMemberId?: string;
  /** a photo is required to close the task */
  needsProof?: boolean;
  proofUrl?: string;
  /** set when the assignee proposed a later time and the task was moved */
  rescheduledFrom?: string;
  /** private: visible only to author, assignee, and admins (auto-set for aboutMemberId tasks) */
  private?: boolean;
  /** where the task came from: a person's message, or the agent acting on its own */
  origin?: 'user' | 'weather' | 'prediction' | 'approval' | 'followup';
  /** the agent created / rescheduled this task itself and owns the follow-up (verification + report) */
  agentManaged?: boolean;
  /** when to check whether the task really happened (closing the loop) */
  verifyAt?: string;
  /** verification question already sent */
  verifyAsked?: boolean;
  /** how autonomously the agent acted on this task and why (visible learning) */
  decision?: AutonomyDecision;
  /** an approval that this task is waiting for / was created by */
  approvalId?: string;
}

export interface TaskEvent {
  at: string;
  taskId: string;
  actor: string;                // member id | 'agent'
  type: 'created' | 'assigned' | 'accepted' | 'declined' | 'swapped' | 'reminded' | 'done' | 'message' | 'blocked' | 'rescheduled' | 'timeout' | 'proof_requested' | 'auto_replaced'
    | 'approval_requested' | 'approval_decided' | 'autonomous_action' | 'verification_asked' | 'verified' | 'loop_closed' | 'info';
  details?: Record<string, unknown>;
}

export interface Household {
  id: string;
  name: string;
  tz: string;
  lang: Lang;
  inviteCode: string;
  pin: string;
  mode: HouseholdMode;
  /** currency the family thinks in; sums above moneyThreshold need an admin */
  currency?: string;
  moneyThreshold?: number;
  /** wallet policy JSON (see payments.ts) */
  wallet?: unknown;
}

export type GoalType = 'streak' | 'total' | 'deadline';
export type GoalStatus = 'active' | 'achieved' | 'failed' | 'cancelled';

export interface Goal {
  id: string;
  householdId: string;
  title: string;
  targetMemberId: string;
  type: GoalType;
  threshold: number;
  reward: string;
  progress: number;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OutgoingMessage {
  /** storage id (set by the store); used to mark delivery */
  id?: string | number;
  at: string;
  toId: string;
  lang: Lang;
  text: string;
  kind: 'assignment' | 'request' | 'reminder' | 'swap' | 'report' | 'info' | 'approval' | 'verification' | 'autonomous' | 'receipt' | 'cart';
  taskId?: string;
  /** set for kind = 'approval': the approval the buttons decide */
  approvalId?: string;
  /** set for kind = 'receipt': the payment the refund button undoes */
  paymentId?: string;
  /** set for kind = 'cart': the cart the buttons act on */
  cartId?: string;
}

export interface DispatchRun {
  id: string;
  at: string;
  authorId: string;
  input: string;
  /** DispatchResult (summary, tasks, trace, redactions) — kept loose to avoid a cycle */
  result: { summary: string; tasks: Task[]; trace: unknown[]; redactions: number };
}

export interface Candidate {
  memberId: string;
  score: number;
  reasons: string[];
}

// ── Agent Architecture: 4 Pillars ──

export type PatternType =
  | 'decline_time' | 'decline_skill' | 'preferred_time' | 'recurring_task'
  | 'response_speed' | 'completion_rate' | 'pair_affinity' | 'pair_conflict';

export interface Pattern {
  id?: number;
  householdId: string;
  memberId: string;
  patternType: PatternType;
  data: Record<string, unknown>;
  confidence: number;       // 0..1
  observedCount: number;
  firstSeen: string;
  lastSeen: string;
  active: boolean;
}

export type PlanStatus = 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface PlanStep {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  result?: unknown;
}

export interface AgentPlan {
  id: string;
  householdId: string;
  triggerText: string;
  authorId: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: string;
  completedAt?: string;
  data: Record<string, unknown>;
}

export type ReminderStatus = 'pending' | 'sent' | 'cancelled';

export interface Reminder {
  id: string;
  householdId: string;
  memberId: string;
  text: string;
  remindAt: string;
  recurring?: 'daily' | 'weekly' | 'monthly';
  status: ReminderStatus;
  createdAt: string;
  taskId?: string;
}

export type InsightType =
  | 'morning_briefing' | 'rebalance_suggestion' | 'conflict_warning' | 'pattern_prediction'
  | 'streak_alert' | 'idle_member' | 'overload_warning' | 'weekly_digest' | 'weather_alert'
  | 'weather_conflict' | 'recurring_prediction' | 'loop_closed';

export interface Insight {
  id?: number;
  householdId: string;
  insightType: InsightType;
  targetMemberId?: string;
  data: Record<string, unknown>;
  delivered: boolean;
  createdAt: string;
}

// ── Closing the loop: approvals, autonomy, impact ──

/** Actions the agent may take only with a human checkpoint (or reports after taking, when low-risk). */
export type ApprovalAction =
  | 'reschedule_task'        // move a task / event to a new time
  | 'create_task'            // create + assign a task the agent proposed (weather, prediction)
  | 'cancel_task'
  | 'spend_money'            // any purchase above the household threshold
  | 'change_child_schedule'  // anything that moves a child's fixed activity
  | 'share_outside';         // sending household data to someone outside the family

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';

export interface Approval {
  id: string;
  householdId: string;
  action: ApprovalAction;
  /** member id, or 'agent' when the agent itself asks */
  requestedBy: string;
  /** who may decide */
  approverIds: string[];
  payload: Record<string, unknown>;
  reason: { ru: string; en: string };
  /** what happens if the approver rejects (optional fallback the agent executes instead) */
  fallback?: { ru: string; en: string };
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  result?: Record<string, unknown>;
}

/** How much the agent is allowed to do on its own for a given kind of task. */
export type AutonomyLevel = 'remind' | 'ask' | 'act';

export interface AutonomyDecision {
  level: AutonomyLevel;
  confidence: number;           // 0..1
  why: { ru: string; en: string };
  /** which learned patterns drove the decision */
  evidence: string[];
}
