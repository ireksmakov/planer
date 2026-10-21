import { useEffect, useState, type FormEvent } from 'react';
import type { Task, TaskInput, TaskPriority } from '../types';

interface TaskFormProps {
  date: string;
  initial?: Task;
  compact?: boolean;
  onSubmit: (task: TaskInput) => void;
  onCancel: () => void;
}

export function TaskForm({ date, initial, compact = false, onSubmit, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [selectedDate, setSelectedDate] = useState(initial?.date ?? date);
  const [time, setTime] = useState(initial?.time ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium');
  const [category, setCategory] = useState(initial?.category ?? 'Личное');
  const [error, setError] = useState(false);
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    setTitle(initial?.title ?? '');
    setSelectedDate(initial?.date ?? date);
    setTime(initial?.time ?? '');
    setPriority(initial?.priority ?? 'medium');
    setCategory(initial?.category ?? 'Личное');
    setError(false);
    setDateError(false);
  }, [date, initial]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError(true);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      setDateError(true);
      return;
    }
    // Release focus before the form unmounts so mobile keyboards close cleanly.
    const focusedElement = document.activeElement;
    if (focusedElement instanceof HTMLElement && event.currentTarget.contains(focusedElement)) {
      focusedElement.blur();
    }
    onSubmit({
      title: title.trim(),
      date: selectedDate,
      time,
      priority,
      category: category.trim() || 'Без категории',
    });
  }

  return (
    <form className={`task-form ${compact ? 'task-form-compact' : ''}`} onSubmit={handleSubmit} noValidate>
      <div className="task-form-top">
        <span className="eyebrow">{initial ? 'РЕДАКТИРОВАТЬ ЗАДАЧУ' : 'НОВАЯ ЗАДАЧА'}</span>
        <button type="button" className="text-action" onClick={onCancel} aria-label="Отменить">Закрыть ×</button>
      </div>
      <label className="field field-title">
        <span className="field-label">Название *</span>
        <input
          autoFocus
          value={title}
          onChange={(event) => { setTitle(event.target.value); setError(false); }}
          placeholder="Что нужно сделать?"
          maxLength={180}
          aria-invalid={error}
          aria-describedby={error ? 'task-title-error' : undefined}
        />
      </label>
      {error && <span id="task-title-error" className="form-error" role="alert">Введите название задачи.</span>}
      <div className="task-form-fields">
        <label className="field">
          <span className="field-label">Дата</span>
          <input type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setDateError(false); }} required aria-invalid={dateError} />
        </label>
        <label className="field">
          <span className="field-label">Время</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Приоритет</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
            <option value="low">Низкий</option>
            <option value="medium">Средний</option>
            <option value="high">Высокий</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Категория</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={40} list="category-suggestions" placeholder="Категория" />
          <datalist id="category-suggestions">
            <option value="Работа" />
            <option value="Личное" />
            <option value="Здоровье" />
            <option value="Учёба" />
          </datalist>
        </label>
      </div>
      {dateError && <span className="form-error" role="alert">Выберите корректную дату.</span>}
      <div className="form-actions">
        <button type="submit" className="solid-button">{initial ? 'Сохранить изменения' : 'Добавить задачу'} <span aria-hidden="true">↗</span></button>
        <button type="button" className="text-action" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}
