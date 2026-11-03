import { useEffect, useState } from 'react';

type Ticket = { url: string; requestId: string; expiresIn: number };
type Result = { status: 'pending' | 'authenticated' | 'linked'; token?: string; joinRequired?: boolean };
type Mode = 'login' | 'link';

type Props = {
  mode: Mode;
  token?: string;
  onAuthenticated?: (token: string) => void;
  onLinked?: () => void;
};

export function TelegramConnect({ mode, token, onAuthenticated, onLinked }: Props) {
  const [available, setAvailable] = useState(false);
  const [botUrl, setBotUrl] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [working, setWorking] = useState(false);
  const [joinRequired, setJoinRequired] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((config: { telegram: boolean; botUrl?: string; groupUrl?: string }) => {
        if (!cancelled) {
          setAvailable(config.telegram);
          setBotUrl(config.botUrl || '');
          setGroupUrl(config.groupUrl || '');
          setConfigurationLoaded(true);
        }
      })
      .catch(() => { if (!cancelled) { setAvailable(false); setConfigurationLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  async function begin() {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/telegram/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({
          mode,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      });
      if (!response.ok) throw Error(response.status === 403
        ? 'Привязка доступна при входе через Google.'
        : 'Не удалось создать ссылку для входа (' + response.status + ').');
      const next = await response.json() as Ticket;
      setJoinRequired(false);
      setTicket(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключить Telegram.');
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    let querying = false;
    const poll = async () => {
      if (cancelled || querying || document.visibilityState === 'hidden') return;
      querying = true;
      try {
        const res = await fetch('/api/telegram/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: ticket.requestId }),
          cache: 'no-store',
        });
        if (res.status === 410) {
          if (!cancelled) { setTicket(null); setError('Ссылка устарела. Создайте новую.'); }
          return;
        }
        if (!res.ok) return;
        const data = await res.json() as Result;
        if (cancelled) return;
        if (data.status === 'pending') {
          setJoinRequired(Boolean(data.joinRequired));
          return;
        }
        setTicket(null);
        if (data.status === 'authenticated' && data.token) onAuthenticated?.(data.token);
        if (data.status === 'linked') onLinked?.();
      } catch {
        // The app may be backgrounded while Telegram is open. Keep polling.
      } finally {
        querying = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    const onVisible = () => { void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [ticket, onAuthenticated, onLinked]);

  if (!available) return mode === 'login' && configurationLoaded
    ? <span className="telegram-not-ready">Вход через Telegram настраивается. Повторите попытку позже.</span>
    : null;
  return <div className="telegram-auth">
    {!ticket ? <button type="button" disabled={working} onClick={() => { void begin(); }}>
      {working ? 'Подключаем Telegram…' : mode === 'login' ? '✈ Войти через Telegram' : '✈ Привязать Telegram'}
    </button> : <div className="telegram-confirm">
      <a href={ticket.url} target="_blank" rel="noopener noreferrer">Открыть бота в Telegram</a>
      <span>Нажмите Start у бота. При первом входе вступите в группу и нажмите «✅ Проверить подписку» в чате бота. В следующие разы вступать не потребуется.</span>
      {joinRequired && groupUrl && <a href={groupUrl} target="_blank" rel="noopener noreferrer">🌙 Вступить в группу Планера (только один раз)</a>}
      <button type="button" onClick={() => { setTicket(null); setJoinRequired(false); }}>Отменить</button>
    </div>}
    {mode === 'login' && <small>Новые пользователи один раз вступают в Telegram-группу и подтверждают участие через бота. Последующие входы — без новой подписки. Напоминания можно отключить командой /stop.</small>}
    {mode === 'link' && <small>Свяжем Telegram с существующим аккаунтом, сохранив ваши задачи. Участие в группе проверяется только при первой привязке.</small>}
    {error && <span className="cloud-error" role="alert">{error}</span>}
    {mode === 'link' && botUrl && <a className="telegram-bot-link" href={botUrl} target="_blank" rel="noopener noreferrer">Открыть чат бота</a>}
  </div>;
}
