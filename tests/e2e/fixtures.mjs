// 測試用檔案（日子跟今日計，幾時跑都啱）：roster .ics 同 Excel 更表 .xlsx
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'home-hub-'));
export const tmpFile = (name, data) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};

// '2026-10-06T11:30'（香港時間）→ ICS UTC '20261006T033000Z'
const utc = (hk) => new Date(Date.parse(`${hk}:00+08:00`)).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const ymd = (d) => d.replace(/-/g, '');

// events: [{ sum, s, e }]（有時間）或者 [{ sum, day }]（全日）
export function makeIcs(events) {
  const body = events
    .map((x) =>
      x.day
        ? `BEGIN:VEVENT\r\nSUMMARY:${x.sum}\r\nDTSTART;VALUE=DATE:${ymd(x.day)}\r\nDTEND;VALUE=DATE:${ymd(x.end || x.day)}\r\nEND:VEVENT\r\n`
        : `BEGIN:VEVENT\r\nSUMMARY:${x.sum}\r\nDTSTART:${utc(x.s)}\r\nDTEND:${utc(x.e)}\r\nEND:VEVENT\r\n`,
    )
    .join('');
  return `BEGIN:VCALENDAR\r\nPRODID:-//Test//Roster//EN\r\n${body}END:VCALENDAR\r\n`;
}

// ---------- 最細嘅 .xlsx（zip，唔壓縮）----------
const enc = new TextEncoder();
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = enc.encode(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    chunks.push(local, nameB, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameB.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cenSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const serial = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400e3);
const col = (i) => String.fromCharCode(66 + i); // B..H
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// 月曆格式嘅更表：每個月一張 sheet，日子下面一格寫 label（例如 OFF）；labels = { 'YYYY-MM-DD': 'OFF' }
export function makeRosterXlsx(months, labels) {
  const files = {};
  const sheets = months.map((ym, i) => {
    const first = `${ym}-01`;
    let start = first;
    while (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) start = addDays(start, -1); // 由星期一開始
    const rows = [`<row r="1"><c r="B1" t="inlineStr"><is><t>${MONTHS[+ym.slice(5) - 1]}</t></is></c></row>`];
    for (let w = 0; w < 6; w++) {
      const r = 3 + w * 2;
      const days = Array.from({ length: 7 }, (_, k) => addDays(start, w * 7 + k));
      rows.push(`<row r="${r}">${days.map((d, k) => `<c r="${col(k)}${r}"><v>${serial(d)}</v></c>`).join('')}</row>`);
      const labelled = days.map((d, k) => (labels[d] ? `<c r="${col(k)}${r + 1}" t="inlineStr"><is><t>${labels[d]}</t></is></c>` : '')).join('');
      if (labelled) rows.push(`<row r="${r + 1}">${labelled}</row>`);
    }
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0"?><worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
    return `<sheet name="${MONTHS[+ym.slice(5) - 1]}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  });
  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${sheets.join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships>${months
    .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`;
  return zip(files);
}
