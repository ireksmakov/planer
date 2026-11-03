import type { TaskPriority } from '../types';

const labels: Record<TaskPriority, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

/**
 * CSS pulse is visible in Planner, but deactivates for completed tasks
 * and when the user prefers reduced motion.
 */
export function PriorityIndicator({
  priority,
  compact = false,
}: {
  priority: TaskPriority;
  compact?: boolean;
}) {
  return (
    <span
      className={`priority-indicator priority-indicator--${priority} ${compact ? 'priority-indicator--compact' : ''}`}
      aria-label={`Приоритет: ${labels[priority].toLowerCase()}`}
    >
      <span className="priority-indicator__dot" aria-hidden="true" />
      {!compact && <span>{labels[priority]} приоритет</span>}
    </span>
  );
}
