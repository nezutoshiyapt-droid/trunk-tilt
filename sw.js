/* 体幹傾斜測定アプリ — オフライン用 Service Worker
   方針:
   - インストール時にアプリ一式をキャッシュ
   - オンライン時はネットワーク優先（更新が自動で反映される）
   - オフライン時・通信失敗時はキャッシュから配信（完全オフライン動作）
   - 電波が弱く応答が返らないときは NET_TIMEOUT_MS で見切り、保存済みの版で起動する
     （裏で通信は続け、届いたらキャッシュを最新に入れ替える）
*/
var CACHE = 'trunk-tilt-v7';
var NET_TIMEOUT_MS = 4000;
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 1つ失敗しても全体が落ちないように個別に追加する
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE) ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCache(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    // ページ遷移はトップにフォールバック
    if (req.mode === 'navigate') return caches.match('./index.html');
    return null;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 外部リソースは扱わない（そもそも無い）

  // ネットワークから取得できたらキャッシュも更新する
  var net = fetch(req).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {
      var copy = res.clone();
      return caches.open(CACHE)
        .then(function (c) { return c.put(req, copy); })
        .then(function () { return res; }, function () { return res; });
    }
    return res;
  });

  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function finish(r) { if (!done) { done = true; resolve(r); } }
    // 応答が遅いときは保存済みの版を先に返す（保存が無ければネットワークを待つ）
    var timer = setTimeout(function () {
      fromCache(req).then(function (hit) { if (hit) finish(hit); });
    }, NET_TIMEOUT_MS);
    net.then(function (res) {
      clearTimeout(timer);
      finish(res);
    }, function () {
      clearTimeout(timer);
      fromCache(req).then(function (hit) {
        finish(hit || new Response('offline', { status: 503, statusText: 'offline' }));
      });
    });
  }));

  // 見切って保存版を返した後も、裏の通信とキャッシュ更新を最後まで続ける
  e.waitUntil(net.then(function () {}, function () {}));
});

// アプリ側からキャッシュ状態を問い合わせる
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'CHECK') return;
  caches.open(CACHE).then(function (c) {
    return c.match('./index.html');
  }).then(function (hit) {
    if (e.source && e.source.postMessage) {
      e.source.postMessage({ type: 'CACHE_STATE', ready: !!hit, cache: CACHE });
    }
  });
});
