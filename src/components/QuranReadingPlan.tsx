import { useState } from 'react';
import { QuranPageReader } from './QuranPageReader';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { QuranReadingPace, QuranReadingState, Task, TaskActions } from '../types';
import {
  QURAN_TRACKER_CATEGORY, QURAN_PACES, TOTAL_QURAN_PAGES,
  PRAYER_LABELS, READINGS_PER_DAY, RAMADAN_DAYS,
  pagesPerReading, quranPageRange, countCyclePages,
  completedDaySessions, completedKhatms, pagesReadInSession,
} from '../utils/quranReading';

type Props = {
  tasks: Task[];
  addTask: TaskActions['addTask'];
  updateTask: TaskActions['updateTask'];
  dates: string[];
  selected: number;
  onSelectDay: (day: number) => void;
  onOpenSetup: () => void;
};

const badges: Record<QuranReadingPace, string> = {
  30: '🌿', 15: '🏆', 12: '🥉', 10: '🥈', 6: '🥇',
};

export function QuranReadingPlan({
  tasks, addTask, updateTask, dates, selected, onSelectDay, onOpenSetup,
}: Props) {
  const [chosenPace, setChosenPace] = useState<QuranReadingPace>(30);
  const record = tasks.find(task => task.category === QURAN_TRACKER_CATEGORY);
  const plan = record?.quranReading ?? null;
  const currentStartDate = dates[0];
  const mismatchedStart = Boolean(plan && currentStartDate && plan.startDate !== currentStartDate);
  const [feedback, setFeedback] = useState('');
  const [activeSession, setActiveSession] = useState<number | null>(null);
  const [readerPage, setReaderPage] = useState(1);

  const persist = (reading: QuranReadingState) => {
    if (record) {
      updateTask(record.id, {
        title: record.title, date: reading.startDate, time: '',
        endTime: '', priority: 'low', category: QURAN_TRACKER_CATEGORY,
        repeatReminder: false, quranReading: reading,
      });
    } else {
      addTask({
        title: 'План чтения Корана', date: reading.startDate, time: '',
        priority: 'low', category: QURAN_TRACKER_CATEGORY,
        quranReading: reading,
      });
    }
  };

  const setPace = (pace: QuranReadingPace) => {
    setChosenPace(pace);
    setFeedback('');
    if (!currentStartDate) {
      setFeedback('Для начала укажите первый день Рамадана во вкладке «План».');
      return;
    }
    if (plan && plan.pace === pace && !mismatchedStart) return;
    if (plan && (plan.completedSessions.length > 0 || Object.values(plan.pageProgress ?? {}).some(x => x > 0)) &&
      !window.confirm('Изменить темп чтения? Отметки ранее прочитанных страниц в этом плане будут сброшены. Продолжить?')) {
      return;
    }
    persist({ pace, startDate: currentStartDate, completedSessions: [], pageProgress: {}, bookmark: null });
    setActiveSession(null);
    onSelectDay(0);
  };

  const toggleSession = (index: number) => {
    if (!plan || !currentStartDate || mismatchedStart) return;
    const checked = new Set(plan.completedSessions);
    const pageProgress = { ...plan.pageProgress };
    if (checked.has(index)) {
      checked.delete(index);
      delete pageProgress[String(index)];
    } else {
      checked.add(index);
      pageProgress[String(index)] = quranPageRange(
        plan.pace, Math.floor(index / READINGS_PER_DAY), index % READINGS_PER_DAY,
      ).pages;
    }
    persist({
      ...plan,
      completedSessions: [...checked].sort((a, b) => a - b),
      pageProgress,
    });
  };

  const openReading = (session: number, bookPage?: number) => {
    if (!plan || !currentStartDate || mismatchedStart) return;
    const day = Math.floor(session / READINGS_PER_DAY);
    const prayer = session % READINGS_PER_DAY;
    if (day < 0 || day >= RAMADAN_DAYS) return;
    const range = quranPageRange(plan.pace, day, prayer);
    const progress = pagesReadInSession(plan, session);
    setReaderPage(bookPage && bookPage >= range.start && bookPage <= range.end
      ? bookPage
      : Math.min(range.end, range.start + progress));
    setActiveSession(session);
    if (day !== selected) onSelectDay(day);
  };

  const markPageRead = (session: number, page: number) => {
    if (!plan || !currentStartDate || mismatchedStart) return;
    const day = Math.floor(session / READINGS_PER_DAY);
    const prayer = session % READINGS_PER_DAY;
    const range = quranPageRange(plan.pace, day, prayer);
    if (page < range.start || page > range.end) return;

    const existing = pagesReadInSession(plan, session);
    // Only a consecutive page extends real reading progress. Re-reading
    // pages already counted never increases it twice.
    const newlyRead = page === range.start + existing
      ? Math.min(range.pages, existing + 1) : existing;
    const completed = new Set(plan.completedSessions);
    if (newlyRead >= range.pages) completed.add(session);
    const nextPage = Math.min(range.end, page + 1);
    persist({
      ...plan,
      completedSessions: [...completed].sort((a, b) => a - b),
      pageProgress: { ...plan.pageProgress, [String(session)]: newlyRead },
      // Automatically remember reading position; explicit bookmark is separate.
    });
    setReaderPage(nextPage);
  };

  const saveBookmark = (session: number, page: number) => {
    if (!plan || !currentStartDate || mismatchedStart) return;
    const samePage = plan.bookmark?.session === session && plan.bookmark.page === page;
    persist({ ...plan, bookmark: samePage ? null : { session, page } });
  };

  const cycle = plan ? Math.floor(selected / plan.pace) : 0;
  const cyclePages = plan ? countCyclePages(plan, cycle) : 0;
  const cyclePercent = Math.min(100, Math.round((cyclePages / TOTAL_QURAN_PAGES) * 100));
  const sessionsDone = plan ? completedDaySessions(plan, selected) : 0;
  const khatmsDone = plan ? completedKhatms(plan) : 0;
  const dateLabel = dates[selected]
    ? format(parseISO(dates[selected]), 'd MMMM, EEEE', { locale: ru })
    : '';
  const chosen = plan?.pace ?? chosenPace;

  return (
    <section className="quran-reading-section" aria-label="План чтения Корана на Рамадан">
      <div className="quran-reading-hero">
        <div className="quran-reading-eyebrow">КОРАН · ПЯТЬ ЧТЕНИЙ ПОСЛЕ НАМАЗОВ</div>
        <h2>Путь к завершению Корана</h2>
        <p>Выберите удобный темп, читайте после пяти намазов и отмечайте каждое чтение. Каждый день — ещё один шаг к хатму.</p>
        <div className="quran-reading-arabic" lang="ar" dir="rtl">الْقُرْآنُ الْكَرِيمُ</div>
      </div>

      <div className="quran-pace-heading">
        <div>
          <span className="quran-reading-eyebrow">01 · ВЫБОР ТЕМПА</span>
          <h3>За сколько дней прочитать Коран?</h3>
        </div>
        <span className="quran-reading-helper">5 чтений каждый день</span>
      </div>
      <div className="quran-pace-grid" role="group" aria-label="Темп чтения">
        {QURAN_PACES.map(pace => (
          <button
            key={pace}
            type="button"
            className={`quran-pace-card ${chosen === pace ? 'quran-pace-card--selected' : ''}`}
            aria-pressed={Boolean(plan && plan.pace === pace)}
            onClick={() => setPace(pace)}
          >
            <span className="quran-pace-emoji" aria-hidden="true">{badges[pace]}</span>
            <span className="quran-pace-title">{pace} дней</span>
            <span className="quran-pace-amount">{pagesPerReading(pace)} стр.</span>
            <span className="quran-pace-description">после каждого намаза</span>
            {plan?.pace === pace && <span className="quran-pace-chosen">Выбрано ✓</span>}
          </button>
        ))}
      </div>
      {feedback && <p className="quran-reading-notice" role="status">{feedback}</p>}

      {!currentStartDate && (
        <div className="quran-start-note">
          <strong>Начните с даты Рамадана</strong>
          <p>Выберите первый день месяца в разделе «План», чтобы даты чтения совпадали с вашим календарём.</p>
          <button type="button" onClick={onOpenSetup}>Указать начало Рамадана</button>
        </div>
      )}

      {plan && mismatchedStart && (
        <div className="quran-start-note" role="alert">
          <strong>Дата Рамадана изменилась</strong>
          <p>Ранее план был начат {plan.startDate}. Чтобы не перепутать прочитанные страницы, выберите темп заново для новой даты.</p>
          <button type="button" onClick={() => setPace(plan.pace)}>Обновить дату плана</button>
        </div>
      )}

      {plan && Boolean(currentStartDate) && !mismatchedStart && (
        <>
          <div className="quran-progress-card">
            <span className="quran-reading-eyebrow">02 · ВАШ ПРОГРЕСС</span>
            <div className="quran-progress-stats">
              <div>
                <strong>{cyclePages} <small>из {TOTAL_QURAN_PAGES} стр.</small></strong>
                <span>В текущем чтении Корана</span>
              </div>
              <div>
                <strong>{khatmsDone}</strong>
                <span>Завершено хатмов за Рамадан</span>
              </div>
            </div>
            <div className="quran-progress-track" role="progressbar"
              aria-label="Прогресс текущего завершения Корана"
              aria-valuenow={cyclePages} aria-valuemin={0} aria-valuemax={TOTAL_QURAN_PAGES}>
              <span style={{ width: `${cyclePercent}%` }} />
            </div>
            <div className="quran-progress-foot">
              <span>Цикл {cycle + 1} · {plan.pace} дней</span>
              <strong>{cyclePercent}%</strong>
            </div>
          </div>

          <div className="quran-reading-day">
            <div className="quran-pace-heading">
              <div>
                <span className="quran-reading-eyebrow">03 · ЕЖЕДНЕВНОЕ ЧТЕНИЕ</span>
                <h3>Ваш план на день</h3>
              </div>
              <span className="quran-reading-helper">Отмечайте прочитанное</span>
            </div>
            <div className="quran-day-navigation">
              <button type="button" aria-label="Предыдущий день" disabled={selected === 0}
                onClick={() => onSelectDay(selected - 1)}>‹</button>
              <label>
                <span className="sr-only">Выбрать день Рамадана</span>
                <select value={selected} onChange={event => onSelectDay(Number(event.target.value))}>
                  {dates.map((date, index) => (
                    <option value={index} key={date}>День {index + 1} · {format(parseISO(date), 'd MMM', { locale: ru })}</option>
                  ))}
                </select>
              </label>
              <button type="button" aria-label="Следующий день"
                disabled={selected >= RAMADAN_DAYS - 1}
                onClick={() => onSelectDay(selected + 1)}>›</button>
            </div>
            <p className="quran-day-date">{dateLabel} · {sessionsDone} из {READINGS_PER_DAY} чтений</p>
            {plan.bookmark && (
              <button
                type="button"
                className="quran-bookmark-resume"
                onClick={() => openReading(plan.bookmark!.session, plan.bookmark!.page)}
              >
                🔖 Продолжить с закладки · страница {plan.bookmark.page}
              </button>
            )}
            <div className="quran-reading-checklist">
              {PRAYER_LABELS.map((label, index) => {
                const idx = selected * READINGS_PER_DAY + index;
                const checked = plan.completedSessions.includes(idx);
                const pages = quranPageRange(plan.pace, selected, index);
                const readCount = pagesReadInSession(plan, idx);
                const readingThis = activeSession === idx;
                const hasBookmark = plan.bookmark?.session === idx;
                return (
                  <div key={label} className={`quran-reading-item ${checked ? 'quran-reading-item--done' : ''}`}>
                    <div className={`quran-reading-row ${checked ? 'quran-reading-row--done' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSession(idx)}
                        aria-label={`Отметить чтение: ${label}`}
                      />
                      <div className="quran-reading-row-body">
                        <strong>{label}</strong>
                        <span>Страницы {pages.start}–{pages.end}</span>
                        {pages.lastReadingOfCycle && <small>Завершение Корана · последние 4 страницы дополнительно</small>}
                        <span className="quran-reading-slot-progress">Прочитано {readCount} из {pages.pages} страниц</span>
                      </div>
                      <button
                        type="button"
                        className="quran-reading-open"
                        aria-expanded={readingThis}
                        onClick={() => readingThis ? setActiveSession(null) : openReading(idx)}
                      >
                        {readingThis ? 'Свернуть' : checked ? 'Перечитать' : readCount > 0 ? 'Продолжить' : '📖 Читать'}
                      </button>
                    </div>
                    {readingThis && (
                      <QuranPageReader
                        page={readerPage}
                        firstPage={pages.start}
                        lastPage={pages.end}
                        readCount={readCount}
                        isBookmarked={Boolean(hasBookmark && plan.bookmark?.page === readerPage)}
                        onClose={() => setActiveSession(null)}
                        onBack={() => setReaderPage(page => Math.max(pages.start, page - 1))}
                        onReadPage={() => markPageRead(idx, readerPage)}
                        onBookmark={() => saveBookmark(idx, readerPage)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {sessionsDone === READINGS_PER_DAY && (
              <p className="quran-day-success" role="status">🌿 Альхамдулиллях! Все пять чтений этого дня отмечены.</p>
            )}
          </div>
        </>
      )}

      {!plan && (
        <div className="quran-start-note">
          <strong>Ваш личный план чтения</strong>
          <p>Нажмите на подходящий темп выше. «Планер» рассчитает точные страницы на каждый день и сохранит отметки в вашем аккаунте.</p>
        </div>
      )}

      <div className="quran-reading-footer">
        <strong>Почему в конце цикла немного больше?</strong>
        <p>В распространённом мединском мусхафе 604 страницы. Ровные порции дают 600 страниц, поэтому к последнему чтению каждого цикла добавлены ещё четыре. В других изданиях нумерация страниц может отличаться.</p>
        <p><strong>Читайте прямо здесь:</strong> нажмите «📖 Читать» после нужного намаза. Текст загрузится внутри Планера, а кнопка «Прочитано · Далее» будет автоматически учитывать страницы. Интернет требуется только для загрузки текста.</p>
        <p className="quran-reading-encouragement">Пусть Аллах благословит ваше время, укрепит намерение и сделает чтение Корана постоянной благой привычкой.</p>
      </div>
    </section>
  );
}
