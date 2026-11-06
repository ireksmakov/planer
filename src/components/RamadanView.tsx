import { RamadanLibrary } from './RamadanLibrary';
import { RamadanTaskCard } from './RamadanTaskCard';
import { useMemo, useState } from 'react';
import type { TaskActions } from '../types';
import { format, addDays, parseISO, isValid } from 'date-fns';
import { ru } from 'date-fns/locale';

const START_KEY = 'planer.ramadan.start.v1';
const CATEGORY = 'Рамадан';
const SAMPLE = ['Тахаджуд намаз', 'Витр намаз', 'Сунна намаз', 'Фаджр намаз', 'Зикры', 'Чтение Корана', 'Моя цель (измените)', 'Садака', 'Два ракаата намаза после восхода солнца', 'Духа намаз'];

type Props = { tasks: Task[] } & TaskActions;

export function RamadanView({ tasks, addTask, updateTask, toggleTask, deleteTask, deleteTasks }: Props) {
  const [start, setStart] = useState(() => localStorage.getItem(START_KEY) || '');
  const [selected, setSelected] = useState(0);
  const [customTitle, setCustomTitle] = useState('');
  const [section, setSection] = useState<'plan'|'library'>('plan');
  const base = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
    const date = parseISO(start);
    return isValid(date) && format(date, 'yyyy-MM-dd') === start ? date : null;
  }, [start]);
  const dates = useMemo(() => base ? Array.from({ length: 30 }, (_, i) => format(addDays(base, i), 'yyyy-MM-dd')) : [], [base]);
  const dayKey = dates[selected];
  const ramadanTasks = tasks.filter(t => t.category === CATEGORY);
  const dayTasks = ramadanTasks.filter(t => t.date === dayKey);
  const planned = ramadanTasks.filter(t => dates.includes(t.date));
  const complete = planned.filter(t => t.completed).length;
  const dayDone = dayTasks.filter(t => t.completed).length;

  const saveStart = (value: string) => {
    setStart(value);
    localStorage.setItem(START_KEY, value);
    setSelected(0);
  };
  const createTask = (title: string) => {
    if (!dayKey || !title.trim()) return;
    addTask({ title: title.trim(), category: CATEGORY, date: dayKey, time: '', priority: 'medium' });
  };
  const fillSample = () => {
    for (const title of SAMPLE) if (!dayTasks.some(t => t.title === title)) createTask(title);
  };
  const copyNextDay = () => {
    const next = dates[selected + 1];
    if (!next) return;
    const existing = ramadanTasks.filter(t => t.date === next);
    for (const task of dayTasks) {
      if (existing.some(t => t.title === task.title && t.time === task.time)) continue;
      addTask({ title: task.title, date: next, time: task.time, endTime: task.endTime, priority: task.priority, category: CATEGORY, repeatReminder: task.repeatReminder, subgoals: task.subgoals });
    }
    setSelected(selected + 1);
  };
  const clearSelectedDay = () => {
    if (!dayKey || dayTasks.length === 0) return;
    const description = format(parseISO(dayKey), 'd MMMM yyyy', { locale: ru });
    const agreed = window.confirm(
      `Очистить все задачи дня ${selected + 1} (${description})?\n\n` +
      `Будут удалены ${dayTasks.length} задач(и), включая выполненные.\n` +
      'Другие дни Рамадана и обычные задачи останутся без изменений.\n\n' +
      'Удалённые задачи нельзя будет восстановить автоматически.'
    );
    if (!agreed) return;
    deleteTasks(dayTasks.map(task => task.id));
  };

  return <section className="ramadan-page page-section">
    <div className="ramadan-hero">
      <span className="eyebrow">МЕСЯЦ ДОБРЫХ НАМЕРЕНИЙ</span>
      <h1>Рамадан <span aria-hidden="true">☾</span></h1>
      <p>Планируйте поклонение, добрые дела и личные цели — день за днём.</p>
      <span lang="ar" dir="rtl" className="ramadan-arabic">رَمَضَانُ مُبَارَكٌ</span>
    </div>
    <nav className="ramadan-subtabs" aria-label="Разделы Рамадана"><button type="button" className={section === "plan" ? "active" : ""} onClick={() => setSection("plan")}>☾ План на Рамадан</button><button type="button" className={section === "library" ? "active" : ""} onClick={() => setSection("library")}>▤ Библиотека и дуа</button></nav>
    {section === "library" ? <RamadanLibrary /> : <>
    <div className="ramadan-setup">
      <label htmlFor="ramadan-start">Первый день Рамадана (по местному объявлению)</label>
      <input id="ramadan-start" type="date" value={start} onChange={e => saveStart(e.target.value)} />
      <p>Дата зависит от наблюдения луны и вашего региона. Укажите подтверждённую дату; план рассчитан на 30 дней, даже если фактически месяц длится 29 дней.</p>
    </div>
    {!base ? <div className="ramadan-empty">Укажите дату начала Рамадана, чтобы открыть календарь и добавить цели.</div> : <>
      <div className="ramadan-summary">
        <div><span className="eyebrow">ВЫПОЛНЕНО ПУНКТОВ</span><strong>{complete} из {planned.length}</strong></div>
        <div><span className="eyebrow">ПРОГРЕСС</span><strong>{planned.length ? Math.round(complete / planned.length * 100) : 0}%</strong></div>
      </div>
      <div className="ramadan-days" aria-label="Дни Рамадана">
        {dates.map((date, index) => {
          const daily = ramadanTasks.filter(t => t.date === date);
          const done = daily.filter(t => t.completed).length;
          return <button type="button" key={date} className={`ramadan-day ${selected === index ? 'active' : ''}`} onClick={() => setSelected(index)} aria-pressed={selected === index}>
            <span>День</span><strong>{String(index + 1).padStart(2, '0')}</strong><small>{format(parseISO(date), 'd MMM', { locale: ru })}</small>
            <span className="ramadan-day-count">{daily.length ? `${done}/${daily.length}` : '—'}</span>
          </button>;
        })}
      </div>
      <div className="ramadan-work">
        <div className="ramadan-work-heading">
          <div><span className="eyebrow">ПЛАН ПОКЛОНЕНИЯ И ДОБРЫХ ДЕЛ</span><h2>День {selected + 1}</h2><p>{format(parseISO(dayKey), 'd MMMM yyyy', { locale: ru })} · выполнено {dayDone} из {dayTasks.length}</p></div>
          <div className="ramadan-plan-actions">
            <button type="button" className="ramadan-add-button" onClick={fillSample}>+ {dayTasks.length ? 'Дополнить образцом' : 'Заполнить образцом'}</button>
            {selected < dates.length - 1 && <button type="button" className="ramadan-copy-button" onClick={copyNextDay} disabled={!dayTasks.length}>Копировать на следующий день →</button>}
          </div>
        </div>
        <div className="ramadan-checklist">
          {dayTasks.length === 0 && <p className="ramadan-hint">Пока задач нет. Добавьте готовые ежедневные дела или свою цель.</p>}
          {dayTasks.map(task => (
            <RamadanTaskCard
              key={task.id}
              task={task}
              onToggle={toggleTask}
              onUpdate={updateTask}
              onDelete={deleteTask}
            />
          ))}
        </div>
        <div className="ramadan-clear-actions">
          <button
            type="button"
            className="ramadan-clear-button"
            onClick={clearSelectedDay}
            disabled={dayTasks.length === 0}
            aria-label={`Очистить все задачи дня ${selected + 1}`}
          >
            <span aria-hidden="true">✕</span> Очистить все задачи
          </button>
          <span className="ramadan-clear-caption">Только день {selected + 1} · {dayTasks.length} задач</span>
        </div>
        <form className="ramadan-custom" onSubmit={e => { e.preventDefault(); createTask(customTitle); setCustomTitle(''); }}>
          <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Своя цель или доброе дело" aria-label="Новая цель Рамадана" maxLength={500} />
          <button type="submit" disabled={!customTitle.trim()}>Добавить</button>
        </form>
      </div>
    </>}
    </>}
    <footer className="page-footer-line"><span>ВРЕМЯ — ДОВЕРЕННОЕ БЛАГО</span><span>© ПЛАНЕР</span></footer>
  </section>;
}
