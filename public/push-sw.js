/* Separate push-only service worker: never cache app HTML, JS or private task data. */
self.addEventListener('push', event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = {}; }
  const title = typeof message.title === 'string' ? message.title.slice(0, 120) : 'Напоминание · Планер';
  const body = typeof message.body === 'string' ? message.body.slice(0, 500) : 'Время выполнить запланированную задачу.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/planner-icon.svg',
    badge: '/planner-icon.svg',
    tag: typeof message.tag === 'string' ? message.tag.slice(0, 120) : 'planer-reminder',
    silent: false,
    data: { url: '/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
