// Application shell only. No API, customer data or marketing navigation caching.
const CACHE = "onepos-till-shell-v2";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch("/app/index.html", { cache: "reload" });
    if (!response.ok) throw new Error("App shell unavailable");
    const html = await response.clone().text();
    await cache.put("/app/index.html", response);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Drop every previous shell cache. A cached /app/index.html plus its old
      // hashed bundles is exactly what serves a blank Till after a rebuild, so
      // stale caches must never survive the new worker's activation.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  )
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const navigation = event.request.mode === "navigate" && (url.pathname === "/app" || url.pathname.startsWith("/app/") || url.pathname === "/login");
  const asset = url.pathname.startsWith("/assets/") && /\.(js|css)$/.test(url.pathname);
  if (!navigation && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (!response.ok) throw new Error("Unavailable");
      await cache.put(navigation ? "/app/index.html" : event.request, response.clone());
      return response;
    } catch {
      return await cache.match(navigation ? "/app/index.html" : event.request) || Response.error();
    }
  })());
});
