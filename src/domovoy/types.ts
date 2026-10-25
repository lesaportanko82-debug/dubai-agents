export type Role = 'adult' | 'child' | 'elder' | 'helper';
export type Lang = 'ru' | 'en' | 'tl' | 'ar' | 'tr' | 'hi';

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
  candidateIds: string[];       // ranked, allowed only
  declinedBy: string[];
  status: TaskStatus;
  reminderLevel: 0 | 1 | 2 | 3; // 0 none, 1 gentle, 2 humorous, 3 board
  assignReason?: string;
  createdAt: string;
  doneAt?: string;
}

export interface TaskEvent {
  at: string;
  taskId: string;
  actor: string;                // member id | 'agent'
  type: 'created' | 'assigned' | 'accepted' | 'declined' | 'swapped' | 'reminded' | 'done' | 'message' | 'blocked';
  details?: Record<string, unknown>;
}

export interface OutgoingMessage {
  at: string;
  toId: string;
  lang: Lang;
  text: string;
  kind: 'assignment' | 'reminder' | 'swap' | 'report' | 'info';
  taskId?: string;
}

export interface Candidate {
  memberId: string;
  score: number;
  reasons: string[];
}
