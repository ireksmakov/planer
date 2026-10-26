import { useEffect, useState } from 'react';
import type { ViewMode } from './types';
import { useTasks } from './hooks/useTasks';
import { Header } from './components/Header';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';

// During GitHub Pages builds this value is set to the commit SHA.
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

export default function App() {
  const [view, setView] = useState<ViewMode>('day');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const taskStore = useTasks();

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

  return (
    <div className="app-shell">
      <Header view={view} onChangeView={setView} />
      {updateAvailable && (
        <div className="update-banner" role="status">
          <span>Вышла новая версия Планера. Ваши задачи сохранятся.</span>
          <button type="button" className="update-banner-button" onClick={reloadUpdatedVersion}>
            Обновить Планер
          </button>
        </div>
      )}
      <main>
        {view === 'day' && (
          <DayView date={selectedDate} onChangeDate={setSelectedDate} {...taskStore} />
        )}
        {view === 'week' && (
          <WeekView date={selectedDate} onChangeDate={setSelectedDate} onOpenDay={openDay} {...taskStore} />
        )}
        {view === 'month' && (
          <MonthView date={selectedDate} onChangeDate={setSelectedDate} onOpenDay={openDay} tasks={taskStore.tasks} />
        )}
      </main>
    </div>
  );
}
