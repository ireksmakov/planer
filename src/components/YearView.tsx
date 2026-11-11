import type { Task } from '../types';
type Props = { date: Date; tasks: Task[]; onOpenMonth: (date: Date) => void; onChangeYear: (date: Date) => void };
const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export function YearView({ date, tasks, onOpenMonth, onChangeYear }: Props) {
  const year = date.getFullYear();
  const monthData = months.map((name, month) => {
    const prefix = `${year}-${String(month + 1).padStart(2,'0')}-`;
    const entries = tasks.filter(t => t.date.startsWith(prefix));
    return { name, month, total: entries.length, completed: entries.filter(t => t.completed).length };
  });
  const total = monthData.reduce((sum,m) => sum + m.total,0);
  const completed = monthData.reduce((sum,m) => sum + m.completed,0);
  return <section style={{ maxWidth: 1050, margin: '0 auto', padding: '28px 16px 70px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <button type="button" onClick={() => onChangeYear(new Date(year - 1, date.getMonth(), 1))} aria-label="Предыдущий год">← Пред.</button>
      <h1 style={{ fontSize: 'clamp(28px,5vw,42px)', margin: 0 }}>Год · {year}</h1>
      <button type="button" onClick={() => onChangeYear(new Date(year + 1, date.getMonth(), 1))} aria-label="Следующий год">След. →</button>
    </div>
    <p style={{ marginBottom: 24 }}>Выполнено {completed} из {total} задач за год</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      {monthData.map(m => <button key={m.month} type="button" onClick={() => onOpenMonth(new Date(year,m.month,1))}
        style={{ padding: 22, border: '1px solid #d4c7a6', borderRadius: 16, background: '#faf8f0', color: '#183b32', textAlign: 'left', cursor: 'pointer' }}>
        <strong style={{ display: 'block', fontSize: 22, marginBottom: 12 }}>{m.name}</strong>
        <span style={{ fontSize: 14 }}>Выполнено {m.completed} из {m.total}</span>
        <span aria-hidden="true" style={{ display: 'block', height: 7, background: '#e0e6df', borderRadius: 5, marginTop: 12, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${m.total ? m.completed / m.total * 100 : 0}%`, background: '#2f7660' }}/>
        </span>
      </button>)}
    </div>
  </section>;
}
