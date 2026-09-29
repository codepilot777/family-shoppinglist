// 砌通知內容（冇網絡、冇 Firebase，方便測試）。
import { weekday, nextWeekStart, weekDates, formatDay } from '../../public/dates.js';
import { attendance, summarize } from '../../public/dinner.js';
import { marketWindow, collectIngredients } from '../../public/menu.js';

const LOCALES = { zh: 'zh-Hant-HK', en: 'en', id: 'id' };

const TEXT = {
  zh: {
    weekTitle: '🍚 下星期食飯問卷',
    weekBody: '{range} 邊晚喺屋企食？已經預設好，改唔同嘅就得。',
    dailyTitle: '🍚 今晚食飯確認',
    dailyHome: '你今晚：✅ 返屋企食。有改先撳，唔覆當冇改。',
    dailyAway: '你今晚：❌ 唔返。有改先撳，唔覆當冇改。',
    toAway: '❌ 今晚唔返',
    toHome: '✅ 今晚返',
    cookMorningTitle: '🍚 今晚暫時 {n} 人',
    cutoffTitle: '🍚 截數：今晚 {n} 人',
    awayList: '唔返：{names}',
    everyoneHome: '全部返',
    guests: '（包括 {n} 位客）',
    market: '\n🧺 今日買餸：{n} 樣材料，打開 app 睇',
    sep: '、',
  },
  en: {
    weekTitle: '🍚 Next week’s dinner form',
    weekBody: 'Which nights are you home for dinner ({range})? Pre-filled — just change what’s different.',
    dailyTitle: '🍚 Dinner tonight',
    dailyHome: 'You tonight: ✅ home. Only tap if that changed — no reply means no change.',
    dailyAway: 'You tonight: ❌ out. Only tap if that changed — no reply means no change.',
    toAway: '❌ Out tonight',
    toHome: '✅ Home tonight',
    cookMorningTitle: '🍚 Tonight so far: {n} people',
    cutoffTitle: '🍚 Final count tonight: {n} people',
    awayList: 'Out: {names}',
    everyoneHome: 'Everyone home',
    guests: ' (incl. {n} guest(s))',
    market: '\n🧺 Shopping day: {n} ingredient(s) — open the app',
    sep: ', ',
  },
  id: {
    weekTitle: '🍚 Formulir makan minggu depan',
    weekBody: 'Malam mana makan di rumah ({range})? Sudah diisi otomatis — ubah yang berbeda saja.',
    dailyTitle: '🍚 Makan malam hari ini',
    dailyHome: 'Kamu malam ini: ✅ makan di rumah. Ketuk hanya kalau berubah.',
    dailyAway: 'Kamu malam ini: ❌ tidak di rumah. Ketuk hanya kalau berubah.',
    toAway: '❌ Tidak makan di rumah',
    toHome: '✅ Makan di rumah',
    cookMorningTitle: '🍚 Malam ini sementara {n} orang',
    cutoffTitle: '🍚 Jumlah akhir malam ini: {n} orang',
    awayList: 'Tidak di rumah: {names}',
    everyoneHome: 'Semua di rumah',
    guests: ' (termasuk {n} tamu)',
    market: '\n🧺 Hari belanja: {n} bahan — buka aplikasi',
    sep: ', ',
  },
};

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

function summaryBody(tx, sum) {
  const guests = sum.home.reduce((n, r) => n + r.guests, 0);
  const away = sum.away.map((r) => r.member.name);
  return (away.length ? fill(tx.awayList, { names: away.join(tx.sep) }) : tx.everyoneHome) + (guests ? fill(tx.guests, { n: guests }) : '');
}

/**
 * @param mode 'weekly' | 'daily' | 'cutoff'
 * @param today 'YYYY-MM-DD'（香港時間）
 * @param members [{ id, name, proxy, eats, pattern, lastConfirmedWeek }]
 * @param dinners { 'YYYY-MM-DD': { att } }
 * @param devices [{ key, token, memberId, lang }]
 * @param appUrl 'https://…/family-shoppinglist/'
 * @param marketDays 買餸日 [0..6]（冇設定就唔提）
 * @param recipes 菜式庫（計今日買餸要幾多樣材料）
 * 只發食飯相關嘅通知（問卷、今晚確認、煮飯人數、截數）；家務、事項、錢包喺 app 入面睇就得
 * @returns [{ key, token, data: { title, body, url, tag, actions } }]
 */
export function buildMessages({ mode, today, members, dinners, devices, appUrl, marketDays = [], recipes = [] }) {
  const out = [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const tonight = summarize(members, today, dinners[today], weekday(today));
  const weekStart = nextWeekStart(today);
  const dates = weekDates(weekStart);
  // 買餸日：由今日計到下個買餸日前，要買幾多樣（唔計常備）
  const win = marketDays.length ? marketWindow(today, marketDays) : null;
  const toBuy = win?.isMarketDay ? collectIngredients(win.dates, dinners, recipes).filter((x) => !x.staple).length : 0;

  for (const dev of devices) {
    const m = byId.get(dev.memberId);
    if (!m || m.proxy) continue;
    const lang = TEXT[dev.lang] ? dev.lang : 'zh';
    const tx = TEXT[lang];
    const url = (q) => `${appUrl}?${q}`;
    const push = (data) =>
      out.push({ key: dev.key, token: dev.token, data: { tag: `dinner-${mode}`, actions: '[]', ...data } });

    const eats = m.eats !== false;
    if (mode === 'weekly') {
      if (!eats || m.lastConfirmedWeek === weekStart) continue;
      const range = `${formatDay(dates[0], LOCALES[lang])} – ${formatDay(dates[6], LOCALES[lang])}`;
      push({ title: tx.weekTitle, body: fill(tx.weekBody, { range }), url: url(`view=dinner&week=1&m=${m.id}`) });
    } else if (mode === 'daily') {
      if (eats) {
        const a = attendance(m, today, dinners[today], weekday(today));
        const flip = a.home ? 'away' : 'home';
        push({
          title: tx.dailyTitle,
          body: a.home ? tx.dailyHome : tx.dailyAway,
          url: url('view=dinner'),
          actions: JSON.stringify([
            { action: flip, title: a.home ? tx.toAway : tx.toHome, url: url(`view=dinner&set=${flip}&date=${today}&m=${m.id}`) },
          ]),
        });
      } else {
        const body = summaryBody(tx, tonight) + (toBuy ? fill(tx.market, { n: toBuy }) : '');
        push({ title: fill(tx.cookMorningTitle, { n: tonight.total }), body, url: url('view=dinner') });
      }
    } else if (mode === 'cutoff') {
      if (eats) continue; // 截數人數只發俾負責煮飯嘅人
      push({ title: fill(tx.cutoffTitle, { n: tonight.total }), body: summaryBody(tx, tonight), url: url('view=dinner') });
    }
  }
  return out;
}

