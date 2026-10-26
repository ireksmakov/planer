import { useEffect, useState } from 'react';
import type { Task, TaskActions, TaskInput } from '../types';
import { fromDateKey, toDateKey, today } from '../utils/date';

const STORAGE_KEY = 'planer.editorial.tasks.v1';

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((task): task is Task =>
      typeof task === 'object' && task !== null &&
      typeof task.id === 'string' &&
      typeof task.title === 'string' &&
      typeof task.date === 'string' &&
      typeof task.time === 'string' &&
      ['low', 'medium', 'high'].includes(task.priority) &&
      typeof task.category === 'string' &&
      typeof task.completed === 'boolean' &&
      typeof task.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useTasks(): { tasks: Task[] } & TaskActions {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Tasks remain usable in memory if browser storage is unavailable.
    }
  }, [tasks]);

  useEffect(() => {
    const syncFromAnotherTab = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTasks(loadTasks());
    };
    window.addEventListener('storage', syncFromAnotherTab);
    return () => window.removeEventListener('storage', syncFromAnotherTab);
  }, []);

  const addTask = (input: TaskInput) => {
    if (!input.title.trim()) return;
    const newTask: Task = {
      ...input,
      title: input.title.trim(),
      category: input.category.trim() || 'Без категории',
      id: makeId(),
      completed: false,
      createdAt: Date.now(),
    };
    setTasks((previous) => [...previous, newTask]);
  };

  const updateTask = (id: string, input: TaskInput) => {
    if (!input.title.trim()) return;
    setTasks((previous) => previous.map((task) =>
      task.id === id
        ? { ...task, ...input, title: input.title.trim(), category: input.category.trim() || 'Без категории' }
        : task,
    ));
  };

  const rescheduleTask = (id: string, targetDate: string) => {
    // Preserve all task fields except the date; reject invalid or past targets.
    const parsed = fromDateKey(targetDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
        Number.isNaN(parsed.getTime()) ||
        toDateKey(parsed) !== targetDate ||
        targetDate < toDateKey(today())) return;

    setTasks((previous) => previous.map((task) =>
      task.id === id && !task.completed && task.date < toDateKey(today())
        ? { ...task, date: targetDate }
        : task,
    ));
  };

  const deleteTask = (id: string) => {
    setTasks((previous) => previous.filter((task) => task.id !== id));
  };

  const toggleTask = (id: string) => {
    setTasks((previous) => previous.map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task,
    ));
  };

  return { tasks, addTask, updateTask, rescheduleTask, deleteTask, toggleTask };
}
