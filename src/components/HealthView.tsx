import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Kind = 'pressure' | 'temperature' | 'medicine' | 'supplement' | 'note';
type RecordItem = { id: string; kind: Kind; date: string; time: string; title: string; notes: string;
  systolic: number | null; diastolic: number | null; pulse: number | null; temperature: number | null;
  dose: string; schedule: string; taken: boolean };
const kinds: { id: Kind; label: string }[] = [
  { id: 'pressure', label: 'Давление и пульс' }, { id: 'temperature', label: 'Температура' },
  { id: 'medicine', label: 'Лекарство' }, { id: 'supplement', label: 'БАД / витамин' }, { id: 'note', label: 'Самочувствие' },
];
const dateKey = () => new Date().toLocaleDateString('en-CA');
const timeKey = () => new Date().toTimeString().slice(0, 5);
const empty = (): RecordItem => ({ id: crypto.randomUUID(), kind: 'pressure', date: dateKey(), time: timeKey(),
  title: '', notes: '', systolic: null, diastolic: null, pulse: null, temperature: null, dose: '', schedule: '', taken: false });
const fieldStyle = { width: '100%', padding: '12px', borderRadius: 10, border: '1px solid #b6cbc1', background: '#fff', fontSize: 16 };
const panelStyle = { padding: 20, background: '#f4f8f5', border: '1px solid #d7e5dc', borderRadius: 18, marginBottom: 18 };
const labelStyle = { display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600 as const };
const tokenKey = 'planer.auth.session.v1';

