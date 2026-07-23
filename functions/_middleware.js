// Cloudflare Pages Function — защита всего дашборда одним общим паролем (Basic Auth).
// Пароль НЕ хранится в коде: он берётся из переменной окружения DASH_PASSWORD,
// которую ты задаёшь в настройках Cloudflare Pages (Settings → Environment variables).
// Логин фиксированный: family. Пароль — тот, что ты выдашь собственнику и директору.

const USERNAME = "family";

export async function onRequest(context) {
  const { request, env, next } = context;

  // Если пароль не задан в настройках — не пускаем никого (защита от случайной публикации).
  const expectedPass = env.DASH_PASSWORD;
  if (!expectedPass) {
    return new Response("DASH_PASSWORD не задан в настройках Cloudflare Pages.", { status: 500 });
  }

  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === USERNAME && pass === expectedPass) {
        return next(); // пароль верный — отдаём дашборд
      }
    } catch (e) { /* некорректный заголовок — попадём на запрос авторизации ниже */ }
  }

  return new Response("Требуется авторизация", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Family Market Dashboard", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
