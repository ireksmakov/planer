import { useState, type FormEvent } from 'react';
import type { Task } from '../types';
import { shiftDay, toDateKey, today } from '../utils/date';

interface RescheduleFormProps {
  task: Task;
  onReschedule: (id: string, targetDate: string) => void;
  onCancel: () => void;
}

export function RescheduleForm({ task, onReschedule, onCancel }: RescheduleFormProps) {
  const todayKey = toDateKey(today());
  const [targetDate, setTargetDate] = useState(todayKey);
  const tomorrowKey = toDateKey(shiftDay(today(), 1));

  function applyDate(date: string) {
    if (!date || date < toDateKey(today())) return;
    onReschedule(task.id, date);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetDate || targetDate < toDateKey(today())) return;

    // Prevent Safari's keyboard and picker focus from keeping the page zoomed.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) {
      focused.blur();
    }
    applyDate(targetDate);
  }

  return (
    <div className="reschedule-panel" aria-label={`Перенос задачи «${task.title}»`}>
      <div className="reschedule-heading">
        <span className="eyebrow">ВЫБЕРИТЕ НОВУЮ ДАТУ</span>
        <button type="button" className="text-action" onClick={onCancel}>Закрыть ×</button>
      </div>
      <div className="reschedule-controls">
        <div className="reschedule-quick-actions">
          <button type="button" className="reschedule-quick-button" onClick={() => applyDate(todayKey)}>На сегодня</button>
          <button type="button" className="reschedule-quick-button" onClick={() => applyDate(tomorrowKey)}>На завтра</button>
        </div>
        <form className="reschedule-date-form" onSubmit={handleSubmit}>
          <label className="reschedule-date-label" htmlFor={`reschedule-date-${task.id}`}>Другая дата</label>
          <input
            id={`reschedule-date-${task.id}`}
            type="date"
            value={targetDate}
            min={todayKey}
            onChange={(event) => setTargetDate(event.target.value)}
            required
          />
          <button type="submit" className="reschedule-save-button" disabled={!targetDate || targetDate < todayKey}>Перенести</button>
        </form>
      </div>
    </div>
  );
}
