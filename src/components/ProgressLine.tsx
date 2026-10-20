interface ProgressLineProps {
  completed: number;
  total: number;
  label?: string;
}

export function ProgressLine({ completed, total, label = 'Выполнено' }: ProgressLineProps) {
  const percentage = total ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="progress-block" aria-label={`${label}: ${completed} из ${total}`}>
      <div className="progress-head">
        <span className="eyebrow">{label}</span>
        <span className="progress-count">{completed} из {total}</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed}>
        <span className="progress-fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
