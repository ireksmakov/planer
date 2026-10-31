import { useMemo, useState } from 'react';
import type { Task, TaskActions } from '../types';
import { format, addDays, parseISO, isValid } from 'date-fns';
import { ru } from 'date-fns/locale';

const START_KEY = 'planer.ramadan.start.v1';
const CATEGORY = 'Рамадан';
const HABITS = ['Намаз вовремя', 'Чтение Корана', 'Дуа и зикр', 'Доброе дело / садака', 'Размышление и благодарность'];

type Props = { tasks: Task[] } & TaskActions;

export function RamadanView({ tasks, addTask, toggleTask, deleteTask }: Props) {
  const [start, setStart] = useState(() => localStorage.getItem(START_KEY) || '');
  const [selected, setSelected] = useState(0);
  const [customTitle, setCustomTitle] = useState('');
  const base = useMemo(() => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(start)) return null;
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
  const addHabits = () => {
    for (const habit of HABITS) if (!dayTasks.some(t => t.title === habit)) createTask(habit);
  };

  return <section className="ramadan-page page-section">
    <div className="ramadan-hero">
      <span className="eyebrow">МЕСЯЦ ДОБРЫХ НАМЕРЕНИЙ</span>
      <h1>Рамадан <span aria-hidden="true">☾</span></h1>
      <p>Планируйте поклонение, добрые дела и личные цели — день за днём.</p>
      <span lang="ar" dir="rtl" className="ramadan-arabic">رَمَضَانُ مُبَارَكٌ</span>
    </div>
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
          <button className="ramadan-add-button" onClick={addHabits}>+ Добавить ежедневные дела</button>
        </div>
        <div className="ramadan-checklist">
          {dayTasks.length === 0 && <p className="ramadan-hint">Пока задач нет. Добавьте готовые ежедневные дела или свою цель.</p>}
          {dayTasks.map(t => <div className="ramadan-task" key={t.id}>
            <label><input type="checkbox" checked={t.completed} onChange={() => toggleTask(t.id)} /><span className={t.completed ? 'done' : ''}>{t.title}</span></label>
            <button type="button" onClick={() => deleteTask(t.id)} aria-label={`Удалить: ${t.title}`}>Удалить</button>
          </div>)}
        </div>
        <form className="ramadan-custom" onSubmit={e => { e.preventDefault(); createTask(customTitle); setCustomTitle(''); }}>
          <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Своя цель или доброе дело" aria-label="Новая цель Рамадана" maxLength={500} />
          <button type="submit" disabled={!customTitle.trim()}>Добавить</button>
        </form>
      </div>
    </>}
    <footer className="page-footer-line"><span>ВРЕМЯ — ДОВЕРЕННОЕ БЛАГО</span><span>© ПЛАНЕР</span></footer>
  </section>;
}
