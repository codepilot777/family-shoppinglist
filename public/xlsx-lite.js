// 讀 .xlsx（Excel）最基本嘅內容：每張 sheet 嘅名同每格嘅值（數字或者文字）。
// 唔使額外 library：.xlsx 係 zip，用瀏覽器內置 DecompressionStream 解壓，再用 regex 讀 XML。
// 冇用 DOM，瀏覽器同 Node（測試）都用得。

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// zip → Map(檔名 → Uint8Array)，只解壓 wanted(name) 為 true 嘅檔案
async function unzip(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip / xlsx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflateRaw(data));
  }
  return files;
}

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()],
  );
const textOf = (xml) => unescapeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// → [{ name, cells: Map('row,col' → number|string) }]（row / col 由 0 開始）
export async function readXlsx(buf) {
  const files = await unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const wb = files.get('xl/workbook.xml');
  if (!wb) throw new Error('not an xlsx file');
  const shared = files.has('xl/sharedStrings.xml') ? [...td.decode(files.get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rels = new Map(
    [...td.decode(files.get('xl/_rels/workbook.xml.rels') || new Uint8Array()).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      (/\bId="([^"]+)"/.exec(m[0]) || [])[1],
      (/\bTarget="([^"]+)"/.exec(m[0]) || [])[1],
    ]),
  );
  const sheets = [];
  for (const m of td.decode(wb).matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml((/\bname="([^"]*)"/.exec(m[0]) || [])[1] || '');
    const rid = (/\br:id="([^"]+)"/.exec(m[0]) || [])[1];
    let target = rels.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = files.get(target);
    if (!xml) continue;
    const cells = new Map();
    for (const c of td.decode(xml).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(c[1]);
      if (!ref || !c[2]) continue;
      const type = (/\bt="([^"]+)"/.exec(c[1]) || [])[1] || 'n';
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c[2]) || [])[1];
      let value;
      if (type === 's') value = shared[Number(v)];
      else if (type === 'inlineStr') value = textOf(c[2]);
      else if (type === 'str' || type === 'e') value = v == null ? undefined : unescapeXml(v);
      else if (type === 'b') value = v === '1';
      else value = v == null ? undefined : Number(v);
      if (value === undefined || value === '') continue;
      cells.set(`${Number(ref[2]) - 1},${colIndex(ref[1])}`, value);
    }
    sheets.push({ name, cells });
  }
  return sheets;
}

// Excel 日子序號 → 'YYYY-MM-DD'（1900 日期系統）
export const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400e3).toISOString().slice(0, 10);
