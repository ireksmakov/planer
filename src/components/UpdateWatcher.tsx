import { useEffect } from 'react';

// Compare deployed entry-point hashes. Only reload when a newer build exists.
export function UpdateWatcher() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const getHash = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] || '';
    const currentHash = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
      .map(s => s.getAttribute('src') || '')
      .find(s => /\/assets\/index-[\w-]+\.js/.test(s)) || '';
    if (!currentHash) return;

    const check = async () => {
      if (stopped || checking || !navigator.onLine || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const res = await fetch('/?version_check=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return;
        const latestHash = getHash(await res.text());
        if (!latestHash || currentHash.includes(latestHash)) return;
        // Defer updates while a text field is being edited; changes are stored by the app.
        const focused = document.activeElement;
        if (focused && (focused.matches('input,textarea,[contenteditable="true"]'))) return;
        window.location.reload();
      } catch {
        // Offline or transient errors: retry at next interval.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => { void check(); }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return null;
}
