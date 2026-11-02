export type ViewMode = 'day' | 'week' | 'month' | 'ramadan';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  title: string;
  date: string; // local date: yyyy-MM-dd
  time: string; // HH:mm, or an empty string
  priority: TaskPriority;
  category: string;
  completed: boolean;
  createdAt: number;
  repeatReminder?: boolean; // optional: two extra push reminders at +2 and +4 minutes
}

export type TaskInput = Pick<Task, 'title' | 'date' | 'time' | 'priority' | 'category'> & { repeatReminder?: boolean };

export interface TaskActions {
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, input: TaskInput) => void;
  rescheduleTask: (id: string, targetDate: string) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;
}
