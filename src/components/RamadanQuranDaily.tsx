import { useEffect, useState } from 'react';
import type { QuranReadingState, Task, TaskActions } from '../types';
import { QuranPageReader } from './QuranPageReader';
import {
  PRAYER_LABELS, QURAN_TRACKER_CATEGORY, READINGS_PER_DAY,
  completedDaySessions, pagesReadInSession, quranPageRange,
} from '../utils/quranReading';

type Props = {
  tasks: Task[];
  updateTask: TaskActions['updateTask'];
  dates: string[];
  selected: number;
  onOpenQuran: () => void;
};

/**
 * The five Quran readings are real, interactive goals on the Ramadan day page.
 * They update the same cloud-synced tracker as the dedicated Quran tab;
 * no second copy of the reading plan or pages is created.
 */
export function RamadanQuranDaily({ tasks, updateTask, dates, selected, onOpenQuran }: Props) {
  const record = tasks.find(task => task.category === QURAN_TRACKER_CATEGORY);
  const plan = record?.quranReading ?? null;
  const validPlan = Boolean(plan && dates[0] && plan.startDate === dates[0]);
  const [activePrayer, setActivePrayer] = useState<number | null>(null);
  const [readerPage, setReaderPage] = useState(1);

  // Never keep a reader from another day or a newly reset reading pace open.
  useEffect(() => {
    setActivePrayer(null);
  }, [selected, plan?.pace, plan?.startDate]);

  const save = (next: QuranReadingState) => {
    if (!record) return;
    updateTask(record.id, {
      title: record.title,
      date: next.startDate,
      time: '',
      endTime: '',
      priority: 'low',
      category: QURAN_TRACKER_CATEGORY,
      repeatReminder: false,
      quranReading: next,
    });
  };

  if (!plan || !validPlan) {
    return (
      <section className="quran-start-note" aria-label="Чтение Корана после намазов">
        <strong>📖 Коран после пяти намазов</strong>
        <p>{plan
          ? 'Дата начала Рамадана изменилась. Обновите план чтения, чтобы сохранить правильные страницы.'
          : 'Добавьте пять чтений Корана в ежедневные задачи. Выберите темп на 30, 15 или 10 дней и читайте прямо здесь.'}</p>
        <button type="button" onClick={onOpenQuran}>
          {plan ? 'Обновить план чтения' : 'Выбрать план чтения'}
        </button>
      </section>
    );
  }

  const daySessions = PRAYER_LABELS.map((label, prayer) => {
    const session = selected * READINGS_PER_DAY + prayer;
    return {
      label, prayer, session,
      range: quranPageRange(plan.pace, selected, prayer),
      read: pagesReadInSession(plan, session),
      completed: plan.completedSessions.includes(session),
    };
  });
  const dayPages = daySessions.reduce((sum, item) => sum + item.range.pages, 0);
  const readPages = daySessions.reduce((sum, item) => sum + item.read, 0);
  const done = completedDaySessions(plan, selected);

  const toggleSession = (session: number) => {
    const checked = new Set(plan.completedSessions);
    const progress = { ...plan.pageProgress };
    if (checked.has(session)) {
      checked.delete(session);
      delete progress[String(session)];
    } else {
      checked.add(session);
      progress[String(session)] = quranPageRange(
        plan.pace, Math.floor(session / READINGS_PER_DAY), session % READINGS_PER_DAY,
      ).pages;
    }
    save({ ...plan, completedSessions: [...checked].sort((a, b) => a - b), pageProgress: progress });
  };

  const openReading = (session: number) => {
    const range = quranPageRange(
      plan.pace, Math.floor(session / READINGS_PER_DAY), session % READINGS_PER_DAY,
    );
    const bookmark = plan.bookmark?.session === session ? plan.bookmark.page : null;
    const read = pagesReadInSession(plan, session);
    setReaderPage(bookmark ?? Math.min(range.end, range.start + read));
    setActivePrayer(session % READINGS_PER_DAY);
  };

  const markPageRead = (session: number, page: number) => {
    const range = quranPageRange(
      plan.pace, Math.floor(session / READINGS_PER_DAY), session % READINGS_PER_DAY,
    );
    if (page < range.start || page > range.end) return;
    const read = pagesReadInSession(plan, session);
    // Count only the next unread page, not a page the reader merely opened.
    const nextRead = page === range.start + read ? read + 1 : read;
    const completed = new Set(plan.completedSessions);
    if (nextRead >= range.pages) completed.add(session);
    save({
      ...plan,
      completedSessions: [...completed].sort((a, b) => a - b),
      pageProgress: { ...plan.pageProgress, [String(session)]: nextRead },
    });
    setReaderPage(Math.min(range.end, page + 1));
  };

  const saveBookmark = (session: number, page: number) => {
    save({ ...plan, bookmark: { session, page } });
  };

  return (
    <section className="quran-reading-day" aria-label="Ежедневные задачи чтения Корана">
      <div className="quran-pace-heading">
        <div>
          <span className="quran-reading-eyebrow">📖 КОРАН · ЗАДАЧИ ПОСЛЕ НАМАЗОВ</span>
          <h3>Пять чтений на сегодня</h3>
        </div>
        <button type="button" className="quran-reading-open" onClick={onOpenQuran}>
          Настроить план
        </button>
      </div>
      <p className="quran-day-date">
        Чтений выполнено: {done} из {READINGS_PER_DAY} · Страниц прочитано: {readPages} из {dayPages}
      </p>
      <div className="quran-reading-checklist">
        {daySessions.map(({ label, prayer, session, range, read, completed }) => (
          <div
            key={session}
            className={'quran-reading-item' + (completed ? ' quran-reading-item--done' : '')}
          >
            <div className={'quran-reading-row' + (completed ? ' quran-reading-row--done' : '')}>
              <input
                type="checkbox"
                checked={completed}
                onChange={() => toggleSession(session)}
                aria-label={'Отметить чтение: ' + label}
              />
              <div className="quran-reading-row-body">
                <strong>{label}</strong>
                <span>Страницы {range.start}–{range.end}</span>
                <span className="quran-reading-slot-progress">Прочитано {read} из {range.pages} страниц</span>
                {plan.bookmark?.session === session && <small>🔖 Закладка: стр. {plan.bookmark.page}</small>}
              </div>
              <button
                type="button"
                className="quran-reading-open"
                aria-expanded={activePrayer === prayer}
                onClick={() => activePrayer === prayer ? setActivePrayer(null) : openReading(session)}
              >
                {activePrayer === prayer ? 'Свернуть' : completed ? 'Перечитать' : read > 0 ? 'Продолжить' : '📖 Читать'}
              </button>
            </div>
            {activePrayer === prayer && (
              <QuranPageReader
                page={readerPage}
                firstPage={range.start}
                lastPage={range.end}
                readCount={read}
                isBookmarked={plan.bookmark?.session === session && plan.bookmark.page === readerPage}
                onClose={() => setActivePrayer(null)}
                onBack={() => setReaderPage(page => Math.max(range.start, page - 1))}
                onReadPage={() => markPageRead(session, readerPage)}
                onBookmark={() => saveBookmark(session, readerPage)}
              />
            )}
          </div>
        ))}
      </div>
      {done === READINGS_PER_DAY && (
        <p className="quran-day-success" role="status">
          🌿 Альхамдулиллях! Все пять чтений Корана за этот день выполнены.
        </p>
      )}
    </section>
  );
}
