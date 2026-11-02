import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL as string;
type PushState = 'idle' | 'working' | 'enabled' | 'unavailable';

function supported() {
  return typeof window !== 'undefined' && window.isSecureContext &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIOSBrowserShortcut() {
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return isiOS && !standalone;
}

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const text = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
async function submitSubscription(subscription: PushSubscription, token: string) {
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }),
  });
  if (!response.ok) throw Error('Сервер напоминаний недоступен (' + response.status + ')');
}

/** Explicit logout revokes this device's push endpoint, protecting shared devices. */
export async function unsubscribeDeviceNotifications(token: string): Promise<void> {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration(BASE);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // Invalidate the browser endpoint promptly, even if the API is offline.
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3000);
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ endpoint }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function PushNotifications({ token }: { token: string }) {
  const [state, setState] = useState<PushState>('idle');
  const [error, setError] = useState('');
  const available = supported();
  const iosShortcut = available && isIOSBrowserShortcut();

  useEffect(() => {
    if (!available || iosShortcut || !token) return;
    let cancelled = false;
    const reconnect = async () => {
      if (Notification.permission !== 'granted') return;
      try {
        const registration = await navigator.serviceWorker.getRegistration(BASE);
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return;
        await submitSubscription(subscription, token);
        if (!cancelled) setState('enabled');
      } catch {
        if (!cancelled) setError('Повторное подключение напоминаний не удалось.');
      }
    };
    void reconnect();
    return () => { cancelled = true; };
  }, [token, available, iosShortcut]);

  async function enable() {
    setError('');
    setState('working');
    try {
      // Permission prompt must follow the user's direct tap on iPhone.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw Error('Разрешите уведомления в настройках телефона.');
      const response = await fetch('/api/push/public-key', { cache: 'no-store' });
      if (!response.ok) throw Error('Уведомления ещё не настроены на сервере.');
      const data = await response.json() as { publicKey: string };
      const registration = await navigator.serviceWorker.register(BASE + 'push-sw.js', { scope: BASE });
      const subscription = await registration.pushManager.getSubscription() ||
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(data.publicKey),
        });
      await submitSubscription(subscription, token);
      setState('enabled');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'Не удалось включить уведомления.');
    }
  }

  async function disable() {
    setState('working');
    setError('');
    try {
      await unsubscribeDeviceNotifications(token);
      setState('idle');
    } catch {
      setState('idle');
      setError('Не удалось полностью отключить уведомления. Проверьте настройки телефона.');
    }
  }

  if (!available) return <span className="push-note">Напоминания не поддерживаются этим браузером.</span>;
  if (iosShortcut) return <span className="push-note">Для звуковых напоминаний откройте «Планер» через значок на экране «Домой».</span>;
  return <div className="push-settings">
    {state === 'enabled' ? <>
      <span className="push-enabled">🔔 Напоминания включены</span>
      <button type="button" onClick={() => { void disable(); }}>Отключить</button>
    </> : <button type="button" disabled={state === 'working'} onClick={() => { void enable(); }}>
      {state === 'working' ? 'Подключаем…' : '🔔 Включить напоминания'}
    </button>}
    {error && <span className="push-note" role="status">{error}</span>}
  </div>;
}
