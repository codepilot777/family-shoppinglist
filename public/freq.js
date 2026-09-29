// ⭐ 常買：全家加過幾多次、幾時最後加，計出最常買嘅嘢（冇 DOM，方便測試）。

// doc ID：名轉細楷再 encode（同家庭字典一樣，唔可以有「/」）
export const freqKey = (name) => encodeURIComponent(String(name).trim().toLowerCase()).slice(0, 400).replace(/^\.*$/, (m) => `_${m}`);

// 愈常買、愈近期買，分數愈高；一個月前嘅次數大約計一半
export function score(doc, now) {
  const days = Math.max(0, (now - (doc.lastAt || 0)) / 86400000);
  return (doc.count || 0) / (1 + days / 30);
}

/**
 * @param docs [{ id, name, count, lastAt, category, tr }]
 * @param exclude Set(細楷名)：已經喺清單未買嘅唔使再建議
 */
export function topFrequent(docs, { now = Date.now(), exclude = new Set(), limit = 12, minCount = 2 } = {}) {
  return docs
    .filter((d) => d.name && (d.count || 0) >= minCount && !exclude.has(d.name.trim().toLowerCase()))
    .map((d) => ({ ...d, score: score(d, now) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
