import { useCallback, useEffect, useState } from 'react';

type Ticket = { url: string; requestId: string; expiresIn: number; expiresAt: number };
type LoginResult = { status: 'pending' | 'authenticated' | 'linked'; token?: string };
type Mode = 'login' | 'link';

type Props = {
  mode: Mode;
  token?: string;
  onAuthenticated?: (token: string) => void;
  onLinked?: () => void;
};

const PENDING_LOGIN_KEY = 'planer.telegram.pending-login.v1';

function isValidBotUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?start=pl_[A-Za-z0-9_-]{24,64}$/.test(url);
}

function restoreLoginTicket(mode: Mode): Ticket | null {
  if (mode !== 'login') return null;
  try {
    const stored = sessionStorage.getItem(PENDING_LOGIN_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Ticket;
    if (!isValidBotUrl(value.url) || typeof value.requestId !== 'string'
      || !/^[A-Za-z0-9_-]{24,64}$/.test(value.requestId)
      || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now() + 5000) {
      sessionStorage.removeItem(PENDING_LOGIN_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function rememberTicket(mode: Mode, ticket: Ticket | null) {
  if (mode !== 'login') return;
  try {
    if (ticket) sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify(ticket));
    else sessionStorage.removeItem(PENDING_LOGIN_KEY);
  } catch {
    // iOS may disable session storage. Polling still works while this tab stays open.
  }
}

export function TelegramConnect({ mode, token, onAuthenticated, onLinked }: Props) {
  const [available, setAvailable] = useState(false);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(() => restoreLoginTicket(mode));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((config: { telegram: boolean }) => {
        if (!cancelled) {
          setAvailable(config.telegram);
          setConfigurationLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) { setAvailable(false); setConfigurationLoaded(true); }
      });
    return () => { cancelled = true; };
  }, []);

  const begin = useCallback(async (openAfterCreation = false) => {
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
        ? 'Не удалось привязать Telegram к текущему аккаунту.'
        : 'Не удалось открыть Telegram (' + response.status + ').');
      const data = await response.json() as Omit<Ticket, 'expiresAt'>;
      if (!isValidBotUrl(data.url) || !/^[A-Za-z0-9_-]{24,64}$/.test(data.requestId)
        || typeof data.expiresIn !== 'number' || data.expiresIn <= 0) {
        throw Error('Получена некорректная ссылка Telegram.');
      }
      const next: Ticket = { ...data, expiresAt: Date.now() + data.expiresIn * 1000 };
      setTicket(next);
      rememberTicket(mode, next);
      if (openAfterCreation) {
        // Same-tab navigation is allowed even after an async request on iOS.
        // Normal sign-ins below use a direct link from the user's own tap.
        window.location.assign(next.url);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть Telegram.');
    } finally {
      setWorking(false);
    }
  }, [mode, token, working]);

  // Create the one-time login link before the user taps. This lets iPhone
  // open Telegram directly via a native hyperlink, without a second screen.
  useEffect(() => {
    if (available && !ticket && !working && !error) void begin();
  }, [available, ticket, working, error, begin]);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    let querying = false;
    const clearTicket = () => {
      rememberTicket(mode, null);
      setTicket(null);
    };
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
          if (!cancelled) {
            clearTicket();
            setError('Ссылка устарела. Нажмите кнопку для новой попытки.');
          }
          return;
        }
        if (!res.ok) return;
        const data = await res.json() as LoginResult;
        if (cancelled || data.status === 'pending') return;
        clearTicket();
        if (data.status === 'authenticated' && data.token) onAuthenticated?.(data.token);
        if (data.status === 'linked') onLinked?.();
      } catch {
        // On iPhone the page may be suspended while Telegram is in front.
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
  }, [ticket, mode, onAuthenticated, onLinked]);

  if (!available) return mode === 'login' && configurationLoaded
    ? <span className="telegram-not-ready">Вход через Telegram временно недоступен. Повторите попытку позже.</span>
    : null;

  const ready = ticket && ticket.expiresAt > Date.now() + 5000;
  const label = mode === 'login' ? '✈ Войти через Telegram' : '✈ Привязать Telegram';

  return <div className="telegram-auth">
    {ready ? (
      <a className="telegram-direct-link" href={ticket.url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <button type="button" disabled={working} onClick={() => { void begin(true); }}>
        {working ? 'Подключаем Telegram…' : label}
      </button>
    )}
    {mode === 'link' && <small>Привяжите Telegram к аккаунту, чтобы получать напоминания.</small>}
    {error && <span className="cloud-error" role="alert">{error}</span>}
  </div>;
}
