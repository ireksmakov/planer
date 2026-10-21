import { useMemo } from 'react';
import type { Task } from '../types';
import {
  capitalize, dateLabel, getMonthDays, getTaskStats,
  isCurrentDay, isMonthEqual, shiftMonth, toDateKey, today,
} from '../utils/date';
import { ProgressLine } from './ProgressLine';

interface MonthViewProps {
  date: Date;
  tasks: Task[];
  onChangeDate: (date: Date) => void;
  onOpenDay: (date: Date) => void;
}

const weekdays = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

function taskWord(count: number): string {
  if (count % 100 >= 11 && count % 100 <= 14) return 'ЗАДАЧ';
  if (count % 10 === 1) return 'ЗАДАЧА';
  if (count % 10 >= 2 && count % 10 <= 4) return 'ЗАДАЧИ';
  return 'ЗАДАЧ';
}

export function MonthView({ date, tasks, onChangeDate, onOpenDay }: MonthViewProps) {
  const days = useMemo(() => getMonthDays(date), [date]);
  const monthKey = toDateKey(date).slice(0, 7);
  const monthTasks = tasks.filter((task) => task.date.startsWith(monthKey));
  const stats = getTaskStats(monthTasks);
  const activeDays = new Set(monthTasks.map((task) => task.date)).size;

  return (
    <section className="page-section month-page" aria-labelledby="month-title">
      <div className="section-intro">
        <div>
          <span className="eyebrow">КАЛЕНДАРЬ / {dateLabel(date, 'yyyy')}</span>
          <h1 id="month-title" className="display-heading">{capitalize(dateLabel(date, 'LLLL'))}<span className="heading-comma">.</span></h1>
          <p className="section-deck">Время для намерений, усилий и благодарности.</p>
        </div>
        <div className="section-aside">
          <span className="eyebrow">МЕСЯЦ ГОДА</span>
          <span className="aside-number">{dateLabel(date, 'MM')}</span>
          <span className="aside-caption">Месяц новых возможностей.</span>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="date-navigation">
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftMonth(date, -1))}>← пред.</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(today())}>Этот месяц</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftMonth(date, 1))}>след. →</button>
        </div>
        <span className="eyebrow week-navigation-label">ПН — ВС / КАЛЕНДАРЬ</span>
      </div>
      <ProgressLine completed={stats.completed} total={stats.total} label="ПРОГРЕСС МЕСЯЦА" />
      <div className="month-weekdays" aria-hidden="true">{weekdays.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="month-grid">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayTasks = monthTasks.filter((task) => task.date === key);
          const dayStats = getTaskStats(dayTasks);
          const fill = dayStats.total ? (dayStats.completed / dayStats.total) * 100 : 0;
          return (
            <button
              type="button"
              key={key}
              className={`month-cell ${isMonthEqual(day, date) ? '' : 'outside-month'} ${isCurrentDay(day) ? 'is-today' : ''}`}
              onClick={() => onOpenDay(day)}
              aria-label={`${dateLabel(day, 'd MMMM')}: ${dayStats.total} задач, ${dayStats.completed} выполнено. Открыть день`}
            >
              <span className="month-cell-day">{dateLabel(day, 'd')}{isCurrentDay(day) && <span className="today-dot" />}</span>
              <span className="month-cell-tasks">{dayStats.total ? `${dayStats.total} ${taskWord(dayStats.total)}` : '—'}</span>
              <span className="month-cell-track"><span style={{ width: `${fill}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="month-stats">
        <div><span className="eyebrow">ВСЕГО ЗАДАЧ</span><strong>{stats.total}</strong></div>
        <div><span className="eyebrow">ВЫПОЛНЕНО</span><strong>{stats.completed}</strong></div>
        <div><span className="eyebrow">ДНЕЙ С ПЛАНАМИ</span><strong>{activeDays}</strong></div>
        <div className="month-note">Пусть дела приносят<br /><em>пользу и благо.</em></div>
      </div>
    </section>
  );
}
