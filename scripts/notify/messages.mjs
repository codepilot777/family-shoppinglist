// 砌通知內容（冇網絡、冇 Firebase，方便測試）。
import { weekday, nextWeekStart, weekDates, formatDay } from '../../public/dates.js';
import { attendance, summarize } from '../../public/dinner.js';
import { marketWindow, collectIngredients } from '../../public/menu.js';
import { dueToday } from '../../public/chores.js';
import { DICT_INDEX } from '../../public/dictionary.js';

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
    walletTitle: '💰 買餸錢包得返 {amount}',
    walletBody: '低過 {limit}，記得入錢。',
    choresTitle: '🧹 今日家務（{n} 樣）',
    eventsTitle: '📅 今日：{what}',
    allDay: '全日',
    late: '（遲咗）',
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
    walletTitle: '💰 Grocery wallet has {amount} left',
    walletBody: 'Below {limit} — remember to top up.',
    choresTitle: '🧹 Chores today ({n})',
    eventsTitle: '📅 Today: {what}',
    allDay: 'all day',
    late: ' (late)',
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
    walletTitle: '💰 Uang belanja tinggal {amount}',
    walletBody: 'Di bawah {limit} — jangan lupa diisi.',
    choresTitle: '🧹 Tugas hari ini ({n})',
    eventsTitle: '📅 Hari ini: {what}',
    allDay: 'seharian',
    late: ' (terlambat)',
    sep: ', ',
  },
};

const money = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en', { maximumFractionDigits: 2 })}`;
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
 * @param wallet { balance, low }（仙；冇紀錄就 null）
 * @param chores 家務 [{ name, tr, due, who }]（朝早通知負責人今日要做嘅）
 * @param events 📅 事項 [{ title, tr, date, time, who, note }]（朝早通知相關嘅人今日有咩）
 * @returns [{ key, token, data: { title, body, url, tag, actions } }]
 */
export function buildMessages({ mode, today, members, dinners, devices, appUrl, marketDays = [], recipes = [], wallet = null, chores = [], events = [] }) {
  const out = [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const tonight = summarize(members, today, dinners[today], weekday(today));
  const weekStart = nextWeekStart(today);
  const dates = weekDates(weekStart);
  // 買餸日：由今日計到下個買餸日前，要買幾多樣（唔計常備）
  const win = marketDays.length ? marketWindow(today, marketDays) : null;
  const toBuy = win?.isMarketDay ? collectIngredients(win.dates, dinners, recipes).filter((x) => !x.staple).length : 0;
  const choresDue = mode === 'daily' ? dueToday(chores, today) : [];
  const eventsToday = mode === 'daily' ? events.filter((e) => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')) : [];

  for (const dev of devices) {
    const m = byId.get(dev.memberId);
    if (!m || m.proxy) continue;
    const lang = TEXT[dev.lang] ? dev.lang : 'zh';
    const tx = TEXT[lang];
    const url = (q) => `${appUrl}?${q}`;
    const push = (data) =>
      out.push({ key: dev.key, token: dev.token, data: { tag: `dinner-${mode}`, actions: '[]', ...data } });

    // 🧹 今日（連過咗期）輪到佢嘅家務；揀「任何人」嘅唔發
    const mine = choresDue.filter((c) => c.who === m.id);
    if (mine.length) {
      const name = (c) => c.tr?.[lang] || DICT_INDEX.get(String(c.name).trim().toLowerCase())?.[lang] || c.name;
      out.push({
        key: dev.key,
        token: dev.token,
        data: {
          tag: 'chores',
          actions: '[]',
          title: fill(tx.choresTitle, { n: mine.length }),
          body: mine.map((c) => name(c) + (c.due < today ? tx.late : '')).join(tx.sep),
          url: url('view=chores'),
        },
      });
    }

    // 📅 今日同佢有關嘅事項（家長日、覆診…）；揀「任何人」嘅唔發
    const myEvents = eventsToday.filter((e) => e.who === m.id);
    if (myEvents.length) {
      const title = (e) => e.tr?.[lang] || DICT_INDEX.get(String(e.title).trim().toLowerCase())?.[lang] || e.title;
      const line = (e) => `${e.time || tx.allDay} ${title(e)}`;
      out.push({
        key: dev.key,
        token: dev.token,
        data: {
          tag: 'events',
          actions: '[]',
          title: fill(tx.eventsTitle, { what: line(myEvents[0]) }),
          body: myEvents.map((e) => line(e) + (e.note ? ` · ${e.note}` : '')).join('\n'),
          url: url(`cal=${today}`),
        },
      });
    }

    const eats = m.eats !== false;
    if (mode === 'weekly') {
      if (!eats || m.lastConfirmedWeek === weekStart) continue;
      const range = `${formatDay(dates[0], LOCALES[lang])} – ${formatDay(dates[6], LOCALES[lang])}`;
      push({ title: tx.weekTitle, body: fill(tx.weekBody, { range }), url: url(`view=dinner&week=1&m=${m.id}`) });
    } else if (mode === 'daily') {
      if (eats) {
        const a = attendance(m, today, dinners[today], weekday(today));
        const flip = a.home ? 'away' : 'home';
        // 錢包就嚟用完：提醒食飯成員（即係俾錢嗰啲人）入錢
        if (wallet && wallet.balance < wallet.low) {
          out.push({
            key: dev.key,
            token: dev.token,
            data: {
              tag: 'wallet-low',
              actions: '[]',
              title: fill(tx.walletTitle, { amount: money(wallet.balance) }),
              body: fill(tx.walletBody, { limit: money(wallet.low) }),
              url: url('view=wallet'),
            },
          });
        }
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

