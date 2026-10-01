// 🛒 買咗一部分：數量開頭係數字（「8」、「8件」、「1.5斤」）先可以分開買。冇用 DOM，方便測試。

// '8件' → { n: 8, unit: '件' }；唔係數字開頭（「一大包」）→ null
export function parseQty(qty) {
  const m = String(qty ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? { n, unit: m[2].trim() } : null;
}

const fmt = (x) => String(Math.round(x * 100) / 100);
export const amount = (x, unit) => `${fmt(x)}${unit && /^[a-z]/i.test(unit) ? ' ' : ''}${unit}`;

// 撳完「買咗幾多」之後要寫入嘅欄位：買夠就當成樣買晒
export function partialPatch(item, got, me) {
  const q = parseQty(item.qty);
  const x = Math.max(0, Number(got) || 0);
  if (!q || x <= 0) return { got: 0, gotBy: '' };
  if (x >= q.n) return { done: true, doneBy: me, got: 0, gotBy: '' };
  return { got: x, gotBy: me };
}

// 未買晒嘅：{ got, left, n, unit }；冇買過 / 已買晒 / 唔係數字 → null
export function progress(item) {
  if (item.done || !(item.got > 0)) return null;
  const q = parseQty(item.qty);
  if (!q || item.got >= q.n) return null;
  return { got: item.got, left: q.n - item.got, n: q.n, unit: q.unit };
}
