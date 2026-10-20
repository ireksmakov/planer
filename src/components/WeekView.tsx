import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskActions } from '../types';
import {
  capitalize, dateLabel, dateRangeLabel, getTaskStats, getWeekDays,
  isCurrentDay, shiftWeek, sortTasks, toDateKey, today,
} from '../utils/date';
import { ProgressLine } from './ProgressLine';
import { TaskForm } from './TaskForm';

interface WeekViewProps extends TaskActions {
  date: Date;
  tasks: Task[];
  onChangeDate: (date: Date) => void;
  onOpenDay: (date: Date) => void;
}

export function WeekView({ date, tasks, onChangeDate, onOpenDay, addTask, toggleTask }: WeekViewProps) {
  const days = useMemo(() => getWeekDays(date), [date]);
  const [formDate, setFormDate] = useState<string | null>(null);
  const startKey = toDateKey(days[0]);
  const endKey = toDateKey(days[6]);
  const weekTasks = tasks.filter((task) => task.date >= startKey && task.date <= endKey);
  const stats = getTaskStats(weekTasks);

  useEffect(() => setFormDate(null), [startKey]);

  return (
    <section className="page-section week-page" aria-labelledby="week-title">
      <div className="section-intro">
        <div>
          <span className="eyebrow">ПЛАН НА СЕМЬ ДНЕЙ / {dateLabel(date, 'yyyy')}</span>
          <h1 id="week-title" className="display-heading">Эта неделя<span className="heading-comma">.</span></h1>
          <p className="section-deck">{dateRangeLabel(days[0], days[6])} · Пространство для важного.</p>
        </div>
        <div className="section-aside">
          <span className="eyebrow">НЕДЕЛЯ</span>
          <span className="aside-number">{dateLabel(date, 'II')}</span>
          <span className="aside-caption">Семь новых возможностей.</span>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="date-navigation">
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftWeek(date, -1))}>← пред.</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(today())}>Эта неделя</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftWeek(date, 1))}>след. →</button>
        </div>
        <span className="eyebrow week-navigation-label">ПН — ВС / 07 ДНЕЙ</span>
      </div>
      <ProgressLine completed={stats.completed} total={stats.total} label="ПРОГРЕСС НЕДЕЛИ" />
      <div className="week-grid">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayTasks = sortTasks(weekTasks.filter((task) => task.date === key));
          const doneCount = dayTasks.filter((task) => task.completed).length;
          return (
            <div className={`week-column ${isCurrentDay(day) ? 'is-today' : ''}`} key={key}>
              <button type="button" className="week-day-head" onClick={() => onOpenDay(day)} aria-label={`Открыть ${dateLabel(day, 'd MMMM')}`}>
                <span className="eyebrow">{capitalize(dateLabel(day, 'EEEEEE'))}</span>
                <span className="week-day-number">{dateLabel(day, 'd')}{isCurrentDay(day) && <i className="today-dot" aria-label="Сегодня" />}</span>
                <span className="week-day-stat">{doneCount} / {dayTasks.length}</span>
              </button>
              <div className="week-entries">
                {dayTasks.map((task) => (
                  <div className={`week-task ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                    <label className="week-check-label">
                      <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)} className="sr-only task-native-checkbox" aria-label={`Выполнение: ${task.title}`} />
                      <span className="week-checkbox" aria-hidden="true">{task.completed ? '✓' : ''}</span>
                    </label>
                    <button type="button" className="week-task-open" onClick={() => onOpenDay(day)}>
                      {task.time && <span className="week-task-time">{task.time}</span>}
                      <span className={`week-task-name ${task.priority === 'high' ? 'priority-high' : ''}`}>{task.title}</span>
                    </button>
                  </div>
                ))}
                {dayTasks.length === 0 && <span className="week-blank">Свободный день</span>}
              </div>
              {formDate === key ? (
                <TaskForm
                  key={key}
                  date={key}
                  compact
                  onSubmit={(input) => { addTask(input); setFormDate(null); }}
                  onCancel={() => setFormDate(null)}
                />
              ) : (
                <button className="week-add" type="button" onClick={() => setFormDate(key)}>+ добавить</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="week-bottom">
        <span className="eyebrow">ВСЕГО НА НЕДЕЛЮ</span>
        <span>{stats.total} задач · {stats.completed} выполнено</span>
        <span className="week-bottom-aside">Сначала главное, остальное — следом.</span>
      </div>
    </section>
  );
}
