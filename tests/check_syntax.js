#!/usr/bin/env node
/**
 * Проверка синтаксиса всего JS дашборда — без браузера и без зависимостей.
 *
 *   node tests/check_syntax.js
 *   node tests/check_syntax.js path/to/index.html
 *
 * Что проверяется:
 *   1) каждый инлайн-<script> из docs/index.html (их четыре: тема, главный, TSD-экспорт,
 *      «Условия поставщиков») — по отдельности, как их видит браузер;
 *   2) внешние docs/redesign.js и любые другие локальные <script src="...js">.
 *
 * Зачем отдельно от check_dashboard.js: харнесс на jsdom падает целиком, если синтаксис
 * битый, и по стеку не всегда понятно, в каком именно скрипте ошибка и на какой строке
 * ИСХОДНОГО файла. Здесь номера строк пересчитаны на index.html.
 *
 * Типовая ловушка, на которой уже спотыкались дважды: обратная кавычка внутри
 * шаблонной строки (`...`) — например слово в `кавычках` внутри innerHTML. Она молча
 * закрывает шаблон, и дальше всё разъезжается.
 *
 * Код возврата: 0 — чисто, 1 — есть синтаксические ошибки.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.argv[2] || path.join(ROOT, 'docs', 'index.html');
if (!fs.existsSync(HTML)) { console.error('нет файла: ' + HTML); process.exit(2); }

const html = fs.readFileSync(HTML, 'utf8');
const DOCS = path.dirname(HTML);
const targets = [];

// --- инлайн-скрипты: запоминаем смещение, чтобы показать строку в index.html
const reInline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0;
while ((m = reInline.exec(html)) !== null) {
  const body = m[1];
  if (!body.trim()) continue;
  n++;
  const lineOffset = html.slice(0, m.index).split('\n').length - 1;
  targets.push({ name: `${path.basename(HTML)} · инлайн-скрипт #${n}`, code: body, lineOffset });
}

// --- локальные внешние скрипты (redesign.js и т.п.); CDN пропускаем
const reSrc = /<script[^>]*\bsrc="([^"]+)"[^>]*>/g;
while ((m = reSrc.exec(html)) !== null) {
  const src = m[1].split('?')[0];
  if (/^https?:/i.test(src)) continue;
  const file = path.join(DOCS, src);
  if (!fs.existsSync(file)) { targets.push({ name: src, missing: true }); continue; }
  targets.push({ name: src, code: fs.readFileSync(file, 'utf8'), lineOffset: 0, external: true });
}

let bad = 0;
console.log('');
for (const t of targets) {
  if (t.missing) {
    bad++;
    console.log('  ОТСУТСТВУЕТ  ' + t.name + '  <- подключён в index.html, но файла нет');
    continue;
  }
  try {
    new vm.Script(t.code, { filename: t.name });
    const kb = (Buffer.byteLength(t.code, 'utf8') / 1024).toFixed(1);
    console.log('  OK    ' + t.name.padEnd(40) + kb.padStart(7) + ' КБ');
  } catch (e) {
    bad++;
    // vm сообщает строку внутри куска; пересчитываем на исходный файл
    const mm = String(e.stack || '').match(new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)'));
    const line = mm ? +mm[1] + t.lineOffset : null;
    console.log('  ОШИБКА ' + t.name);
    console.log('         ' + e.message);
    if (line) console.log('         строка ' + line + (t.external ? '' : ' файла ' + path.basename(HTML)));
  }
}
console.log('\n  Проверено кусков: ' + targets.length + ' · с ошибками: ' + bad + '\n');
process.exit(bad ? 1 : 0);
