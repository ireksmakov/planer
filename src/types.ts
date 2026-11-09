export type ViewMode = 'day' | 'week' | 'month' | 'ramadan';
export type TaskPriority = 'low' | 'medium' | 'high';
export type RecurrenceScope = 'single' | 'future' | 'all';
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type QuranReadingPace = 30 | 15 | 12 | 10 | 6;
export type QuranReadingState = {
  pace: QuranReadingPace;
  startDate: string; // date of the first Ramadan day
  completedSessions: number[]; // 0..149, five prayers a day
  pageProgress?: Record<string, number>; // number of read pages per prayer session
  bookmark?: { session: number; page: number } | null; // optional saved position
};

export interface Task {
  id: string;
  title: string;
  date: string; // local date: yyyy-MM-dd
  time: string; // Начало: HH:mm, or an empty string (legacy compatible)
  endTime?: string; // Конец: optional HH:mm; older tasks have no end time
  priority: TaskPriority;
  category: string;
  completed: boolean;
  createdAt: number;
  recurrence?: TaskRecurrence;
  recurrenceCompleted?: string[];
  recurrenceSkipped?: string[];
  recurrenceUntil?: string; // Exclusive end date for a split series
  recurrenceOverrides?: Record<string, Partial<TaskInput>>;
  repeatReminder?: boolean; // repeat at +2 min and at task end, or +1 hour if no end
  subgoals?: string[]; // optional additional goals shown under the main task
  quranReading?: QuranReadingState | null; // dedicated 604-page tracker, not a daily goal
}

export type TaskInput = Pick<Task, 'title' | 'date' | 'time' | 'priority' | 'category'> & { repeatReminder?: boolean; recurrence?: TaskRecurrence; endTime?: string; subgoals?: string[]; quranReading?: QuranReadingState | null };

export interface TaskActions {
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, input: TaskInput) => void;
  rescheduleTask: (id: string, targetDate: string) => void;
  deleteTask: (id: string) => void;
  deleteTasks: (ids: string[]) => void;
  toggleTask: (id: string) => void;
  updateRecurringTask?: (id: string, input: TaskInput, scope: RecurrenceScope) => void;
  deleteRecurringTask?: (id: string, scope: RecurrenceScope) => void;
}
