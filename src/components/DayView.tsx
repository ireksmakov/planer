import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskActions } from '../types';
import { capitalize, dateLabel, fromDateKey, getTaskStats, shiftDay, sortTasks, toDateKey, today } from '../utils/date';
import { ProgressLine } from './ProgressLine';
import { TaskForm } from './TaskForm';
import { TaskItem } from './TaskItem';

interface DayViewProps extends TaskActions {
  date: Date;
  tasks: Task[];
  onChangeDate: (date: Date) => void;
}

export function DayView({ date, tasks, onChangeDate, addTask, updateTask, rescheduleTask, deleteTask, toggleTask }: DayViewProps) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [rescheduleNotice, setRescheduleNotice] = useState('');
  const key = toDateKey(date);
  const todayKey = toDateKey(today());
  const dayTasks = useMemo(() => sortTasks(tasks.filter((task) => task.date === key)), [tasks, key]);
  const overdueTasks = useMemo(() =>
    tasks.filter((task) => !task.completed && task.date < todayKey)
      .sort((a, b) => b.date.localeCompare(a.date) || a.createdAt - b.createdAt),
    [tasks, todayKey],
  );
  const stats = getTaskStats(dayTasks);
  const showOverdue = key === todayKey;

  useEffect(() => { setEditing(null); setRescheduleNotice(''); }, [key]);

  function handleReschedule(id: string, targetDate: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    rescheduleTask(id, targetDate);
    setRescheduleNotice(`«${task.title}» перенесена на ${dateLabel(fromDateKey(targetDate), 'd MMMM yyyy')}`);
  }

  function renderTask(task: Task, index: number, showOriginalDate = false) {
    return editing === task.id ? (
      <TaskForm
        key={task.id}
        date={key}
        initial={task}
        onSubmit={(input) => { updateTask(task.id, input); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <TaskItem
        key={task.id}
        task={task}
        index={index}
        showOriginalDate={showOriginalDate}
        onToggle={toggleTask}
        onEdit={setEditing}
        onDelete={deleteTask}
        onReschedule={handleReschedule}
      />
    );
  }

  return (
    <section className="page-section day-page" aria-labelledby="day-title">
      <div className="section-intro">
        <div>
          <span className="eyebrow">ДЕНЬ С ДОБРЫМ НАМЕРЕНИЕМ / {dateLabel(date, 'yyyy')}</span>
          <h1 id="day-title" className="display-heading">{capitalize(dateLabel(date, 'EEEE'))}<span className="heading-comma">,</span><br />{dateLabel(date, 'd MMMM')}</h1>
          <p className="section-deck">Начните с доброго намерения — и уделите время главному.</p>
        </div>
        <div className="section-aside">
          <span className="eyebrow">ДЕНЬ ГОДА</span>
          <span className="aside-number">{dateLabel(date, 'DDD').padStart(3, '0')}</span>
          <span className="aside-caption">В каждом дне есть благо.</span>
        </div>
      </div>

      <div className="section-toolbar">
        <div className="date-navigation">
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftDay(date, -1))}>← пред.</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(today())}>Сегодня</button>
          <button type="button" className="navigation-link" onClick={() => onChangeDate(shiftDay(date, 1))}>след. →</button>
        </div>
        <button type="button" className="outline-button" onClick={() => setEditing(editing === 'new' ? null : 'new')}>+ Новая задача</button>
      </div>

      <ProgressLine completed={stats.completed} total={stats.total} label="ПРОГРЕСС ДНЯ" />

      {editing === 'new' && (
        <TaskForm
          key={`new-${key}`}
          date={key}
          onSubmit={(input) => { addTask(input); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {rescheduleNotice && <p className="reschedule-notice" role="status">{rescheduleNotice}</p>}

      {showOverdue && overdueTasks.length > 0 && (
        <section className="overdue-section" aria-labelledby="overdue-tasks-heading">
          <div className="overdue-header">
            <div>
              <span className="eyebrow overdue-kicker">ТРЕБУЮТ ВНИМАНИЯ</span>
              <h2 id="overdue-tasks-heading" className="overdue-title">
                Просроченные задачи <span>({overdueTasks.length})</span>
              </h2>
              <p className="overdue-hint">Перенесите невыполненные дела на удобную дату или отметьте их выполненными.</p>
            </div>
          </div>
          <div className="task-list overdue-task-list">
            {overdueTasks.map((task, index) => renderTask(task, index, true))}
          </div>
        </section>
      )}

      <div className="task-list-header">
        <span className="eyebrow">ЗАДАЧИ / {String(dayTasks.length).padStart(2, '0')}</span>
        <span className="eyebrow">ВРЕМЯ / ДЕЙСТВИЯ</span>
      </div>
      {dayTasks.length === 0 ? (
        <div className="empty-state">
          <span className="eyebrow">ЧИСТЫЙ ЛИСТ</span>
          <p>Пока здесь<br /><em>спокойно.</em></p>
          <span>Начните с одного важного дела.</span>
        </div>
      ) : (
        <div className="task-list">
          {dayTasks.map((task, index) => renderTask(task, index))}
        </div>
      )}
      <div className="page-footer-line"><span>ВРЕМЯ — ДОВЕРЕННОЕ БЛАГО</span><span>© ПЛАНЕР</span></div>
    </section>
  );
}
