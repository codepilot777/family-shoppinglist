// 菜單同買餸計算（冇 DOM，app 同通知 script 共用）。
import { addDays, weekday } from './dates.js';

// 常備調味料：預設唔加入購物清單（屋企通常有）
export const STAPLES = ['鹽', '糖', '冰糖', '油', '食油', '豉油', '生抽', '老抽', '蠔油', '粟粉', '胡椒粉', '雞粉', '麻油', '醋', '陳皮', '料酒', '紹興酒', '豆豉'];
export const isStapleName = (name) => STAPLES.includes(String(name || '').trim());

const norm = (s) => String(s || '').trim().toLowerCase();

// 今日（或者 from）開始嘅買餸範圍：由買餸日到下一個買餸日前一日。
// marketDays = [0..6]（0 = 星期日）；冇設定就當每日都買。
export function marketWindow(from, marketDays) {
  const days = [...new Set((marketDays || []).map(Number))].filter((d) => d >= 0 && d <= 6);
  if (!days.length) return { start: from, dates: [from], isMarketDay: true };
  let start = from;
  for (let i = 0; i < 7 && !days.includes(weekday(start)); i++) start = addDays(start, 1);
  const dates = [start];
  for (let i = 1; i < 7; i++) {
    const d = addDays(start, i);
    if (days.includes(weekday(d))) break;
    dates.push(d);
  }
  return { start, dates, isMarketDay: start === from };
}

/**
 * 將幾日菜單嘅材料合併：同一樣材料（名一樣）合埋，列出每個餸建議幾多。
 * @param dates ['YYYY-MM-DD', …]
 * @param dinners { date: { dishes: [recipeId] } }
 * @param recipes [{ id, name, ingredients: [{ name, amount, staple }] }]
 * @param headcount (date) => 人數（顯示用）
 * @returns [{ key, name, staple, uses: [{ date, dish, amount, people }] }]
 */
export function collectIngredients(dates, dinners, recipes, headcount = () => null) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const map = new Map();
  for (const date of dates) {
    for (const rid of dinners[date]?.dishes || []) {
      const r = byId.get(rid);
      if (!r) continue;
      for (const ing of r.ingredients || []) {
        const name = String(ing.name || '').trim();
        if (!name) continue;
        const key = norm(name);
        if (!map.has(key)) map.set(key, { key, name, staple: !!ing.staple || isStapleName(name), uses: [] });
        const entry = map.get(key);
        if (!ing.staple && !isStapleName(name)) entry.staple = false;
        entry.uses.push({ date, dish: r.name, amount: String(ing.amount || '').trim(), people: headcount(date) });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.staple - b.staple);
}
