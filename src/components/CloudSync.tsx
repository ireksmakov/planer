import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { readLocalTasks } from '../hooks/useTasks';
import { unsubscribeDeviceNotifications } from './PushNotifications';
import { TelegramConnect } from './TelegramConnect';
import { PlannerSignedInTools } from './PlannerSignedInTools';

type Snapshot = { version: number; tasks: Task[] };
type Identity = { uid: string; provider: 'google' | 'telegram'; telegramLinked: boolean; telegramNotifications: boolean };
// Google OAuth remains accepted by the API for previously authenticated users,
// but new sign-ins are available only through Telegram.
const OLD_TOKEN_KEY = 'planer.google.id_token.session';
const SESSION_KEY = 'planer.auth.session.v1';

class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
async function request<T>(endpoint: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  if (!response.ok) throw new ApiError(response.status, response.status === 401
    ? 'Сессия истекла. Войдите через Telegram.'
    : response.status === 409
      ? 'Данные изменились на другом устройстве. Обновите список перед повтором.'
      : `Сервер ответил: ${response.status}`);
  return response.json() as Promise<T>;
}

export function CloudSync({ tasks, replaceAllTasks }: {
  tasks: Task[]; replaceAllTasks: (tasks: Task[]) => void;
}) {
  const [token, setToken] = useState(() => localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(OLD_TOKEN_KEY) || '');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const cloudIds = useRef(new Set<string>());
  const previous = useRef(new Map<string, string>());
  const inflight = useRef(false);
  const connectedRef = useRef(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const applyingRemote = useRef(false);
  connectedRef.current = connected;
  snapshotRef.current = snapshot;

  const acceptSession = useCallback((next: string) => {
    if (!next.startsWith('pln_')) return;
    localStorage.setItem(SESSION_KEY, next);
    sessionStorage.removeItem(OLD_TOKEN_KEY);
    setError('');
    setToken(next);
  }, []);

  const expireSession = useCallback((message: string) => {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(OLD_TOKEN_KEY);
    setToken('');
    setConnected(false);
    connectedRef.current = false;
    setIdentity(null);
    setSnapshot(null);
    setError(message);
    // Preserve local tasks, including edits not yet uploaded, until the next sign-in.
  }, []);

  useEffect(() => {
    if (!token) { setConnected(false); return; }
    let cancelled = false;
    setConnected(false);
    setIdentity(null);

    if (!token.startsWith('pln_')) {
      // One-time migration for people still signed in with a legacy Google ID token.
      void request<{ token: string }>('/api/auth/google-session', '', 'POST', { credential: token })
        .then(data => { if (!cancelled) acceptSession(data.token); })
        .catch(() => { if (!cancelled) expireSession('Старая Google-сессия истекла. Задачи сохранены в облаке; для доступа потребуется ранее привязанный Telegram.'); });
      return () => { cancelled = true; };
    }

    const initialize = async () => {
      try {
        const me = await request<Identity>('/api/auth/me', token);
        if (cancelled) return;
        const marker = 'planer.cloud.imported.' + me.uid;
        const local = readLocalTasks();
        const imported = localStorage.getItem(marker) === 'yes';
        // Do not import tasks from a previously signed-in Google/Telegram user.
        const knownAccount = Object.keys(localStorage).some(key =>
          key.startsWith('planer.cloud.imported.') && key !== marker);
        const legacyImport = !imported && !knownAccount && local.length > 0;
        const data = legacyImport
          ? await request<Snapshot>('/api/import', token, 'POST', { tasks: local })
          : await request<Snapshot>('/api/tasks', token);
        if (cancelled) return;
        if (legacyImport) localStorage.setItem('planer.cloud.backup.' + me.uid, JSON.stringify(local));
        localStorage.setItem(marker, 'yes');
        cloudIds.current = new Set(data.tasks.map(t => t.id));
        previous.current = new Map(data.tasks.map(t => [t.id, JSON.stringify(t)]));
        snapshotRef.current = data;
        setSnapshot(data);
        setIdentity(me);
        replaceAllTasks(data.tasks);
        setConnected(true);
        setError('');
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 401) {
            expireSession(e.message);
          } else {
            setError('Синхронизация не запущена: ' + String(e));
            setConnected(false);
          }
        }
      }
    };
    void initialize();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, acceptSession, expireSession]);

  useEffect(() => {
    if (!connected || !snapshot || !token) return;
    const timer = window.setTimeout(async () => {
      if (inflight.current) return;
      const now = tasksRef.current;
      const modified = now.find(t => previous.current.get(t.id) !== JSON.stringify(t));
      const removed = [...cloudIds.current].find(id => !now.some(t => t.id === id));
      if (!modified && !removed) return;
      inflight.current = true;
      try {
        const data = modified
          ? await request<Snapshot>('/api/task', token, 'PUT', { task: modified, baseVersion: snapshot.version })
          : await request<Snapshot>('/api/delete', token, 'POST', { id: removed, baseVersion: snapshot.version });
        setSnapshot(data);
        cloudIds.current = new Set(data.tasks.map(t => t.id));
        previous.current = new Map(data.tasks.map(t => [t.id, JSON.stringify(t)]));
        setError('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) expireSession(e.message);
        else { setConnected(false); setError(String(e)); }
      } finally { inflight.current = false; }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [tasks, connected, snapshot, token, expireSession]);

  useEffect(() => {
    if (!connected || !token) return;
    let cancelled = false;
    const pull = async () => {
      if (cancelled || inflight.current || applyingRemote.current) return;
      const baseline = snapshotRef.current;
      if (!baseline) return;
      const local = tasksRef.current;
      const hasPending = local.length !== cloudIds.current.size ||
        local.some(task => previous.current.get(task.id) !== JSON.stringify(task));
      if (hasPending) return;
      inflight.current = true;
      try {
        const data = await request<Snapshot>('/api/tasks', token);
        if (cancelled || !connectedRef.current) return;
        if (data.version !== snapshotRef.current?.version) {
          // An edit may have happened while the request was in flight.
          const current = tasksRef.current;
          const changed = current.length !== cloudIds.current.size ||
            current.some(task => previous.current.get(task.id) !== JSON.stringify(task));
          if (changed) return;
          applyingRemote.current = true;
          setSnapshot(data);
          snapshotRef.current = data;
          cloudIds.current = new Set(data.tasks.map(t => t.id));
          previous.current = new Map(data.tasks.map(t => [t.id, JSON.stringify(t)]));
          replaceAllTasks(data.tasks);
          setError('');
          applyingRemote.current = false;
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 401) expireSession(e.message);
          else setError('Автоматическое обновление: ' + String(e));
        }
      } finally { inflight.current = false; }
    };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void pull(); }, 10000);
    const onFocus = () => { if (navigator.onLine) void pull(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, token, expireSession]);

  const refreshIdentity = useCallback(() => {
    void request<Identity>('/api/auth/me', token)
      .then(me => setIdentity(me))
      .catch(e => setError('Telegram привязан, но не удалось обновить профиль: ' + String(e)));
  }, [token]);

  const signOut = async () => {
    const pending = connected && (tasksRef.current.length !== cloudIds.current.size ||
      tasksRef.current.some(t => previous.current.get(t.id) !== JSON.stringify(t)));
    if (pending && !window.confirm('Есть задачи, которые ещё не синхронизированы. Выйти всё равно?')) return;
    const oldToken = token;
    setConnected(false);
    connectedRef.current = false;
    setSnapshot(null);
    snapshotRef.current = null;
    setIdentity(null);
    cloudIds.current.clear();
    previous.current.clear();
    replaceAllTasks([]);
    setToken('');
    setError('');
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(OLD_TOKEN_KEY);
    try { await unsubscribeDeviceNotifications(oldToken); } catch { /* Browser subscription is already invalidated. */ }
    try { await request('/api/auth/logout', oldToken, 'POST'); } catch { /* Local logout already completed. */ }
  };

  if (!token) return (
    <section className="cloud-strip" aria-label="Вход через Telegram">
      <div className="telegram-login-entry">
        <p className="telegram-login-required">
          <strong>Регистрация через Telegram обязательна</strong> для сохранения ваших целей и задач в личном аккаунте.
        </p>
        <TelegramConnect mode="login" onAuthenticated={acceptSession} />
      </div>
      {error && <span role="alert" className="cloud-error">{error}</span>}
    </section>
  );

  if (!connected) return (
    <section className="planner-sync-loading" aria-live="polite">
      <span>{error ? 'Не удалось подключить облако' : 'Подключаем задачи…'}</span>
      <button type="button" onClick={() => { void signOut(); }}>Выйти</button>
      {error && <span role="alert" className="cloud-error">{error}</span>}
    </section>
  );

  return (
    <>
      <PlannerSignedInTools
        token={token}
        identity={identity}
        taskCount={snapshot?.tasks.length ?? 0}
        onLogout={() => { void signOut(); }}
        onLinked={refreshIdentity}
      />
      {error && <div role="alert" className="planner-sync-error">{error}</div>}
    </>
  );
}
