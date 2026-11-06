import { useState, type FormEvent } from 'react';
import type { Task, TaskInput, TaskPriority } from '../types';

const PRIORITY_NAMES: Record<TaskPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
};

type Props = {
  task: Task;
  onToggle: (id: string) => void;
  onUpdate: (id: string, input: TaskInput) => void;
  onDelete: (id: string) => void;
};

/** An individual Ramadan goal opens inline without disturbing its completion checkbox.
 * The optional subgoals and time stay attached to the original task in cloud sync.
 */
export function RamadanTaskCard({ task, onToggle, onUpdate, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [start, setStart] = useState(task.time);
  const [end, setEnd] = useState(task.endTime ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [subgoals, setSubgoals] = useState((task.subgoals ?? []).join('\n'));
  const [repeatReminder, setRepeatReminder] = useState(task.repeatReminder ?? false);
  const [error, setError] = useState('');
  const panelId = 'ramadan-details-' + task.id.replace(/[^a-zA-Z0-9_-]/g, '');

  const openEditor = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setTitle(task.title);
    setStart(task.time);
    setEnd(task.endTime ?? '');
    setPriority(task.priority);
    setSubgoals((task.subgoals ?? []).join('\n'));
    setRepeatReminder(task.repeatReminder ?? false);
    setError('');
    setExpanded(true);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Введите название задачи.');
      return;
    }
    if (end && !start) {
      setError('Сначала укажите время начала.');
      return;
    }
    if (start && end && end <= start) {
      setError('Время окончания должно быть позже начала в тот же день.');
      return;
    }
    const extra = subgoals.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (extra.length > 30 || extra.some(line => line.length > 180)) {
      setError('Можно добавить до 30 дополнительных целей, не более 180 символов в каждой.');
      return;
    }
    onUpdate(task.id, {
      title: title.trim(),
      date: task.date,
      time: start,
      endTime: end,
      category: task.category,
      priority,
      repeatReminder: Boolean(start && repeatReminder),
      subgoals: extra,
    });
    setExpanded(false);
    setError('');
  };

  return (
    <div className={`ramadan-task ${expanded ? 'ramadan-task--expanded' : ''} ${task.completed ? 'ramadan-task--done' : ''}`}>
      <div className="ramadan-task-row">
        <label className="ramadan-task-checkbox">
          <input
            type="checkbox"
            checked={task.completed}
            aria-label={`Отметить выполнение: ${task.title}`}
            onChange={() => onToggle(task.id)}
          />
        </label>
        <button
          type="button"
          className={`ramadan-task-name ${task.completed ? 'done' : ''}`}
          onClick={openEditor}
          aria-expanded={expanded}
          aria-controls={panelId}
          title="Открыть задачу и настроить время, приоритет и дополнительные цели"
        >
          {task.title}
        </button>
        <div className="ramadan-task-buttons">
          <button type="button" onClick={openEditor}>{expanded ? 'Закрыть' : 'Изменить'}</button>
          <button type="button" onClick={() => onDelete(task.id)} aria-label={`Удалить: ${task.title}`}>Удалить</button>
        </div>
      </div>
      <div className="ramadan-task-summary">
        {task.time && (
          <span className="ramadan-task-schedule">
            <span aria-hidden="true">◷</span> {task.time}{task.endTime ? `–${task.endTime}` : ''}
          </span>
        )}
        <span className={`ramadan-task-priority ramadan-task-priority--${task.priority}`}>
          {PRIORITY_NAMES[task.priority]} приоритет
        </span>
      </div>
      {(task.subgoals?.length ?? 0) > 0 && (
        <div className="ramadan-task-subgoals">
          <span className="ramadan-task-subgoals-label">Дополнительные цели</span>
          <ol>
            {task.subgoals?.map((goal, index) => <li key={index}>{goal}</li>)}
          </ol>
        </div>
      )}
      {expanded && (
        <form className="ramadan-task-details" id={panelId} onSubmit={save} noValidate>
          <div className="ramadan-task-details-heading">Настройки задачи</div>
          <label className="ramadan-detail-label ramadan-detail-full">
            <span>Название цели</span>
            <input
              value={title}
              onChange={event => { setTitle(event.target.value); setError(''); }}
              maxLength={180}
              required
              autoFocus
            />
          </label>
          <div className="ramadan-detail-time">
            <label className="ramadan-detail-label">
              <span>Начало</span>
              <input type="time" value={start} onChange={event => { setStart(event.target.value); setError(''); }} />
            </label>
            <label className="ramadan-detail-label">
              <span>Конец</span>
              <input type="time" value={end} onChange={event => { setEnd(event.target.value); setError(''); }} />
            </label>
          </div>
          <label className="ramadan-detail-label ramadan-detail-full">
            <span>Приоритет</span>
            <select value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
            </select>
          </label>
          <label className="ramadan-detail-label ramadan-detail-full">
            <span>Дополнительные цели под задачей</span>
            <textarea
              value={subgoals}
              onChange={event => { setSubgoals(event.target.value); setError(''); }}
              rows={4}
              maxLength={6000}
              placeholder={'Например:\nВыучить суру\nПовторить дуа'}
            />
            <small>Каждая новая строка — отдельная дополнительная цель.</small>
          </label>
          <label className="ramadan-detail-reminder">
            <input
              type="checkbox"
              checked={repeatReminder && Boolean(start)}
              disabled={!start}
              onChange={event => setRepeatReminder(event.target.checked)}
            />
            <span>🔔 Настойчивое напоминание (повтор 2/2 в конце задачи)</span>
          </label>
          {error && <p className="ramadan-detail-error" role="alert">{error}</p>}
          <div className="ramadan-detail-actions">
            <button type="submit" className="ramadan-detail-save">Сохранить задачу</button>
            <button type="button" className="ramadan-detail-cancel" onClick={() => { setExpanded(false); setError(''); }}>Отмена</button>
          </div>
        </form>
      )}
    </div>
  );
}
