import { useEffect, useState } from 'react';

type Ticket = { url: string; requestId: string; expiresIn: number };
type Result = { status: 'pending' | 'authenticated' | 'linked'; token?: string };
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
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((config: { telegram: boolean; botUrl?: string }) => {
        if (!cancelled) {
          setAvailable(config.telegram);
          setBotUrl(config.botUrl || '');
        }
      })
      .catch(() => { if (!cancelled) setAvailable(false); });
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
        if (cancelled || data.status === 'pending') return;
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

  if (!available) return null;
  return <div className="telegram-auth">
    {!ticket ? <button type="button" disabled={working} onClick={() => { void begin(); }}>
      {working ? 'Подключаем Telegram…' : mode === 'login' ? '✈ Войти через Telegram' : '✈ Привязать Telegram'}
    </button> : <div className="telegram-confirm">
      <a href={ticket.url} target="_blank" rel="noopener noreferrer">Открыть бота в Telegram</a>
      <span>Нажмите Start в личном чате бота, затем вернитесь в «Планер». Вход подтвердится автоматически.</span>
      <button type="button" onClick={() => setTicket(null)}>Отменить</button>
    </div>}
    {mode === 'login' && <small>Для входа нужен Telegram. После подтверждения бот сможет отправлять напоминания; отключить их можно командой /stop.</small>}
    {mode === 'link' && <small>Свяжем Telegram с текущим Google-аккаунтом, сохранив ваши задачи. Напоминания будут приходить в личный чат бота.</small>}
    {error && <span className="cloud-error" role="alert">{error}</span>}
    {mode === 'link' && botUrl && <a className="telegram-bot-link" href={botUrl} target="_blank" rel="noopener noreferrer">Открыть чат бота</a>}
  </div>;
}
