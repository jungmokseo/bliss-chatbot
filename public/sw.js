// BLISS Lab FAQ Chatbot — Service Worker (Network-First)
const CACHE_NAME = 'bliss-faq-v1';
const OFFLINE_URL = 'offline.html';

// 프리캐시할 정적 파일 (최소한만)
const PRECACHE_URLS = [
  './',
  'offline.html',
  'manifest.json'
];

// 설치: 오프라인 페이지 프리캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 요청 처리: 네트워크 우선 (Network-First)
self.addEventListener('fetch', (event) => {
  // POST 요청(API 호출)은 캐시하지 않음
  if (event.request.method !== 'GET') return;

  // API 요청은 항상 네트워크만 사용
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공적 응답은 캐시에 저장
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 → 캐시에서 찾기
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // navigate 요청이면 오프라인 페이지 표시
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
  );
});
