// 貨品名翻譯同分類。
// 查詢次序：家庭字典（屋企人自己改過嘅）→ 內置字典 → 機翻（MyMemory，免費、唔使 key）。
import { DICT_INDEX } from './dictionary.js';

export const ITEM_LANGS = ['zh', 'en', 'id'];

const CJK = /[㐀-鿿豈-﫿]/;

// 先揀啲容易撞字嘅詞（例如「牛油果」唔係牛油）
const CATEGORY_OVERRIDES = [
  ['veg', ['牛油果', '粟米']],
  ['drink', ['檸檬水', '檸檬茶']],
];

// 次序有關係：例如「牛奶」要先中「奶」而唔係「牛」，「洗頭水」要先中日用品。
const CATEGORY_KEYWORDS = [
  ['home', ['紙', '洗', '牙', '沐浴', '梘', '垃圾袋', '電池', '燈泡', '保鮮', '錫紙', '漂白', '消毒', '口罩', '棉花', '衛生巾', '尿片', '濕巾', '清潔']],
  ['frozen', ['急凍', '冷凍', '雪藏', '餃子', '水餃', '雲吞', '魚蛋', '燒賣', '雪糕']],
  ['dairy', ['奶', '蛋', '芝士', '乳酪', '牛油', '忌廉', '豆腐']],
  ['snack', ['薯片', '朱古力', '餅', '糖果', '零食', '果仁', '啫喱', '爆谷', '紫菜']],
  ['drink', ['汽水', '可樂', '果汁', '茶', '咖啡', '啤酒', '酒', '礦泉水', '蒸餾水', '樽裝水', '豆漿']],
  ['veg', ['菜', '番茄', '蕃茄', '薯仔', '洋蔥', '蘿蔔', '蘋果', '橙', '香蕉', '提子', '士多啤梨', '西瓜', '果', '瓜', '蒜', '薑', '蔥', '芫茜', '菇', '西蘭花', '豆角', '椒', '檸檬', '奇異果', '芒果', '梨', '藍莓']],
  ['meat', ['豬', '牛', '雞', '魚', '蝦', '肉', '排骨', '叉燒', '蟹', '帶子', '腸', '火腿', '煙肉', '鴨', '羊', '蠔', '魷']],
  ['staple', ['米', '麵', '意粉', '油', '鹽', '糖', '豉油', '醋', '醬', '粉', '罐頭', '麥皮', '通粉', '湯']],
];

export function guessCategory(text) {
  const n = String(text || '').toLowerCase();
  for (const [cat, words] of [...CATEGORY_OVERRIDES, ...CATEGORY_KEYWORDS]) if (words.some((w) => n.includes(w))) return cat;
  return 'other';
}

const norm = (s) => String(s || '').trim().toLowerCase();

// 家庭字典：{ key: {zh, en, id, cat} }，每個語言嘅字都可以查
let familyIndex = new Map();
export function setFamilyDictionary(entries) {
  familyIndex = new Map();
  for (const e of entries) for (const l of ITEM_LANGS) if (e[l]) familyIndex.set(norm(e[l]), e);
}

export function lookup(text) {
  const k = norm(text);
  return familyIndex.get(k) || DICT_INDEX.get(k) || null;
}

// 估個名係咩語言：有中文字就係中文；否則睇字典；再唔係就當係輸入者嘅介面語言
export function detectLang(text, uiLang) {
  if (CJK.test(text)) return 'zh';
  const e = lookup(text);
  if (e) {
    if (norm(e.id) === norm(text) && norm(e.en) !== norm(text)) return 'id';
    if (norm(e.en) === norm(text)) return 'en';
  }
  return uiLang === 'zh' ? 'en' : uiLang;
}

// 加新貨品時用：盡量由字典即刻攞晒翻譯同分類（唔使等網絡）
export function prepareItem(name, uiLang) {
  const lang = detectLang(name, uiLang);
  const entry = lookup(name);
  const tr = {};
  if (entry) for (const l of ITEM_LANGS) if (entry[l]) tr[l] = entry[l];
  tr[lang] = name;
  const category = entry?.cat || guessCategory(tr.zh || name);
  return { lang, tr, category };
}

// ---------- 機翻 ----------

const MT_CODES = { zh: 'zh-TW', en: 'en', id: 'id' };
const CACHE_KEY = 'fsl-mt-cache';
let cache;
function mtCache() {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
      cache = {};
    }
  }
  return cache;
}
function saveCache() {
  try {
    const entries = Object.entries(cache);
    if (entries.length > 500) cache = Object.fromEntries(entries.slice(-400));
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export async function machineTranslate(text, from, to) {
  if (from === to) return text;
  const key = `${from}|${to}|${text}`;
  const c = mtCache();
  if (c[key]) return c[key];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${MT_CODES[from]}|${MT_CODES[to]}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const out = String(data?.responseData?.translatedText || '').trim();
    if (Number(data?.responseStatus) !== 200 || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) return null;
    if (norm(out) === norm(text)) return null;
    const result = out.slice(0, 60);
    c[key] = result;
    saveCache();
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 攞某個語言嘅翻譯：先查字典，唔得先機翻。回傳 { text, auto } 或 null
export async function translateTo(item, to) {
  const entry = lookup(item.name) || (item.tr?.zh && lookup(item.tr.zh));
  if (entry?.[to]) return { text: entry[to], auto: false };
  const text = await machineTranslate(item.name, item.lang || detectLang(item.name, 'zh'), to);
  return text ? { text, auto: true } : null;
}
