export type ViewMode = 'day' | 'week' | 'month' | 'ramadan';
export type TaskPriority = 'low' | 'medium' | 'high';

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
  repeatReminder?: boolean; // repeat at +2 min and at task end, or +1 hour if no end
  subgoals?: string[]; // optional additional goals shown under the main task
}

export type TaskInput = Pick<Task, 'title' | 'date' | 'time' | 'priority' | 'category'> & { repeatReminder?: boolean; endTime?: string; subgoals?: string[] };

export interface TaskActions {
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, input: TaskInput) => void;
  rescheduleTask: (id: string, targetDate: string) => void;
  deleteTask: (id: string) => void;
  deleteTasks: (ids: string[]) => void;
  toggleTask: (id: string) => void;
}
