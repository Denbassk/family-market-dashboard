// Cloudflare Pages Function: хранилище коммерческих условий поставщиков.
//
//   GET  /api/suppliers  -> {version, updated_at, suppliers:[...]}
//   PUT  /api/suppliers  -> сохраняет присланный список, возвращает новую версию
//
// Данные лежат в KV-хранилище (binding SUPPLIERS_KV, см. docs/SUPPLIERS_SETUP.md).
// Если в KV ещё пусто — отдаём стартовый снимок из docs/suppliers.json, чтобы
// вкладка работала сразу после деплоя, до первого сохранения.
//
// Эндпоинт закрыт тем же паролем, что и весь дашборд (functions/_middleware.js),
// поэтому отдельной авторизации здесь нет.

const KEY = 'suppliers:current';
const HIST_MAX = 20;          // сколько прошлых версий держим для отката

export async function onRequestGet(context) {
  const { env, request } = context;
  const kv = env.SUPPLIERS_KV;
  if (!kv) return json({ error: 'KV-хранилище SUPPLIERS_KV не привязано к проекту. См. docs/SUPPLIERS_SETUP.md' }, 500);

  const raw = await kv.get(KEY);
  if (raw) {
    return new Response(raw, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // KV пуст — отдаём стартовый снимок из статики.
  // ВАЖНО: читаем через env.ASSETS, а не обычным fetch — обычный запрос
  // к своему же домену снова прошёл бы через _middleware.js (Basic Auth)
  // и вернул бы 401, потому что заголовок авторизации в подзапрос не попадает.
  const seedUrl = new URL('/suppliers.json', request.url);
  let seedRes = null;
  try {
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      seedRes = await env.ASSETS.fetch(new Request(seedUrl.toString(), { method: 'GET' }));
    } else {
      // запасной путь: пробрасываем авторизацию исходного запроса
      const h = new Headers();
      const auth = request.headers.get('Authorization');
      if (auth) h.set('Authorization', auth);
      seedRes = await fetch(seedUrl.toString(), { headers: h });
    }
  } catch (e) {
    seedRes = null;
  }
  if (!seedRes || !seedRes.ok) {
    return json({ version: 0, updated_at: null, seeded: true, suppliers: [] });
  }
  const seed = await seedRes.json();
  return json({
    version: 0,
    updated_at: null,
    seeded: true,
    suppliers: Array.isArray(seed) ? seed : (seed.suppliers || []),
  });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const kv = env.SUPPLIERS_KV;
  if (!kv) return json({ error: 'KV-хранилище SUPPLIERS_KV не привязано к проекту. См. docs/SUPPLIERS_SETUP.md' }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Тело запроса — не JSON' }, 400);
  }

  const list = Array.isArray(body) ? body : body.suppliers;
  if (!Array.isArray(list)) return json({ error: 'Ожидался массив suppliers' }, 400);

  // Защита от случайного затирания всей базы пустотой: полное стирание
  // разрешаем только явным флагом allowEmpty.
  const prevRaw = await kv.get(KEY);
  const prev = prevRaw ? safeParse(prevRaw) : null;
  const prevCount = prev && Array.isArray(prev.suppliers) ? prev.suppliers.length : 0;
  if (list.length === 0 && prevCount > 0 && !body.allowEmpty) {
    return json({ error: 'Отклонено: попытка сохранить пустой список поверх ' + prevCount + ' записей' }, 409);
  }

  // Оптимистичная блокировка: если клиент прислал версию и она отстала —
  // значит правили из другой вкладки. Сообщаем, не затираем.
  const prevVersion = prev && typeof prev.version === 'number' ? prev.version : 0;
  if (typeof body.baseVersion === 'number' && body.baseVersion !== prevVersion && !body.force) {
    return json({
      error: 'conflict',
      message: 'Данные изменились в другой вкладке или на другом устройстве.',
      serverVersion: prevVersion,
      yourVersion: body.baseVersion,
    }, 409);
  }

  const next = {
    version: prevVersion + 1,
    updated_at: new Date().toISOString(),
    count: list.length,
    suppliers: list,
  };
  const nextRaw = JSON.stringify(next);
  await kv.put(KEY, nextRaw);

  // История: складываем предыдущую версию отдельным ключом
  if (prevRaw) {
    try {
      await kv.put('suppliers:v' + prevVersion, prevRaw, { expirationTtl: 60 * 60 * 24 * 90 });
      const idxRaw = await kv.get('suppliers:index');
      let idx = idxRaw ? (safeParse(idxRaw) || []) : [];
      idx.unshift({ version: prevVersion, at: prev && prev.updated_at, count: prevCount });
      if (idx.length > HIST_MAX) idx = idx.slice(0, HIST_MAX);
      await kv.put('suppliers:index', JSON.stringify(idx));
    } catch (e) { /* история необязательна — основное сохранение уже прошло */ }
  }

  return json({ ok: true, version: next.version, updated_at: next.updated_at, count: next.count });
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
