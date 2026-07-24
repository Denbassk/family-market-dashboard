// Cloudflare Pages Function: запуск пересборки данных (GitHub workflow_dispatch) в один клик.
// Токен GitHub хранится в переменной окружения Cloudflare GH_REFRESH_TOKEN (в браузер не попадает).
// Эндпоинт под тем же паролем, что и весь дашборд (см. functions/_middleware.js), поэтому доступен только своим.
export async function onRequestPost(context) {
  const { env } = context;
  const token = env.GH_REFRESH_TOKEN;
  const owner = env.GH_OWNER || "Denbassk";
  const repo = env.GH_REPO || "family-market-dashboard";
  const wf = env.GH_WORKFLOW || "update.yml";
  if (!token) {
    return json({ error: "GH_REFRESH_TOKEN не задан в настройках Cloudflare Pages." }, 500);
  }
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "family-market-dashboard",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status === 204) return json({ ok: true });
  const text = await r.text();
  return json({ error: `GitHub ${r.status}: ${text}` }, 502);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