export function HealthView() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [draft, setDraft] = useState<RecordItem>(empty);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const token = localStorage.getItem(tokenKey) || '';
  const request = useCallback(async (method: string, url: string, body?: RecordItem) => {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!response.ok) throw new Error('Ошибка сервера: ' + response.status);
    return response.json();
  }, [token]);
  const refresh = useCallback(async () => {
    if (!token) return;
    try { const data = await request('GET', '/api/health'); setRecords(data.records); setError(''); }
    catch { setError('Не удалось загрузить записи. Проверьте соединение и вход в аккаунт.'); }
  }, [request, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  const set = (patch: Partial<RecordItem>) => setDraft(old => ({ ...old, ...patch }));
  async function save(event: FormEvent) {
    event.preventDefault(); if (!token || busy) return;
    setBusy(true); setError('');
    try { await request('PUT', '/api/health', draft); await refresh(); setEditing(false); setDraft(empty()); }
    catch { setError('Не удалось сохранить запись. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Удалить запись о здоровье?')) return;
    setBusy(true);
    try { await request('DELETE', '/api/health/' + encodeURIComponent(id)); await refresh(); }
    catch { setError('Не удалось удалить запись.'); }
    finally { setBusy(false); }
  }
  const visible = records.filter(r => filter === 'all' || r.kind === filter)
    .sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time));
  return <section className="page-section" style={{ maxWidth: 880, margin: '0 auto', padding: '22px 16px 60px' }}>
    <span className="eyebrow">ЛИЧНЫЙ ДНЕВНИК</span>
    <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', margin: '10px 0' }}>❤️ Здоровье</h1>
    <p style={{ marginBottom: 22 }}>Измерения, самочувствие и журнал приёма назначенных средств.</p>
    {!token ? <div role="status" style={panelStyle}>Для сохранения медицинских записей войдите в свой аккаунт Telegram в верхней части Планера. Без входа данные не записываются на устройство.</div> : <>
      <button className="solid-button" type="button" onClick={() => { setDraft(empty()); setEditing(!editing); }}>＋ Новая запись</button>
      {error && <p role="alert" style={{ color: '#a12b39', marginTop: 12 }}>{error}</p>}
      {editing && <form onSubmit={save} style={{ ...panelStyle, marginTop: 20 }}>
        <h2 style={{ fontSize: 22, marginBottom: 16 }}>Запись о здоровье</h2>
        <label style={labelStyle}>Тип записи<select style={fieldStyle} value={draft.kind} onChange={e => set({ kind: e.target.value as Kind })}>
          {kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label style={labelStyle}>Дата<input style={fieldStyle} type="date" required value={draft.date} onChange={e => set({ date: e.target.value })}/></label>
          <label style={labelStyle}>Время<input style={fieldStyle} type="time" required value={draft.time} onChange={e => set({ time: e.target.value })}/></label>
        </div>
        {draft.kind === 'pressure' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {([['systolic','Верхнее, мм рт. ст.'],['diastolic','Нижнее, мм рт. ст.'],['pulse','Пульс, уд/мин']] as const).map(([key,label]) =>
            <label key={key} style={labelStyle}>{label}<input style={fieldStyle} type="number" required={key !== 'pulse'} min={key === 'systolic' ? 40 : 20} max={key === 'pulse' ? 250 : 300} value={draft[key] ?? ''} onChange={e => set({ [key]: e.target.value === '' ? null : Number(e.target.value) })}/></label>)}</div>}
        {draft.kind === 'temperature' && <label style={labelStyle}>Температура, °C<input style={fieldStyle} type="number" step="0.1" min="30" max="45" required value={draft.temperature ?? ''} onChange={e => set({ temperature: e.target.value === '' ? null : Number(e.target.value) })}/></label>}
        {(draft.kind === 'medicine' || draft.kind === 'supplement') && <>
          <label style={labelStyle}>Название<input style={fieldStyle} required maxLength={160} value={draft.title} onChange={e => set({ title: e.target.value })} placeholder="Название назначенного средства"/></label>
          <label style={labelStyle}>Дозировка по назначению<input style={fieldStyle} maxLength={100} value={draft.dose} onChange={e => set({ dose: e.target.value })} placeholder="Например, 1 таблетка"/></label>
          <label style={labelStyle}>План приёма<input style={fieldStyle} maxLength={500} value={draft.schedule} onChange={e => set({ schedule: e.target.value })} placeholder="Например, ежедневно после завтрака"/></label>
          <label style={labelStyle}><input type="checkbox" checked={draft.taken} onChange={e => set({ taken: e.target.checked })}/> Принято</label>
        </>}
        <label style={labelStyle}>Заметки<textarea style={{ ...fieldStyle, minHeight: 90 }} maxLength={2000} value={draft.notes} onChange={e => set({ notes: e.target.value })} placeholder="Самочувствие, симптомы, дополнительные сведения"/></label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="solid-button" disabled={busy} type="submit">{busy ? 'Сохраняем…' : 'Сохранить запись'}</button>
          <button type="button" className="text-action" onClick={() => setEditing(false)}>Отмена</button>
        </div>
      </form>}
      <div style={{ margin: '24px 0 14px' }}><label style={labelStyle}>История записей<select style={fieldStyle} value={filter} onChange={e => setFilter(e.target.value as Kind | 'all')}>
        <option value="all">Все записи</option>{kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select></label></div>
      {visible.length === 0 ? <p>Пока нет записей. Добавьте первое измерение или назначение.</p> : visible.map(r => <article key={r.id} style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
          <div><strong>{kinds.find(k => k.id === r.kind)?.label}</strong><p style={{ margin: '6px 0', opacity: .7 }}>{r.date} · {r.time}</p></div>
          <div style={{ display: 'flex', gap: 12 }}><button className="text-action" onClick={() => { setDraft(r); setEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Изменить</button><button className="text-action" disabled={busy} onClick={() => void remove(r.id)}>Удалить</button></div>
        </div>
        {r.kind === 'pressure' && <p style={{ fontSize: 22, fontWeight: 700 }}>{r.systolic}/{r.diastolic} мм рт. ст. {r.pulse != null ? '· Пульс ' + r.pulse : ''}</p>}
        {r.kind === 'temperature' && <p style={{ fontSize: 22, fontWeight: 700 }}>{r.temperature} °C</p>}
        {(r.kind === 'medicine' || r.kind === 'supplement') && <p><strong>{r.title}</strong> {r.dose} {r.schedule && <span>· {r.schedule}</span>} · {r.taken ? '✓ Принято' : 'Не отмечено'}</p>}
        {r.notes && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.notes}</p>}
      </article>)}
      <p style={{ fontSize: 13, opacity: .7 }}>Дневник не заменяет консультацию врача. Дозировки и назначения вносятся только по рекомендациям специалиста.</p>
    </>}
  </section>;
}
