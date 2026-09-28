// 🍽 菜單：菜式庫、每晚揀菜式、買餸日計出要買咩，再加入購物清單。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { formatDay } from './dates.js';
import { marketWindow, collectIngredients, isStapleName } from './menu.js';
import { prepareItem, lookup, translateTo } from './translate.js';
import { SEED_RECIPES } from './recipes-seed.js';

let m; // { ctx, dinners: () => {...}, headcount: (date) => n, rerender }
let recipes = [];

export function initMenu(opts) {
  m = opts;
}

const state = () => m.ctx.state;
const store = () => state().store;
const fid = () => state().familyId;
const dayLabel = (date) => formatDay(date, langInfo().htmlLang);
const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');

export function subscribeRecipes(familyId) {
  return store().subscribeRecipes(
    familyId,
    (list) => {
      recipes = list;
      ensureRecipeTranslations();
      m.rerender();
    },
    fail,
  );
}

// 菜名：跟語言顯示（姐姐見到印尼文），冇翻譯就用原文
export function dishName(r) {
  const lang = getLang();
  return r.tr?.[lang] || lookup(r.name)?.[lang] || r.name;
}
const ingName = (name) => lookup(name)?.[getLang()] || name;

const translating = new Set();
function ensureRecipeTranslations() {
  const lang = getLang();
  for (const r of recipes) {
    if (r.tr?.[lang] || (r.lang || 'zh') === lang || lookup(r.name)?.[lang]) continue;
    const key = `${r.id}|${lang}`;
    if (translating.has(key)) continue;
    translating.add(key);
    translateTo(r, lang).then((res) => {
      if (res && fid()) store().setRecipeTranslation(fid(), r.id, lang, res.text, res.auto).catch(() => {});
    });
  }
}

const dishesOf = (date) => (m.dinners()[date]?.dishes || []).map((id) => recipes.find((r) => r.id === id)).filter(Boolean);

// 喺食飯頁每日顯示：「番茄炒蛋、蒸魚」
export function dishesLine(date) {
  const list = dishesOf(date);
  return list.length ? `🍽 ${esc(list.map(dishName).join('、'))}` : `<span class="muted">🍽 ${esc(t('noDishes'))}</span>`;
}

// ---------- 🧺 買餸卡 ----------

const marketDays = () => state().family?.marketDays || [];

export function marketCardHtml(today) {
  ensureRecipeTranslations(); // 轉咗語言都會補翻譯
  const win = marketWindow(today, marketDays());
  const items = collectIngredients(win.dates, m.dinners(), recipes).filter((x) => !x.staple);
  const range = win.dates.length > 1 ? `${dayLabel(win.dates[0])} – ${dayLabel(win.dates.at(-1))}` : dayLabel(win.dates[0]);
  return `<section class="card market ${win.isMarketDay ? 'today-market' : ''}">
    <div class="today-head">
      <h2>${esc(win.isMarketDay ? t('marketToday') : t('marketNext', { day: dayLabel(win.start) }))}</h2>
      <button class="link-btn" id="market-days">${esc(t('changeMarketDays'))}</button>
    </div>
    <p class="small muted">${esc(items.length ? t('marketCovers', { range, n: items.length }) : t('marketNoMenu'))}</p>
    ${items.length ? `<button class="btn ${win.isMarketDay ? 'primary' : ''} block" id="open-market">${esc(t('viewMarket'))}</button>` : ''}
  </section>`;
}

export function bindMenu(root, today) {
  $('#market-days', root)?.addEventListener('click', openMarketDays);
  $('#open-market', root)?.addEventListener('click', () => openMarket(marketWindow(today, marketDays()).dates));
  $('#open-recipes', root)?.addEventListener('click', () => openRecipes());
  root.querySelectorAll('[data-menu]').forEach((b) => (b.onclick = () => openMenuDay(b.dataset.menu)));
}

// ---------- 每晚揀菜式 ----------

