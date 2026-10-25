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
}

export interface TaskEvent {
  at: string;
  taskId: string;
  actor: string;                // member id | 'agent'
  type: 'created' | 'assigned' | 'accepted' | 'declined' | 'swapped' | 'reminded' | 'done' | 'message' | 'blocked' | 'rescheduled' | 'timeout' | 'proof_requested' | 'auto_replaced';
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
  kind: 'assignment' | 'request' | 'reminder' | 'swap' | 'report' | 'info';
  taskId?: string;
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
