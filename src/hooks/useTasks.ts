import { useEffect, useState } from 'react';
import type { Task, TaskActions, TaskInput, RecurrenceScope } from '../types';
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
    const parentId = id.split('::')[0];
    setTasks(old => old.map(t => t.id === parentId
      ? { ...t, ...input, title: input.title.trim(), category: input.category.trim() || 'Без категории' } : t));
  };
  const updateRecurringTask = (id: string, input: TaskInput, scope: RecurrenceScope) => {
    const [parentId, occurrence] = id.split('::');
    if (!occurrence) { updateTask(id, input); return; }
    setTasks(old => old.flatMap(task => {
      if (task.id !== parentId) return [task];
      if (scope === 'single') {
        return [{ ...task, recurrenceOverrides: {
          ...task.recurrenceOverrides, [occurrence]: { ...input, date: input.date },
        } }];
      }
      if (scope === 'all') {
        return [{ ...task, ...input, date: task.date }];
      }
      // Split the series at the chosen occurrence. Old completions remain on
      // the original series; future completions move to the new series.
      const oldCompleted = (task.recurrenceCompleted ?? []).filter(d => d < occurrence);
      const futureCompleted = (task.recurrenceCompleted ?? []).filter(d => d >= occurrence);
      const oldSkipped = (task.recurrenceSkipped ?? []).filter(d => d < occurrence);
      const futureSkipped = (task.recurrenceSkipped ?? []).filter(d => d >= occurrence);
      const entries = Object.entries(task.recurrenceOverrides ?? {});
      const oldOverrides = Object.fromEntries(entries.filter(([d]) => d < occurrence));
      const futureOverrides = Object.fromEntries(entries.filter(([d]) => d >= occurrence));
      const successor: Task = {
        ...task, ...input, id: makeId(), date: input.date,
        createdAt: Date.now(), completed: false,
        recurrenceCompleted: futureCompleted, recurrenceSkipped: futureSkipped,
        recurrenceOverrides: futureOverrides,
      };
      return [{ ...task, recurrenceUntil: occurrence, recurrenceCompleted: oldCompleted,
        recurrenceSkipped: oldSkipped, recurrenceOverrides: oldOverrides }, successor];
    }));
  };

  const deleteRecurringTask = (id: string, scope: RecurrenceScope) => {
    const [parentId, occurrence] = id.split('::');
    if (!occurrence) { deleteTask(id); return; }
    setTasks(old => old.flatMap(task => {
      if (task.id !== parentId) return [task];
      if (scope === 'all') return [];
      if (scope === 'single') return [{ ...task, recurrenceSkipped:
        [...new Set([...(task.recurrenceSkipped ?? []), occurrence])] }];
      if (occurrence <= task.date) return [];
      return [{ ...task, recurrenceUntil: occurrence }];
    }));
  };
  const rescheduleTask = (id: string, date: string) => {
    const parsed = fromDateKey(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) ||
        toDateKey(parsed) !== date || date < toDateKey(today())) return;
    setTasks(old => old.map(t =>
      t.id === id && !t.completed && t.date < toDateKey(today()) ? { ...t, date } : t));
  };
  const deleteTask = (id: string) => {
    const [parentId, occurrence] = id.split('::');
    setTasks(old => occurrence ? old.map(t => t.id === parentId
      ? { ...t, recurrenceSkipped: [...new Set([...(t.recurrenceSkipped ?? []), occurrence])] } : t)
      : old.filter(t => t.id !== id));
  };
  const deleteTasks = (ids: string[]) => {
    if (ids.length === 0) return;
    const toDelete = new Set(ids);
    // One React state update: the whole selected day's checklist disappears at once.
    setTasks(old => old.filter(task => !toDelete.has(task.id)));
  };
  const toggleTask = (id: string) => {
    const [parentId, occurrence] = id.split('::');
    setTasks(old => old.map(t => {
      if (t.id !== parentId) return t;
      if (!occurrence) return { ...t, completed: !t.completed };
      const completed = new Set(t.recurrenceCompleted ?? []);
      if (completed.has(occurrence)) completed.delete(occurrence);
      else completed.add(occurrence);
      return { ...t, recurrenceCompleted: [...completed].sort() };
    }));
  };
  return { tasks, replaceAllTasks, addTask, updateTask, rescheduleTask, deleteTask, deleteTasks, toggleTask, updateRecurringTask, deleteRecurringTask };
}
