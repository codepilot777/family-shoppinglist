// 離線用：先用快取開 app，背景再攞新版本。Firestore 請求唔經呢度。
const CACHE = 'fsl-v8';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'store.js',
  'i18n.js',
  'translate.js',
  'dictionary.js',
  'image.js',
  'ui.js',
  'install.js',
  'dates.js',
  'dinner.js',
  'dinner-view.js',
  'menu.js',
  'menu-view.js',
  'recipes-seed.js',
  'firebase-config.js',
  'vendor/firebase.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});

// ---------- 推送通知（由 GitHub Actions 經 Firebase Cloud Messaging 發出） ----------
// 訊息係 data-only：{ title, body, url, tag, actions: JSON [{action, title, url}] }

self.addEventListener('push', (e) => {
  let payload = {};
  try {
    payload = e.data ? e.data.json() : {};
  } catch {
    payload = { data: { title: e.data?.text() } };
  }
  const data = payload.data || payload.notification || payload;
  let actions = [];
  try {
    actions = JSON.parse(data.actions || '[]');
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || '🍚', {
      body: data.body || '',
      tag: data.tag || 'fsl',
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: data.url || './', actions },
      actions: actions.slice(0, 2).map((a) => ({ action: a.action, title: a.title })),
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, actions } = e.notification.data || {};
  const target = (actions || []).find((a) => a.action === e.action)?.url || url || './';
  const full = new URL(target, self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) return win.navigate(full).then((c) => (c || win).focus());
      return self.clients.openWindow(full);
    }),
  );
});
