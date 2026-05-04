/* 日本旅遊日語 PWA — Service Worker
   - shell：cache-first
   - data/scenarios/*.json：stale-while-revalidate
*/

const CACHE_VERSION = 'jpt-v0.7.2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './data/index.json',
  './data/scenarios/airport.json',
  './data/scenarios/flight.json',
  './data/scenarios/station.json',
  './data/scenarios/hotel.json',
  './data/scenarios/restaurant.json',
  './data/scenarios/ramen.json',
  './data/scenarios/izakaya.json',
  './data/scenarios/conbini.json',
  './data/scenarios/sightseeing.json',
  './data/scenarios/emergency.json',
  './data/scenarios/counters.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/apple-touch-icon.png',
  // 🍣 寿司流れクイズ assets
  './assets/cat/cat_idle.png',
  './assets/cat/cat_happy.png',
  './assets/cat/cat_sad.png',
  './assets/cat/cat_surprised.png',
  './assets/cat/cat_pro.png',
  './assets/cat/cat_asleep.png',
  './assets/sushi/maguro.png',
  './assets/sushi/sake.png',
  './assets/sushi/tamago.png',
  './assets/sushi/ebi.png',
  './assets/sushi/uni.png',
  './assets/sushi/ikura.png',
  './assets/sushi/tekka.png',
  './assets/sushi/inari.png',
  './assets/sushi/ootoro.png',
  './assets/plate/plate_white.png',
  './assets/plate/plate_red.png',
  './assets/plate/plate_gold.png',
  // 🗾 場景化載體
  './assets/scenes/airport_suitcase.png',
  './assets/scenes/flight_tray.png',
  './assets/scenes/station_ekiben.png',
  './assets/scenes/hotel_tray.png',
  './assets/scenes/restaurant_plate.png',
  './assets/scenes/ramen_bowl.png',
  './assets/scenes/izakaya_yakitori.png',
  './assets/scenes/convenience_basket.png',
  './assets/scenes/sightseeing_souvenir.png',
  // 🌸 裝飾
  './assets/decor/sakura_petal.png',
  './assets/decor/mini_torii.png',
  './assets/decor/cloud.png',
  './assets/decor/hanko_stamp.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('SW addAll partial failure', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => !n.startsWith(CACHE_VERSION)).map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // data/scenarios → stale-while-revalidate
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async cache => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req).then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  // 預設：cache-first，fallback network
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
