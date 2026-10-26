import { useState } from 'react';
import type { Task } from '../types';
import { dateLabel, fromDateKey, toDateKey, today } from '../utils/date';
import { RescheduleForm } from './RescheduleForm';

interface TaskItemProps {
  task: Task;
  index: number;
  showOriginalDate?: boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string, targetDate: string) => void;
}

const priorityLabels = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
} as const;

export function TaskItem({
  task, index, showOriginalDate = false, onToggle, onEdit, onDelete, onReschedule,
}: TaskItemProps) {
  const [rescheduling, setRescheduling] = useState(false);
  const isOverdue = !task.completed && task.date < toDateKey(today());
  const isActive = !task.completed && !isOverdue;

  return (
    <div className={`task-item ${task.completed ? 'is-complete' : ''} ${isOverdue ? 'is-overdue' : ''} ${isActive ? 'is-active-goal' : ''}`}>
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
        <div className="task-meta">
          {showOriginalDate && (
            <>
              <span className="task-overdue-date">С {dateLabel(fromDateKey(task.date), 'd MMMM yyyy')}</span>
              <span className="meta-divider" aria-hidden="true">/</span>
            </>
          )}
          <span>{task.category}</span>
          <span className="meta-divider" aria-hidden="true">/</span>
          <span className={task.priority === 'high' ? 'priority-high' : ''}>{priorityLabels[task.priority]} приоритет</span>
        </div>
      </div>
      <div className="task-right">
        <span className="task-time">{task.time || '—:—'}</span>
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