export function openMenuDay(date) {
  const selected = new Set(m.dinners()[date]?.dishes || []);
  const draw = (dlg, q = '') => {
    const query = q.trim().toLowerCase();
    const list = [...recipes]
      .sort(byName)
      .sort((a, b) => selected.has(b.id) - selected.has(a.id))
      .filter((r) => !query || r.name.toLowerCase().includes(query) || dishName(r).toLowerCase().includes(query));
    $('.dish-list', dlg).innerHTML = list.length
      ? list
          .map(
            (r) => `<label class="dish-row"><input type="checkbox" value="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}>
              <span><b>${esc(dishName(r))}</b>${dishName(r) !== r.name ? ` <span class="small muted">${esc(r.name)}</span>` : ''}
              <span class="small muted block-line">${esc((r.ingredients || []).filter((i) => !i.staple && !isStapleName(i.name)).map((i) => ingName(i.name)).join('、'))}</span></span>
            </label>`,
          )
          .join('')
      : `<p class="small muted">${esc(t('noRecipesYet'))}</p>`;
  };
  openDialog(
    `<form id="menu-form">
      <h2>${esc(t('dishesFor', { day: dayLabel(date) }))}</h2>
      <p class="small muted">🍚 ${esc(t('peopleCount', { n: m.headcount(date) }))}</p>
      <input class="input" id="dish-search" placeholder="${esc(t('searchDishes'))}" autocomplete="off">
      <div class="dish-list"></div>
      <div class="row wrap">
        <button type="button" class="btn" id="menu-new">${esc(t('newRecipe'))}</button>
        ${recipes.length ? '' : `<button type="button" class="btn" id="menu-seed">${esc(t('seedRecipes', { n: SEED_RECIPES.length }))}</button>`}
      </div>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      draw(dlg);
      $('#dish-search', dlg).oninput = (e) => draw(dlg, e.target.value);
      $('.dish-list', dlg).onchange = (e) => {
        if (e.target.checked) selected.add(e.target.value);
        else selected.delete(e.target.value);
      };
      $('#menu-new', dlg).onclick = () => openRecipe(null, () => openMenuDay(date));
      $('#menu-seed', dlg)?.addEventListener('click', async () => {
        await seedRecipes();
        setTimeout(() => draw(dlg), 150);
      });
      $('#menu-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        store().setDishes(fid(), date, [...selected].filter((id) => recipes.some((r) => r.id === id))).catch(fail);
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

// ---------- 📖 菜式庫 ----------

async function seedRecipes() {
  const list = SEED_RECIPES.map(([name, ings]) => ({
    name,
    lang: 'zh',
    tr: prepareItem(name, 'zh').tr,
    trAuto: {},
    ingredients: ings.map(([n, amount = '']) => ({ name: n, amount, staple: isStapleName(n) })),
  }));
  await store().addRecipes(fid(), list).catch(fail);
}

export function openRecipes() {
  openDialog(
    `<h2>${esc(t('recipesTitle'))}</h2>
    ${
      recipes.length
        ? `<ul class="items recipe-list">${[...recipes]
            .sort(byName)
            .map(
              (r) => `<li class="item"><button class="toggle" data-rid="${esc(r.id)}">
                <span class="body"><span class="name">${esc(dishName(r))}</span>
                <div class="meta">${esc((r.ingredients || []).map((i) => ingName(i.name)).join('、'))}</div></span>
              </button></li>`,
            )
            .join('')}</ul>`
        : `<p class="small muted">${esc(t('noRecipesYet'))}</p>
           <button type="button" class="btn block" id="recipes-seed">${esc(t('seedRecipes', { n: SEED_RECIPES.length }))}</button>`
    }
    <div class="actions">
      <button type="button" class="btn" id="recipes-new">${esc(t('newRecipe'))}</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-close>${esc(t('close'))}</button>
    </div>`,
    (dlg) => {
      dlg.querySelectorAll('[data-rid]').forEach((b) => (b.onclick = () => openRecipe(recipes.find((r) => r.id === b.dataset.rid), openRecipes)));
      $('#recipes-new', dlg).onclick = () => openRecipe(null, openRecipes);
      $('#recipes-seed', dlg)?.addEventListener('click', async () => {
        await seedRecipes();
        setTimeout(openRecipes, 150);
      });
    },
  );
}

function ingredientRow(ing = {}) {
  const staple = ing.staple ?? isStapleName(ing.name);
  return `<div class="ing-row">
    <input class="input" name="ing-name" maxlength="30" value="${esc(ing.name || '')}" placeholder="${esc(t('ingredientName'))}" aria-label="${esc(t('ingredientName'))}">
    <input class="input" name="ing-amount" maxlength="20" value="${esc(ing.amount || '')}" placeholder="${esc(t('amountHint'))}" aria-label="${esc(t('amountHint'))}">
    <label class="check-row small"><input type="checkbox" name="ing-staple" ${staple ? 'checked' : ''}> ${esc(t('staple'))}</label>
    <button type="button" class="icon-btn ing-del" aria-label="${esc(t('delete'))}">✕</button>
  </div>`;
}

function openRecipe(recipe, back) {
  const ings = recipe?.ingredients?.length ? recipe.ingredients : [{}, {}, {}];
  openDialog(
    `<form id="recipe-form">
      <h2>${esc(recipe ? t('editRecipe') : t('newRecipe'))}</h2>
      <label class="field"><span>${esc(t('recipeName'))}</span><input class="input" name="name" maxlength="40" required value="${esc(recipe?.name || '')}"></label>
      <div class="field"><span>${esc(t('ingredients'))}</span>
        <div class="ing-rows">${ings.map(ingredientRow).join('')}</div>
        <button type="button" class="btn" id="ing-add">${esc(t('addIngredient'))}</button>
        <span class="small muted">${esc(t('stapleHint'))}</span>
      </div>
      <div class="actions">
        ${recipe ? `<button type="button" class="btn danger" id="recipe-del">${esc(t('delete'))}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" id="recipe-cancel">${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const rows = $('.ing-rows', dlg);
      $('#ing-add', dlg).onclick = () => {
        rows.insertAdjacentHTML('beforeend', ingredientRow());
        rows.lastElementChild.querySelector('input').focus();
      };
      rows.onclick = (e) => e.target.closest('.ing-del')?.closest('.ing-row').remove();
      // 打「鹽」「豉油」之類自動剔「常備」
      rows.oninput = (e) => {
        if (e.target.name !== 'ing-name') return;
        const box = e.target.closest('.ing-row').querySelector('[name="ing-staple"]');
        if (isStapleName(e.target.value)) box.checked = true;
      };
      $('#recipe-cancel', dlg).onclick = () => (back ? back() : dlg.close());
      $('#recipe-del', dlg)?.addEventListener('click', () =>
        confirmDialog(t('deleteRecipeConfirm', { name: recipe.name }), t('delete'), () => {
          store().deleteRecipe(fid(), recipe.id).catch(fail);
          if (back) setTimeout(back, 100);
        }),
      );
      $('#recipe-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const name = clean(new FormData(e.target).get('name'), 40);
        if (!name) return;
        const ingredients = [...dlg.querySelectorAll('.ing-row')]
          .map((row) => ({
            name: clean(row.querySelector('[name="ing-name"]').value, 30),
            amount: clean(row.querySelector('[name="ing-amount"]').value, 20),
            staple: row.querySelector('[name="ing-staple"]').checked,
          }))
          .filter((i) => i.name)
          .slice(0, 40);
        const { lang, tr } = prepareItem(name, getLang());
        if (recipe) {
          const patch = { name, ingredients };
          if (name !== recipe.name) Object.assign(patch, { lang, tr, trAuto: {} });
          store().updateRecipe(fid(), recipe.id, patch).catch(fail);
        } else {
          store().addRecipe(fid(), { name, lang, tr, trAuto: {}, ingredients });
        }
        toast(t('saved'));
        if (back) setTimeout(back, 100);
        else dlg.close();
      };
    },
  );
}

// ---------- ⚙️ 買餸日 ----------

function weekdayName(dow) {
  // 2026-09-27 係星期日
  return new Intl.DateTimeFormat(langInfo().htmlLang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 8, 27 + dow)));
}

function listOptions(selectedId) {
  return state()
    .lists.map((l) => `<option value="${esc(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${esc(lookup(l.name)?.[getLang()] || l.name)}</option>`)
    .join('');
}

function defaultMarketList() {
  const f = state().family;
  const lists = state().lists;
  return lists.find((l) => l.id === f?.marketListId) || lists.find((l) => l.kind !== 'wish') || lists[0];
}

function openMarketDays() {
  const days = new Set(marketDays().map(Number));
  openDialog(
    `<form id="market-days-form">
      <h2>${esc(t('marketDays'))}</h2>
      <p class="small muted">${esc(t('marketDaysHint'))}</p>
      <div class="segmented days-pick">${[1, 2, 3, 4, 5, 6, 0]
        .map((dow) => `<label><input type="checkbox" name="dow" value="${dow}" ${days.has(dow) ? 'checked' : ''}><span>${esc(weekdayName(dow))}</span></label>`)
        .join('')}</div>
      <label class="field"><span>${esc(t('marketList'))}</span><select class="input" name="list">${listOptions(defaultMarketList()?.id)}</select></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      $('#market-days-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const marketDaysNew = f.getAll('dow').map(Number).sort();
        store().updateFamily(fid(), { marketDays: marketDaysNew, marketListId: f.get('list') || '' }).catch(fail);
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

// ---------- 🧾 要買咩 ----------

const sameName = (item, name) => {
  const n = name.toLowerCase();
  return item.name.toLowerCase() === n || Object.values(item.tr || {}).some((v) => String(v).toLowerCase() === n);
};

function suggestionText(uses) {
  return uses
    .map((u) => {
      const dow = new Intl.DateTimeFormat(langInfo().htmlLang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${u.date}T00:00:00Z`));
      const where = `${dow} ${u.dish}${u.people != null ? `·${t('peopleShort', { n: u.people })}` : ''}`;
      return u.amount ? `${u.amount}（${where}）` : `（${where}）`;
    })
    .join('、');
}

