import { useEffect, useState } from 'react';
import type { Task, TaskActions, TaskInput } from '../types';
import { fromDateKey, toDateKey, today } from '../utils/date';

export const STORAGE_KEY = 'planer.editorial.tasks.v1';
export const CLOUD_CHANGE_EVENT = 'planer:local-changed';

export function readLocalTasks(): Task[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((task): task is Task =>
      task && typeof task === 'object' &&
      typeof task.id === 'string' && typeof task.title === 'string' &&
      typeof task.date === 'string' && typeof task.time === 'string' &&
      ['low', 'medium', 'high'].includes(task.priority) &&
      typeof task.category === 'string' && typeof task.completed === 'boolean' &&
      typeof task.createdAt === 'number');
  } catch { return []; }
}
const makeId = () => crypto.randomUUID();

export function useTasks(): { tasks: Task[], replaceAllTasks: (tasks: Task[]) => void } & TaskActions {
  const [tasks, setTasks] = useState<Task[]>(readLocalTasks);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    window.dispatchEvent(new Event(CLOUD_CHANGE_EVENT));
  }, [tasks]);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTasks(readLocalTasks());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const replaceAllTasks = (items: Task[]) => setTasks(items);
  const addTask = (input: TaskInput) => {
    if (!input.title.trim()) return;
    setTasks(old => [...old, {
      ...input, title: input.title.trim(), category: input.category.trim() || 'Без категории',
      id: makeId(), createdAt: Date.now(), completed: false,
    }]);
  };
  const updateTask = (id: string, input: TaskInput) => {
    if (!input.title.trim()) return;
    setTasks(old => old.map(t => t.id === id
      ? { ...t, ...input, title: input.title.trim(), category: input.category.trim() || 'Без категории' } : t));
  };
  const rescheduleTask = (id: string, date: string) => {
    const parsed = fromDateKey(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) ||
        toDateKey(parsed) !== date || date < toDateKey(today())) return;
    setTasks(old => old.map(t =>
      t.id === id && !t.completed && t.date < toDateKey(today()) ? { ...t, date } : t));
  };
  const deleteTask = (id: string) => setTasks(old => old.filter(t => t.id !== id));
  const toggleTask = (id: string) =>
    setTasks(old => old.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  return { tasks, replaceAllTasks, addTask, updateTask, rescheduleTask, deleteTask, toggleTask };
}
