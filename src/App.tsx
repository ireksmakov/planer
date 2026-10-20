import { useState } from 'react';
import type { ViewMode } from './types';
import { useTasks } from './hooks/useTasks';
import { Header } from './components/Header';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';

export default function App() {
  const [view, setView] = useState<ViewMode>('day');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const taskStore = useTasks();

  function openDay(date: Date) {
    setSelectedDate(date);
    setView('day');
  }

  return (
    <div className="app-shell">
      <Header view={view} onChangeView={setView} />
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
