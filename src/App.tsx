import { useEffect, useState } from 'react';
import type { Task, TaskInput, RecurrenceScope, ViewMode } from './types';
import { useTasks } from './hooks/useTasks';
import { Header } from './components/Header';
import { CloudSync } from './components/CloudSync';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { RamadanView } from './components/RamadanView';
import { QURAN_TRACKER_CATEGORY } from './utils/quranReading';

// During GitHub Pages builds this value is set to the commit SHA.
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

export default function App() {
  const [view, setView] = useState<ViewMode>('day');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const taskStore = useTasks();
  const [scopeDialog, setScopeDialog] = useState<{ kind: 'edit' | 'delete'; id: string; input?: TaskInput } | null>(null);
  // A single cloud-synced Quran tracker is an internal record, never a goal
  // in the normal Day / Week / Month task calendar.
  const rangeStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
  const rangeEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 2, 0);
  const visibleTasks: Task[] = taskStore.tasks.flatMap(task => {
    if (task.category === QURAN_TRACKER_CATEGORY) return [];
    if (!task.recurrence || task.recurrence === 'none') return [task];
    const [year, month, day] = task.date.split('-').map(Number);
    const first = new Date(year, month - 1, day);
    const start = new Date(Math.max(first.getTime(), rangeStart.getTime()));
    const results: Task[] = [];
    const keyOf = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    for (let current = new Date(start); current <= rangeEnd; current.setDate(current.getDate() + 1)) {
      const diff = Math.round((Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) - Date.UTC(year, month - 1, day)) / 86400000);
      const matches = task.recurrence === 'daily' ||
        (task.recurrence === 'weekly' && diff % 7 === 0) ||
        (task.recurrence === 'monthly' && current.getDate() === Math.min(day, new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()));
      if (!matches || diff < 0 || (task.recurrenceUntil && keyOf(current) >= task.recurrenceUntil)) continue;
      const date = keyOf(current);
      if (task.recurrenceSkipped?.includes(date)) continue;
      const override = task.recurrenceOverrides?.[date];
      results.push({ ...task, ...override, id: task.id + '::' + date, date: override?.date ?? date, completed: (task.recurrenceCompleted ?? []).includes(date) });
    }
    return results;
  });
  const updateOccurrence = (id: string, input: TaskInput) => {
    if (id.includes('::')) setScopeDialog({ kind: 'edit', id, input });
    else taskStore.updateTask(id, input);
  };
  const deleteOccurrence = (id: string) => {
    if (id.includes('::')) setScopeDialog({ kind: 'delete', id });
    else taskStore.deleteTask(id);
  };
  const chooseScope = (scope: RecurrenceScope) => {
    if (!scopeDialog) return;
    if (scopeDialog.kind === 'edit' && scopeDialog.input)
      taskStore.updateRecurringTask?.(scopeDialog.id, scopeDialog.input, scope);
    if (scopeDialog.kind === 'delete')
      taskStore.deleteRecurringTask?.(scopeDialog.id, scope);
    setScopeDialog(null);
  };
  const recurringActions = { ...taskStore, updateTask: updateOccurrence, deleteTask: deleteOccurrence };

  useEffect(() => {
    if (!APP_VERSION) return;
    let active = true;

    const checkForUpdates = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        // The query and no-store option bypass Safari's normal static-file cache.
        const endpoint = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) return;
        const info: unknown = await response.json();
        if (
          active && info !== null && typeof info === 'object' &&
          'version' in info && typeof info.version === 'string' &&
          info.version !== APP_VERSION
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        // Remain fully usable while offline.
      }
    };

    void checkForUpdates();
    const timer = window.setInterval(() => { void checkForUpdates(); }, 60000);
    const onFocus = () => { void checkForUpdates(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  function reloadUpdatedVersion() {
    // Preserve localStorage; force a new HTML request for the updated build.
    const url = new URL(window.location.href);
    url.searchParams.set('refresh', String(Date.now()));
    window.location.assign(url.toString());
  }

  function openDay(date: Date) {
    setSelectedDate(date);
    setView('day');
  }

  function changeView(nextView: ViewMode) {
    // The "ДЕНЬ" tab is a one-tap shortcut back to today's goals,
    // even if another date was previously selected.
    if (nextView === 'day') setSelectedDate(new Date());
    setView(nextView);
  }

  return (
    <div className="app-shell">
      <Header view={view} onChangeView={changeView} />
      <CloudSync tasks={taskStore.tasks} replaceAllTasks={taskStore.replaceAllTasks} />
      {updateAvailable && (
        <div className="update-banner" role="status">
          <span>Вышла новая версия Планера. Ваши задачи сохранятся.</span>
          <button type="button" className="update-banner-button" onClick={reloadUpdatedVersion}>
            Обновить Планер
          </button>
        </div>
      )}
      {scopeDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="recurrence-scope-title" style={{ width: 'min(100%, 420px)', background: '#fff', color: '#183b32', borderRadius: 22, padding: 24 }}>
            <h2 id="recurrence-scope-title" style={{ fontSize: 21, marginBottom: 20 }}>{scopeDialog.kind === 'edit' ? 'Изменить повторяющуюся задачу' : 'Удалить повторяющуюся задачу'}</h2>
            {([['single', 'Только эту задачу'], ['future', 'Эту и все последующие'], ['all', 'Все задачи серии']] as const).map(([scope, label]) => (
              <button key={scope} type="button" onClick={() => chooseScope(scope)} style={{ display: 'block', width: '100%', padding: '15px 12px', marginBottom: 9, borderRadius: 13, border: '1px solid #c7d8d0', background: '#f3f8f5', color: '#183b32', fontSize: 16 }}>{label}</button>
            ))}
            <button type="button" onClick={() => setScopeDialog(null)} style={{ display: 'block', width: '100%', padding: 14, border: 'none', background: 'transparent', color: '#183b32', fontSize: 16 }}>Отмена</button>
          </div>
        </div>
      )}
      <main>
        {view === 'day' && (
          <DayView date={selectedDate} onChangeDate={setSelectedDate} {...recurringActions} tasks={visibleTasks} />
        )}
        {view === 'week' && (
          <WeekView date={selectedDate} onChangeDate={setSelectedDate} onOpenDay={openDay} {...recurringActions} tasks={visibleTasks} />
        )}
        {view === 'ramadan' && <RamadanView {...taskStore} />}
        {view === 'month' && (
          <MonthView date={selectedDate} onChangeDate={setSelectedDate} onOpenDay={openDay} tasks={visibleTasks} />
        )}
      </main>
    </div>
  );
}
