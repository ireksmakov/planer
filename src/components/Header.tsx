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
function EightPointStar() {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">
      <rect x="22" y="22" width="56" height="56" stroke="currentColor" strokeWidth="1.8"/>
      <rect x="22" y="22" width="56" height="56" stroke="currentColor" strokeWidth="1.8" transform="rotate(45 50 50)"/>
      <circle cx="50" cy="50" r="14" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="50" cy="50" r="3" fill="currentColor"/>
    </svg>
  );
}
export function Header({ view, onChangeView }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="ornament-line" aria-hidden="true">
        <svg viewBox="0 0 720 20" preserveAspectRatio="none">
          <defs>
            <pattern id="ornamental-band" width="36" height="20" patternUnits="userSpaceOnUse">
              <path d="M0 10L9 1L18 10L9 19Z M18 10L27 1L36 10L27 19Z" fill="none" stroke="currentColor" strokeWidth=".8"/>
              <path d="M9 1V19 M27 1V19 M0 10H36" fill="none" stroke="currentColor" strokeWidth=".5"/>
            </pattern>
          </defs>
          <rect width="720" height="20" fill="url(#ornamental-band)"/>
        </svg>
      </div>
      <div className="top-message">
        <span className="eyebrow">ДЕНЬ ЗА ДНЁМ · С ДОБРЫМ НАМЕРЕНИЕМ</span>
        <span className="top-message-arabic" lang="ar" dir="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</span>
      </div>
      <div className="masthead">
        <div className="masthead-identity">
          <div className="masthead-brandrow">
            <div className="brand-mark"><EightPointStar /></div>
            <div className="masthead-brandtext">
              <span className="eyebrow brand-kicker">ПРОСТРАНСТВО ДЛЯ ВАЖНОГО</span>
              <span className="brand-name">Планер<span className="brand-period">.</span></span>
            </div>
          </div>
          <p className="brand-subtitle">Пусть в каждом дне будет смысл и спокойствие.</p>
        </div>
        <div className="masthead-side">
          <span className="arabic-greeting" lang="ar" dir="rtl">السَّلَامُ عَلَيْكُمْ</span>
          <span className="eyebrow">СЕГОДНЯ</span>
          <span className="masthead-date">{dateLabel(today(), 'd MMMM yyyy')}</span>
        </div>
      </div>
      <nav className="view-tabs" aria-label="Режим просмотра">
        {views.map(({ key, title, number }) => (
          <button key={key} type="button" className={`view-tab ${view === key ? 'is-active' : ''}`}
            onClick={() => onChangeView(key)} aria-current={view === key ? 'page' : undefined}>
            <span className="tab-number">{number}</span>{title}
          </button>
        ))}
        <span className="tabs-note">НАМЕРЕНИЕ · ВРЕМЯ · ДЕЛА</span>
      </nav>
    </header>
  );
}
