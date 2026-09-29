import assert from 'node:assert/strict';
import { parseRoster, mergeRoster, awayAtDinner, rosterDay, homeBy } from '../../public/roster.js';
import { attendance } from '../../public/dinner.js';

// 模擬國泰 Realtime Roster 格式（虛構資料）
const ev = (sum, start, end) => `BEGIN:VEVENT\r\nSUMMARY:${sum}\r\nDTSTART${start.length === 8 ? ';VALUE=DATE' : ''}:${start}\r\nDTEND${end.length === 8 ? ';VALUE=DATE' : ''}:${end}\r\nDESCRIPTION:x\r\nEND:VEVENT\r\n`;
const ics = (...events) => `BEGIN:VCALENDAR\r\nPRODID:-//Test//Roster//EN\r\n${events.join('')}END:VCALENDAR\r\n`;
const sep = ics(
  ev('01-Sep CX 100 HKG-LAX', '20260901T033000Z', '20260901T183800Z'), // 11:30 HKT 出門
  ev('03-Sep CX 101 LAX-HKG', '20260903T062500Z', '20260903T222100Z'), // 4/9 06:21 返到
  ev('05-Sep O ', '20260905', '20260906'),
  ev('09-Sep S1514  MW', '20260909T060000Z', '20260909T120000Z'), // SIM 14:00–20:00
  ev('10-Sep AR8 ', '20260910T011000Z', '20260910T021000Z'), // reserve
  ev('11-Sep CX 200 HKG-XMN / 11-Sep CX 201 XMN-HKG', '20260911T083000Z', '20260911T153500Z'), // 16:30–23:35
  ev('21-Sep CX 300 HKG-PEK / 21-Sep CX 301 PEK-HKG', '20260920T234500Z', '20260921T094600Z'), // 07:45–17:46
  ev('29-Sep NB ', '20260929', '20260930'),
  ev('30-Sep CX 400 HKG-LHR', '20260930T150000Z', '20260930T230000Z'), // 23:00 出門，回程喺下個月
);
const p = parseRoster(sep);
assert.equal(p.from, '2026-09-01');
assert.equal(p.to, '2026-09-30');
assert.deepEqual(
  p.trips.map((t) => `${t.s}→${t.e} ${t.d} ${t.k}`),
  [
    '2026-09-01T11:30→2026-09-04T06:21 LAX flight',
    '2026-09-09T14:00→2026-09-09T20:00  sim',
    '2026-09-11T16:30→2026-09-11T23:35 XMN flight',
    '2026-09-21T07:45→2026-09-21T17:46 PEK flight',
    '2026-09-30T23:00→null LHR flight',
  ],
);
assert.deepEqual(p.reserves, [{ s: '2026-09-10T09:10', e: '2026-09-10T10:10', c: 'AR8' }]);
assert.ok(!JSON.stringify(p).includes('CX'), 'flight numbers are not kept');

// 食飯（19:30，前後 90 分鐘）
const r = { ...mergeRoster(null, p, '2026-09-29'), dinner: '19:30', commute: 90 };
const away = (d) => (awayAtDinner(r, d) ? 'away' : 'home');
assert.equal(away('2026-09-01'), 'away');
assert.equal(away('2026-09-03'), 'away');
assert.equal(away('2026-09-04'), 'home'); // 06:21 返到
assert.equal(away('2026-09-09'), 'away'); // SIM 收 20:00
assert.equal(away('2026-09-10'), 'home'); // reserve 預設返
assert.equal(away('2026-09-11'), 'away');
assert.equal(away('2026-09-21'), 'home'); // 17:46 + 90 = 19:16，趕得切 19:30
assert.equal(away('2026-09-30'), 'home'); // 23:00 出勤，21:30 先出門
assert.equal(away('2026-10-01'), 'away'); // 回程未知：當仲喺外面
assert.equal(homeBy(r, r.trips[0]), '2026-09-04T07:51');

// 10 月檔：開頭嘅回程補返 9 月尾出發嗰段；再匯入 10 月唔會重複
const oct = ics(
  ev('02-Oct CX 401 LHR-HKG', '20261002T100000Z', '20261002T230000Z'), // 3/10 07:00 返到
  ev('05-Oct O ', '20261005', '20261006'),
  ev('08-Oct CX 500 HKG-TPE / 08-Oct CX 501 TPE-HKG', '20261008T090000Z', '20261008T140000Z'),
);
const po = parseRoster(oct);
assert.deepEqual(po.returns, [{ e: '2026-10-03T07:00', d: 'LHR' }]);
let merged = mergeRoster(r, po, '2026-10-01');
assert.equal(merged.trips.find((t) => t.d === 'LHR').e, '2026-10-03T07:00');
assert.equal(merged.trips.length, 6);
merged = mergeRoster(merged, po, '2026-10-01');
assert.equal(merged.trips.length, 6, 're-import replaces, no duplicates');
assert.equal(merged.from, '2026-09-01');
// 換更：10 月重新匯入冇咗 TPE
const oct2 = parseRoster(ics(ev('02-Oct CX 401 LHR-HKG', '20261002T100000Z', '20261002T230000Z'), ev('05-Oct O ', '20261005', '20261008'), ev('31-Oct O ', '20261031', '20261101')));
assert.equal(oct2.to, '2026-10-31');
merged = mergeRoster(merged, oct2, '2026-10-01');
assert.ok(!merged.trips.some((t) => t.d === 'TPE'));
// 太舊（120 日前）嘅唔再保留
assert.equal(mergeRoster(merged, oct2, '2027-03-01').trips.length, 0);

// 日曆
const kinds = (d) => rosterDay(r, d).map((x) => x.kind).join(',');
assert.equal(kinds('2026-09-01'), 'leave');
assert.equal(kinds('2026-09-02'), 'away');
assert.equal(kinds('2026-09-04'), 'back');
assert.equal(kinds('2026-09-09'), 'sim');
assert.equal(kinds('2026-09-10'), 'reserve');
assert.equal(kinds('2026-09-11'), 'turn');
assert.equal(kinds('2026-09-05'), '');

// 食飯：roster 自動當唔返，但自己改過（有紀錄）就跟紀錄
const pilot = { id: 'p', name: '爸爸', pattern: [true, true, true, true, true, true, true], roster: r };
assert.equal(attendance(pilot, '2026-09-02', undefined, 3).home, false);
assert.equal(attendance(pilot, '2026-09-02', undefined, 3).roster, 'LAX');
assert.equal(attendance(pilot, '2026-09-02', { att: { p: { home: true } } }, 3).home, true);
assert.equal(attendance(pilot, '2026-09-04', undefined, 5).home, true);
assert.equal(attendance({ ...pilot, pattern: [false, false, false, false, false, false, false] }, '2026-09-04', undefined, 5).home, false);
assert.equal(attendance(pilot, '2026-09-09', undefined, 3).roster, 'SIM');

assert.throws(() => parseRoster('hello'));
console.log('roster.test.mjs: all passed');
