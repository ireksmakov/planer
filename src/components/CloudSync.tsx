import { useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { readLocalTasks } from '../hooks/useTasks';

type Snapshot = { version: number; tasks: Task[] };
type Credential = { credential?: string };
type GoogleButtonApi = {
  initialize: (options: { client_id: string; callback: (value: Credential) => void }) => void;
  renderButton: (el: HTMLElement, options: Record<string, string>) => void;
};
declare global { interface Window { google?: { accounts?: { id?: GoogleButtonApi } } } }

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const TOKEN_KEY = 'planer.google.id_token.session';

async function request<T>(endpoint: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method, headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  if (!response.ok) throw new Error(response.status === 409
    ? 'Данные изменились на другом устройстве. Обновите список перед повтором.'
    : `Сервер ответил: ${response.status}`);
  return response.json() as Promise<T>;
}

export function CloudSync({ tasks, replaceAllTasks }: {
  tasks: Task[]; replaceAllTasks: (tasks: Task[]) => void;
}) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const originalLocal = useRef<Task[]>(readLocalTasks());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const cloudIds = useRef(new Set<string>());
  const previous = useRef(new Map<string, string>());
  const inflight = useRef(false);
  const connectedRef = useRef(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const applyingRemote = useRef(false);
  snapshotRef.current = snapshot;

  const refresh = async (currentToken: string, apply = true) => {
    const data = await request<Snapshot>('/api/tasks', currentToken);
    setSnapshot(data);
    cloudIds.current = new Set(data.tasks.map(t => t.id));
    previous.current = new Map(data.tasks.map(t => [t.id, JSON.stringify(t)]));
    if (apply) replaceAllTasks(data.tasks);
    return data;
  };

  useEffect(() => {
    if (!CLIENT_ID || token) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const api = window.google?.accounts?.id;
      if (!api || !buttonRef.current) return;
      api.initialize({ client_id: CLIENT_ID, callback: (result) => {
        if (!result.credential) return;
        setToken(result.credential);
        sessionStorage.setItem(TOKEN_KEY, result.credential);
      } });
      api.renderButton(buttonRef.current, { theme: 'outline', size: 'large', text: 'signin_with' });
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refresh(token, false).catch(e => { setError(String(e)); setToken(''); sessionStorage.removeItem(TOKEN_KEY); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Once imported or explicitly loaded, sync individual task changes with a version check.
  const [connected, setConnected] = useState(false);
  connectedRef.current = connected;
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
        // Continue until all locally queued changes were uploaded.
      } catch (e) {
        setConnected(false); setError(String(e));
      } finally { inflight.current = false; }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [tasks, connected, snapshot, token]);

  // Poll only while connected; never replace local edits awaiting upload.
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
          // A user may edit during the network request: preserve their local changes.
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
        if (!cancelled) setError('Автоматическое обновление: ' + String(e));
      } finally {
        inflight.current = false;
      }
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
  }, [connected, token]);

  const run = async (job: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await job(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const importLocal = () => run(async () => {
    // Capture initial local tasks before switching to cloud.
    const local = originalLocal.current;
    const data = await request<Snapshot>('/api/import', token, 'POST', { tasks: local });
    setSnapshot(data); cloudIds.current = new Set(data.tasks.map(t => t.id));
    previous.current = new Map(data.tasks.map(t => [t.id, JSON.stringify(t)]));
    replaceAllTasks(data.tasks); setConnected(true);
  });
  const openCloud = () => run(async () => { await refresh(token); setConnected(true); });
  const signOut = () => { setToken(''); setSnapshot(null); setConnected(false); sessionStorage.removeItem(TOKEN_KEY); };
  if (!CLIENT_ID) return null;

  return <section className="cloud-strip" aria-label="Синхронизация задач">
    {!token ? <><span>Задачи пока сохраняются только на этом устройстве.</span><div ref={buttonRef} /></> :
      !connected ? <>
        <span>Google подключён. В облаке {snapshot?.tasks.length ?? '…'} задач; на этом устройстве {originalLocal.current.length}.</span>
        <button disabled={busy || !snapshot} onClick={importLocal}>Объединить местные задачи с облачными</button>
        <button disabled={busy || !snapshot} onClick={openCloud}>Открыть облачные задачи</button>
        <button onClick={signOut}>Выйти</button>
      </> : <>
        <span>Автосинхронизация включена · {snapshot?.tasks.length ?? 0} задач</span>
        <button disabled={busy} onClick={() => void run(async () => {
          if (inflight.current) throw Error('Сначала завершите синхронизацию изменений');
          await refresh(token);
        })}>Обновить с сервера</button>
        <button onClick={signOut}>Выйти</button>
      </>}
    {error && <span role="alert" className="cloud-error">{error}</span>}
  </section>;
}
