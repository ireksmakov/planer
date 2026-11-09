import { useState } from 'react';
import type { Task, TaskColor } from '../types';
import { dateLabel, fromDateKey, toDateKey, today } from '../utils/date';
import { RescheduleForm } from './RescheduleForm';
import { PriorityIndicator } from './PriorityIndicator';

const TASK_COLOR_HEX: Record<TaskColor, string> = {
  default: '#2e6d61', cherry: '#a51f50', coral: '#cf356b', orange: '#e45b2c',
  yellow: '#e4b73d', lime: '#b1c744', green: '#35844e', mint: '#5ab483',
  teal: '#419b8f', blue: '#4298dc', indigo: '#4e79e5', purple: '#986ab3',
  pink: '#b19bd8', brown: '#76584d', gray: '#666666',
};

interface TaskItemProps {
  task: Task;
  index: number;
  showOriginalDate?: boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string, targetDate: string) => void;
}

export function TaskItem({
  task, index, showOriginalDate = false, onToggle, onEdit, onDelete, onReschedule,
}: TaskItemProps) {
  const [rescheduling, setRescheduling] = useState(false);
  const isOverdue = !task.completed && task.date < toDateKey(today());
  const isActive = !task.completed && !isOverdue;
  const chosenColor = task.color && task.color in TASK_COLOR_HEX ? TASK_COLOR_HEX[task.color] : null;

  return (
    <div style={chosenColor ? { borderLeft: `6px solid ${chosenColor}`, backgroundColor: `${chosenColor}12` } : undefined} className={`task-item ${task.completed ? 'is-complete' : ''} ${isOverdue ? 'is-overdue' : ''} ${isActive ? 'is-active-goal' : ''}`}>
      <span className="task-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <label className="task-check-label">
        <input
          className="sr-only task-native-checkbox"
          type="checkbox"
          checked={task.completed}
          onChange={() => onToggle(task.id)}
          aria-label={`Отметить задачу «${task.title}» как ${task.completed ? 'невыполненную' : 'выполненную'}`}
        />
        <span className="task-checkbox" aria-hidden="true">{task.completed ? '✓' : ''}</span>
      </label>
      <div className="task-details">
        {(isOverdue || isActive) && (
          <span className={`task-status ${isOverdue ? 'task-status-overdue' : 'task-status-active'}`}>
            <span className={`status-lamp ${isOverdue ? 'lamp-overdue' : ''}`} aria-hidden="true" />
            {isOverdue ? 'ПРОСРОЧЕНО' : 'В ПЛАНЕ'}
          </span>
        )}
        <div className="task-title">{task.title}</div>
        {task.description && <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.9em', opacity: 0.85 }}>{task.description}</p>}
        <span className={`task-date-stamp ${isOverdue ? 'task-date-stamp--overdue' : ''}`}>
          <span className="task-date-stamp-icon" aria-hidden="true">▣</span>
          {showOriginalDate ? 'Было назначено: ' : ''}
          {dateLabel(fromDateKey(task.date), 'EEEE, d MMMM yyyy').replace(/^./, char => char.toLocaleUpperCase('ru-RU'))}
        </span>
        <div className="task-meta">
          <span>{task.category}</span>
          <span className="meta-divider" aria-hidden="true">/</span>
          <PriorityIndicator priority={task.priority} />
          {task.time && task.repeatReminder && <span className="task-reminder-mode">🔔 С повторами</span>}
        </div>
      </div>
      <div className="task-right">
        <span className={`task-time ${task.endTime ? 'task-time-range' : ''}`}>{task.time ? (task.endTime ? `${task.time}–${task.endTime}` : task.time) : '—:—'}</span>
        <div className="task-actions">
          {isOverdue && (
            <button
              className="text-action reschedule-trigger"
              type="button"
              aria-expanded={rescheduling}
              onClick={() => setRescheduling((opened) => !opened)}
            >Перенести</button>
          )}
          <button className="text-action" type="button" onClick={() => onEdit(task.id)} aria-label={`Изменить ${task.title}`}>Изменить</button>
          <button className="text-action delete-action" type="button" onClick={() => onDelete(task.id)} aria-label={`Удалить ${task.title}`}>Удалить</button>
        </div>
      </div>
      {isOverdue && rescheduling && (
        <div className="task-reschedule-area">
          <RescheduleForm
            task={task}
            onReschedule={onReschedule}
            onCancel={() => setRescheduling(false)}
          />
        </div>
      )}
    </div>
  );
}
