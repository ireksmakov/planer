import { useState } from 'react';
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
  { key: 'year', title: 'Год', number: '04' },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = views.find(item => item.key === view);
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
      <nav className="view-tabs" aria-label="Разделы Планера" style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
          <button type="button" className={`view-tab ${views.some(item => item.key === view) ? 'is-active' : ''}`}
            aria-expanded={menuOpen} aria-haspopup="true" aria-controls="planning-view-menu"
            onClick={() => setMenuOpen(open => !open)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', minHeight: 52 }}>
            <span>Планирование · {selected?.title ?? 'День'}</span><span aria-hidden="true">{menuOpen ? '▴' : '▾'}</span>
          </button>
          {menuOpen && <div id="planning-view-menu" role="group" aria-label="Выбор периода"
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, padding: 8, background: '#faf8f0', border: '1px solid #d7c9a8', borderRadius: 12, boxShadow: '0 12px 28px rgba(0,0,0,.14)' }}>
            {views.map(({ key, title }) => <button key={key} type="button" aria-current={view === key ? 'page' : undefined}
              onClick={() => { onChangeView(key); setMenuOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderRadius: 8,
                background: view === key ? '#e3ebe4' : 'transparent', color: '#173c30', fontSize: 16, fontWeight: view === key ? 700 : 500 }}>
              {view === key ? '✓ ' : ''}{title}
            </button>)}
          </div>}
        </div>
        {([['ramadan','Рамадан'],['health','Здоровье']] as const).map(([key,title]) => (
          <button key={key} type="button" className={`view-tab ${view === key ? 'is-active' : ''}`}
            onClick={() => { onChangeView(key); setMenuOpen(false); }}
            aria-current={view === key ? 'page' : undefined}
            style={{ flex: '1 1 120px', minHeight: 52, textAlign: 'center' }}>{title}</button>
        ))}
      </nav>
    </header>
  );
}
