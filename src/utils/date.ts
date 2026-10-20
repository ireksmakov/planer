import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Task } from '../types';

export const toDateKey = (date: Date): string => format(date, 'yyyy-MM-dd');
export const fromDateKey = (key: string): Date => parseISO(key);
export const today = (): Date => new Date();
export const isCurrentDay = (date: Date): boolean => isToday(date);
export const isDayEqual = (a: Date, b: Date): boolean => isSameDay(a, b);
export const isMonthEqual = (a: Date, b: Date): boolean => isSameMonth(a, b);
export const shiftDay = (date: Date, amount: number): Date => addDays(date, amount);
export const shiftWeek = (date: Date, amount: number): Date => addWeeks(date, amount);
export const shiftMonth = (date: Date, amount: number): Date => addMonths(date, amount);

export const getWeekDays = (date: Date): Date[] =>
  eachDayOfInterval({
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  });

export const getMonthDays = (date: Date): Date[] =>
  eachDayOfInterval({
    start: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(date), { weekStartsOn: 1 }),
  });

export const dateLabel = (date: Date, pattern: string): string =>
  format(date, pattern, { locale: ru });

export const capitalize = (value: string): string =>
  value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1);

export const dateRangeLabel = (start: Date, end: Date): string => {
  if (format(start, 'yyyy-MM') === format(end, 'yyyy-MM')) {
    return `${format(start, 'd')}—${dateLabel(end, 'd MMMM')}`;
  }
  return `${dateLabel(start, 'd MMMM')} — ${dateLabel(end, 'd MMMM')}`;
};

export const getTaskStats = (tasks: Task[]) => ({
  total: tasks.length,
  completed: tasks.filter((task) => task.completed).length,
});

export const sortTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort((a, b) => {
    if (!a.time && b.time) return 1;
    if (a.time && !b.time) return -1;
    return a.time.localeCompare(b.time) || a.createdAt - b.createdAt;
  });
