import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskActions } from '../types';
import { capitalize, dateLabel, getTaskStats, shiftDay, sortTasks, toDateKey, today } from '../utils/date';
import { ProgressLine } from './ProgressLine';
import { TaskForm } from './TaskForm';
import { TaskItem } from './TaskItem';

interface DayViewProps extends TaskActions {
  date: Date;
  tasks: Task[];
  onChangeDate: (date: Date) => void;
}

export function DayView({ date, tasks, onChangeDate, addTask, updateTask, deleteTask, toggleTask }: DayViewProps) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const key = toDateKey(date);
  const dayTasks = useMemo(() => sortTasks(tasks.filter((task) => task.date === key)), [tasks, key]);
  const stats = getTaskStats(dayTasks);

  useEffect(() => setEditing(null), [key]);

  return (
    <section className="page-section day-page" aria-labelledby="day-title">
      <div className="section-intro">
        <div>
          <span className="eyebrow">ЕЖЕДНЕВНЫЙ ПЛАН / {dateLabel(date, 'yyyy')}</span>
          <h1 id="day-title" className="display-heading">{capitalize(dateLabel(date, 'EEEE'))}<span className="heading-comma">,</span><br />{dateLabel(date, 'd MMMM')}</h1>
          <p className="section-deck">Большие планы начинаются с одного ясного дня.</p>
        </div>
        <div className="section-aside">
          <span className="eyebrow">ДЕНЬ ГОДА</span>
          <span className="aside-number">{dateLabel(date, 'DDD').padStart(3, '0')}</span>
          <span className="aside-caption">Один день за раз.</span>
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

      <div className="task-list-header">
        <span className="eyebrow">ЗАДАЧИ / {String(dayTasks.length).padStart(2, '0')}</span>
        <span className="eyebrow">ВРЕМЯ / ДЕЙСТВИЯ</span>
      </div>
      {dayTasks.length === 0 ? (
        <div className="empty-state">
          <span className="eyebrow">ЧИСТЫЙ ЛИСТ</span>
          <p>Пока здесь<br /><em>тихо.</em></p>
          <span>Добавьте первую задачу — пусть день обретёт форму.</span>
        </div>
      ) : (
        <div className="task-list">
          {dayTasks.map((task, index) => editing === task.id ? (
            <TaskForm
              key={task.id}
              date={key}
              initial={task}
              onSubmit={(input) => { updateTask(task.id, input); setEditing(null); }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <TaskItem key={task.id} task={task} index={index} onToggle={toggleTask} onEdit={setEditing} onDelete={deleteTask} />
          ))}
        </div>
      )}
      <div className="page-footer-line"><span>ПЛАНИРУЙТЕ ОСОЗНАННО</span><span>© ПЛАНЕР</span></div>
    </section>
  );
}