export function openMarket(dates) {
  const list = collectIngredients(dates, m.dinners(), recipes, m.headcount);
  let target = defaultMarketList();
  const range = dates.length > 1 ? `${dayLabel(dates[0])} – ${dayLabel(dates.at(-1))}` : dayLabel(dates[0]);

  const onList = (name) => state().items.some((i) => i.listId === target?.id && !i.done && sameName(i, name));
  const row = (x, i) => {
    const already = onList(x.name);
    const shown = ingName(x.name);
    return `<label class="market-row ${already ? 'muted' : ''}">
      <input type="checkbox" name="ing" value="${i}" ${!x.staple && !already ? 'checked' : ''} ${already ? 'disabled' : ''}>
      <span><b>${esc(shown)}</b>${shown !== x.name ? ` <span class="small muted">${esc(x.name)}</span>` : ''}
        ${already ? ` <span class="pill">${esc(t('alreadyOnListShort'))}</span>` : ''}
        <span class="small muted block-line">${esc(t('suggestion', { text: suggestionText(x.uses) }))}</span></span>
    </label>`;
  };
  const draw = (dlg) => {
    const fresh = list.map((x, i) => [x, i]).filter(([x]) => !x.staple);
    const staples = list.map((x, i) => [x, i]).filter(([x]) => x.staple);
    $('.market-rows', dlg).innerHTML =
      fresh.map(([x, i]) => row(x, i)).join('') +
      (staples.length ? `<h3 class="group-title">${esc(t('marketStaples'))}</h3>${staples.map(([x, i]) => row(x, i)).join('')}` : '');
    updateCount(dlg);
  };
  const updateCount = (dlg) => {
    $('#market-add', dlg).textContent = t('addToList', { n: dlg.querySelectorAll('input[name="ing"]:checked').length });
  };

  openDialog(
    `<form id="market-form">
      <h2>🧾 ${esc(t('marketSummary'))}</h2>
      <p class="small muted">${esc(range)} · ${esc(t('marketSummaryHint'))}</p>
      <ul class="plan">${dates
        .map((date) => `<li><b>${esc(dayLabel(date))}</b> 🍚 ${m.headcount(date)} · ${dishesLine(date)}</li>`)
        .join('')}</ul>
      <div class="market-rows"></div>
      <label class="field"><span>${esc(t('marketList'))}</span><select class="input" name="list">${listOptions(target?.id)}</select></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary" id="market-add"></button>
      </div>
    </form>`,
    (dlg) => {
      draw(dlg);
      $('.market-rows', dlg).onchange = () => updateCount(dlg);
      $('select[name="list"]', dlg).onchange = (e) => {
        target = state().lists.find((l) => l.id === e.target.value) || target;
        draw(dlg);
      };
      $('#market-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        if (!target) return;
        const chosen = [...dlg.querySelectorAll('input[name="ing"]:checked')].map((b) => list[Number(b.value)]);
        let added = 0;
        for (const x of chosen) {
          const note = t('suggestion', { text: suggestionText(x.uses) }).slice(0, 100);
          const doneItem = state().items.find((i) => i.listId === target.id && i.done && sameName(i, x.name));
          if (doneItem) {
            store().updateItem(fid(), doneItem.id, { done: false, doneBy: null, note, addedBy: state().me }).catch(fail);
          } else {
            const { lang, tr, category } = prepareItem(x.name, getLang());
            store()
              .addItem(fid(), {
                listId: target.id,
                name: x.name,
                lang,
                tr,
                trAuto: {},
                qty: '',
                note,
                category,
                addedBy: state().me,
                forWho: '',
                price: '',
                link: '',
                photos: [],
                thumb: '',
              })
              .catch(fail);
          }
          added++;
        }
        dlg.close();
        toast(t('addedToList', { n: added }));
      };
    },
  );
}
