export type ViewMode = 'day' | 'week' | 'month';
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
}

export type TaskInput = Pick<Task, 'title' | 'date' | 'time' | 'priority' | 'category'>;

export interface TaskActions {
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, input: TaskInput) => void;
  rescheduleTask: (id: string, targetDate: string) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;
}
