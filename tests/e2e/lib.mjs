// 瀏覽器測試共用：開 Chromium、模擬幾部電話（各自一個 context）、連 Firebase emulator。
import { chromium } from 'playwright';

export const APP = process.env.APP_URL || 'http://localhost:8080/';
const CONFIG = `const firebaseConfig = { apiKey: "fake-api-key", authDomain: "demo-fsl.firebaseapp.com", projectId: "demo-fsl", appId: "1:1:web:1" };`;

export async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
}

// 每個測試一個 session：device() 開一部新「電話」；errors 收集頁面錯誤（測試完要係空）
export function session(browser) {
  const errors = [];
  const device = async (label, { locale = 'zh-HK', camera = false, storage = {}, translate = null } = {}) => {
    const ctx = await browser.newContext({ locale, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: camera ? ['camera'] : [] });
    await ctx.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
    // 機翻：唔好真係上網；有指定就回覆指定字
    await ctx.route('https://api.mymemory.translated.net/**', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(translate ? { responseStatus: 200, responseData: { translatedText: translate } } : { responseStatus: 403 }) }),
    );
    await ctx.addInitScript((extra) => {
      localStorage.setItem('fsl-emulator', '127.0.0.1');
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      window.__wake = [];
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (t) => (window.__wake.push(t), { release: async () => window.__wake.push('released') }) } });
    }, storage);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/permission|PERMISSION|Failed to load resource/.test(m.text()) && errors.push(`${label}: ${m.text()}`));
    return page;
  };
  return { device, errors };
}

export const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
export const texts = async (p, sel) => (await p.locator(sel).allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());

// 香港日期（今日 + n 日）
export const hk = (n = 0) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
export const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
// 由今日起（唔計今日）下一個星期幾
export function nextWeekday(dow, from = hk(1)) {
  let d = from;
  while (weekdayOf(d) !== dow) d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  return d;
}

// 開新家庭 → 邀請連結
export async function createFamily(page, me) {
  await page.goto(APP);
  await page.fill('#me', me);
  await page.click('#create');
  await page.waitForSelector('#dialog[open] .code');
  const link = await text(page, '#dialog .code');
  await page.click('#dialog [data-close]');
  return link;
}

export async function join(page, link, me) {
  await page.goto(link);
  await page.fill('#me', me);
  await page.click('#join-invite');
  await page.waitForSelector('#cal-btn');
}

// 喺食飯頁登記自己做成員（cook = 負責煮飯、唔計人數）
export async function becomeMember(page, { cook = false } = {}) {
  await page.click('.views [data-view="dinner"]');
  await page.waitForSelector('#create-me');
  await page.waitForTimeout(600); // 等第一次畫好，唔係剔咗又俾重畫清走
  if (cook) await page.check('#new-me-cook');
  await page.click('#create-me');
  await page.waitForSelector('#dinner .today');
}

export async function openCalendar(page) {
  await page.click('#cal-btn');
  await page.waitForSelector('.cal-sheet[open]');
}

// 日曆揀某日（用月曆，自動轉月）→ 嗰日嘅行
export async function calendarDay(page, date) {
  await page.click('.cal-sheet label:has(input[value="month"])');
  for (let i = 0; i < 24 && !(await page.locator(`.cal-sheet [data-day="${date}"]:not(.out)`).count()); i++) {
    const sel = await page.getAttribute('.cal-sheet .cal-day.sel', 'data-day');
    await page.click(`.cal-sheet [data-shift="${date < sel ? -1 : 1}"]`);
  }
  await page.click(`.cal-sheet [data-day="${date}"]:not(.out)`);
  return texts(page, '.cal-sheet .cal-row');
}

export async function importRosterFile(page, file, formSel) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.cal-sheet [data-import-roster]')]);
  await chooser.setFiles(file);
  await page.waitForSelector(formSel);
}

// 等條件成立（多部機同步要時間）
export async function until(fn, { timeout = 10000, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}
