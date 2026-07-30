const CACHE_VERSION = 'jx-v20260730-1';
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const MANAGED_CACHES = [PAGE_CACHE, ASSET_CACHE];

const isCacheableResponse = response =>
    response && response.ok && (response.type === 'basic' || response.type === 'default');

const isApiRequest = url =>
    /\/chat\/completions(?:\?|$)/.test(url.pathname) ||
    /\/api(?:\/|$)/.test(url.pathname);

self.addEventListener('install', event => {
    // 新版本下载完后立即进入激活阶段，不长期等待旧页面关闭。
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(cacheName => {
            if (cacheName.startsWith('jx-v') && !MANAGED_CACHES.includes(cacheName)) {
                return caches.delete(cacheName);
            }
            return Promise.resolve(false);
        }));

        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(client => client.postMessage({
            type: 'JX_SW_UPDATED',
            cacheVersion: CACHE_VERSION
        }));
    })());
});

const networkFirst = async request => {
    const cache = await caches.open(PAGE_CACHE);
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (isCacheableResponse(response)) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;

        const fallback = await cache.match('./index.html') || await cache.match('/index.html');
        if (fallback) return fallback;
        throw error;
    }
};

const staleWhileRevalidate = async request => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);

    const updatePromise = fetch(request, { cache: 'no-store' })
        .then(async response => {
            if (isCacheableResponse(response)) await cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        // 不阻塞当前加载，同时把最新版写进缓存供下一次使用。
        updatePromise.catch(() => {});
        return cached;
    }

    const response = await updatePromise;
    if (response) return response;
    throw new Error(`资源加载失败且无缓存: ${request.url}`);
};

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || isApiRequest(url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    const destination = request.destination;
    if (['script', 'style', 'image', 'font', 'audio', 'manifest'].includes(destination)) {
        event.respondWith(staleWhileRevalidate(request));
    }
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'CLEAR_JX_CACHES') {
        event.waitUntil(Promise.all(MANAGED_CACHES.map(cacheName => caches.delete(cacheName))));
    }
});
