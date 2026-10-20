import type { ViewMode } from '../types';
import { dateLabel, today } from '../utils/date';

interface HeaderProps {
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
}

const views: { key: ViewMode; title: string; number: string }[] = [
  { key: 'day', title: 'День', number: '01' },
  { key: 'week', title: 'Неделя', number: '02' },
  { key: 'month', title: 'Месяц', number: '03' },
];

export function Header({ view, onChangeView }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="masthead">
        <div className="masthead-identity">
          <span className="eyebrow brand-kicker">ПЕРСОНАЛЬНОЕ ПРОСТРАНСТВО / 001</span>
          <span className="brand-name">Планер<span className="brand-period">.</span></span>
        </div>
        <div className="masthead-side">
          <span className="eyebrow">ВРЕМЯ ДЛЯ ГЛАВНОГО</span>
          <span className="masthead-date">{dateLabel(today(), 'd MMMM yyyy')}</span>
        </div>
      </div>
      <nav className="view-tabs" aria-label="Режим просмотра">
        {views.map(({ key, title, number }) => (
          <button
            key={key}
            type="button"
            className={`view-tab ${view === key ? 'is-active' : ''}`}
            onClick={() => onChangeView(key)}
            aria-current={view === key ? 'page' : undefined}
          >
            <span className="tab-number">{number}</span>
            {title}
          </button>
        ))}
        <span className="tabs-note">МЕНЬШЕ ШУМА. БОЛЬШЕ СМЫСЛА.</span>
      </nav>
    </header>
  );
}
