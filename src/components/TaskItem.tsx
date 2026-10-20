import type { Task } from '../types';

interface TaskItemProps {
  task: Task;
  index: number;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const priorityLabels = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
} as const;

export function TaskItem({ task, index, onToggle, onEdit, onDelete }: TaskItemProps) {
  return (
    <div className={`task-item ${task.completed ? 'is-complete' : ''}`}>
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
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span>{task.category}</span>
          <span className="meta-divider" aria-hidden="true">/</span>
          <span className={task.priority === 'high' ? 'priority-high' : ''}>{priorityLabels[task.priority]} приоритет</span>
        </div>
      </div>
      <div className="task-right">
        <span className="task-time">{task.time || '—:—'}</span>
        <div className="task-actions">
          <button className="text-action" type="button" onClick={() => onEdit(task.id)} aria-label={`Изменить ${task.title}`}>Изменить</button>
          <button className="text-action delete-action" type="button" onClick={() => onDelete(task.id)} aria-label={`Удалить ${task.title}`}>Удалить</button>
        </div>
      </div>
    </div>
  );
}
