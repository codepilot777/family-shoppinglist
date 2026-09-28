import { createStore } from './store.js';
import { canInstall, openInstall, onInstallChange, isIOS } from './install.js';
import { t, initLang, setLang, getLang, langInfo, LANGS, CATEGORY_IDS, CATEGORY_ICONS } from './i18n.js';
import { ITEM_LANGS, prepareItem, translateTo, setFamilyDictionary, lookup } from './translate.js';
import { compressImage, PHOTO_OPTS, THUMB_OPTS, MAX_PHOTOS } from './image.js';
import { $, esc, ls, clean, toast, fail, timeAgo, openDialog, confirmDialog } from './ui.js';
import { initDinner, renderDinner, dinnerOnEnterFamily, handleDinnerParams, refreshPushToken } from './dinner-view.js';

// ---------- 小工具 ----------

const catOf = (item) => (CATEGORY_IDS.includes(item.category) ? item.category : 'other');
const catLabel = (id) => `${CATEGORY_ICONS[id]} ${t(`cat_${id}`)}`;
// 清單名如果係常見地方（超市、街市…）就跟語言顯示
const listLabel = (l) => lookup(l.name)?.[getLang()] || l.name;
const isWish = (l) => l?.kind === 'wish';
const currentList = () => state.lists.find((l) => l.id === state.listId);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

// ---------- 狀態 ----------

const state = {
  store: null,
  me: ls.get('fsl-name') || '',
  familyId: ls.get('fsl-family'),
  family: null,
  lists: [],
  items: [],
  listId: null,
  unsubs: [],
};

initLang(ls.get('fsl-lang'));
applyTextSize(ls.get('fsl-size') || 'normal');

function rememberName(name) {
  state.me = name;
  ls.set('fsl-name', name);
}

function changeLang(lang) {
  setLang(lang);
  ls.set('fsl-lang', lang);
  translating.clear();
}

function applyTextSize(size, persist = true) {
  document.documentElement.dataset.size = size;
  if (persist) ls.set('fsl-size', size);
}

function pastNames() {
  try {
    return JSON.parse(ls.get('fsl-history')) || [];
  } catch {
    return [];
  }
}
function addHistory(name) {
  const h = [name, ...pastNames().filter((x) => x !== name)].slice(0, 150);
  ls.set('fsl-history', JSON.stringify(h));
}

// 貨品喺「我」嘅語言點顯示：{ text, original, auto }
function displayName(item) {
  const lang = getLang();
  const text = item.tr?.[lang] || item.name;
  return { text, original: text !== item.name ? item.name : '', auto: text !== item.name && !!item.trAuto?.[lang] };
}

// 睇到未有自己語言翻譯嘅貨品，就喺背景翻譯，再寫返入資料庫俾其他同語言嘅人用
const translating = new Set();
function ensureTranslations(items) {
  const lang = getLang();
  for (const item of items) {
    if (item.tr?.[lang] || (item.lang || 'zh') === lang) continue;
    const key = `${item.id}|${lang}`;
    if (translating.has(key)) continue;
    translating.add(key);
    translateTo(item, lang).then((res) => {
      if (res && state.familyId) state.store.setTranslation(state.familyId, item.id, lang, res.text, res.auto).catch(fail);
    });
  }
}

// ---------- 開始 ----------

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const params = new URLSearchParams(location.search);
  const invite = clean(params.get('f'), 40);
  if (params.get('view') === 'dinner') ls.set('fsl-view', 'dinner');
  if (location.search) window.history.replaceState(null, '', location.pathname);
  initDinner({ state });

  try {
    state.store = await createStore();
  } catch (err) {
    console.error(err);
    renderFatal(err);
    return;
  }

  if (invite && invite !== state.familyId) return renderSetup({ invite });
  if (!state.me || !state.familyId) return renderSetup({});
  enterFamily(state.familyId);
  handleDinnerParams(params);
}

function renderFatal(err) {
  const hint =
    err?.code === 'auth/operation-not-allowed' || err?.code === 'auth/admin-restricted-operation'
      ? t('fatalAnon')
      : err?.code === 'auth/network-request-failed'
        ? t('fatalNetwork')
        : t('fatalConfig');
  const app = $('#app');
  app.className = 'loading';
  app.innerHTML = `<div class="card" style="max-width:420px">
    <h2>${esc(t('fatalTitle'))}</h2>
    <p>${esc(hint)}</p>
    <p class="small muted">${esc(err?.code || err?.message || err)}</p>
    <button class="btn primary block" onclick="location.reload()">${esc(t('retry'))}</button>
  </div>`;
}

function langPicker(name = 'lang') {
  return `<div class="segmented" role="radiogroup" aria-label="${esc(t('language'))}">${LANGS.map(
    (l) =>
      `<label><input type="radio" name="${name}" value="${l.id}" ${l.id === getLang() ? 'checked' : ''}><span>${esc(l.label)}</span></label>`,
  ).join('')}</div>`;
}

// ---------- 設定畫面（建立 / 加入家庭） ----------

async function renderSetup({ invite }) {
  const app = $('#app');
  app.className = '';
  let inviteFamily = null;
  if (invite) {
    try {
      inviteFamily = await state.store.getFamily(invite);
    } catch (err) {
      console.error(err);
    }
  }
  // 保留已經打咗嘅名（例如切換語言嘅時候）
  const typedName = $('#me')?.value;

  app.innerHTML = `<div class="setup">
    <div class="field setup-lang"><span>🌐 ${esc(t('language'))}</span>${langPicker('setup-lang')}</div>
    ${
      canInstall()
        ? `<div class="install-card ${isIOS() ? 'ios' : ''}">
            <button type="button" class="btn block" id="setup-install">${esc(t('install'))}</button>
            ${isIOS() ? `<p class="small muted">${esc(t('installSetupHint'))}</p>` : ''}
          </div>`
        : ''
    }
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>${esc(t('appName'))}</h1>
    <p class="lead">${esc(t('tagline'))}</p>
    ${state.store.mode === 'local' ? `<div class="demo-note">${esc(t('demoNote'))}</div>` : ''}

    <div class="card">
      <label class="field"><span>${esc(t('yourName'))}</span>
        <input class="input" id="me" maxlength="20" placeholder="${esc(t('namePlaceholder'))}" value="${esc(typedName ?? state.me)}" autocomplete="nickname">
      </label>
    </div>

    ${
      invite
        ? inviteFamily
          ? `<div class="card">
              <h2>${esc(t('joinFamilyNamed', { name: inviteFamily.name }))}</h2>
              <button class="btn primary block" id="join-invite">${esc(t('join'))}</button>
            </div>
            <p class="or"><button class="link-btn" id="skip-invite">${esc(t('skipInvite'))}</button></p>`
          : `<div class="card"><h2>${esc(t('inviteNotFound'))}</h2><p class="muted small">${esc(t('inviteNotFoundHint'))}</p>
              <button class="btn block" id="skip-invite">${esc(t('back'))}</button></div>`
        : `<div class="card">
            <h2>${esc(t('createFamily'))}</h2>
            <label class="field"><span>${esc(t('familyName'))}</span>
              <input class="input" id="family-name" maxlength="30" value="${esc(t('defaultFamilyName'))}">
            </label>
            <button class="btn primary block" id="create">${esc(t('create'))}</button>
          </div>
          <p class="or">${esc(t('or'))}</p>
          <div class="card">
            <h2>${esc(t('joinFamily'))}</h2>
            <label class="field"><span>${esc(t('familyCodeHint'))}</span>
              <input class="input" id="code" maxlength="200" autocapitalize="off" autocomplete="off" spellcheck="false">
            </label>
            <button class="btn block" id="join">${esc(t('join'))}</button>
          </div>`
    }
  </div>`;

  app.querySelectorAll('input[name="setup-lang"]').forEach((r) =>
    r.addEventListener('change', () => {
      changeLang(r.value);
      renderSetup({ invite });
    }),
  );

  $('#setup-install')?.addEventListener('click', () => openInstall({ inviteLink: invite ? `${location.origin}${location.pathname}?f=${invite}` : '', familyId: invite }));

  const needName = () => {
    const name = clean($('#me').value, 20);
    if (!name) {
      toast(t('needName'));
      $('#me').focus();
      return null;
    }
    rememberName(name);
    return name;
  };

  const busy = (btn, on) => {
    if (btn) btn.disabled = on;
  };

  $('#skip-invite')?.addEventListener('click', () => renderSetup({}));

  $('#join-invite')?.addEventListener('click', () => {
    if (!needName()) return;
    joinFamily(invite);
  });

  $('#create')?.addEventListener('click', async (e) => {
    if (!needName()) return;
    const familyName = clean($('#family-name').value, 30) || t('defaultFamilyName');
    busy(e.target, true);
    try {
      const fid = await state.store.createFamily(familyName, t('defaultListName'));
      joinFamily(fid);
      setTimeout(openInvite, 400);
    } catch (err) {
      fail(err);
      busy(e.target, false);
    }
  });

  $('#join')?.addEventListener('click', async (e) => {
    if (!needName()) return;
    let code = clean($('#code').value, 200);
    // 容許直接貼成條連結
    const m = code.match(/[?&]f=([a-z0-9]+)/i);
    if (m) code = m[1];
    code = code.toLowerCase();
    if (!code) return toast(t('needCode'));
    busy(e.target, true);
    try {
      const fam = await state.store.getFamily(code);
      if (!fam) {
        toast(t('familyNotFound'));
        busy(e.target, false);
        return;
      }
      joinFamily(code);
    } catch (err) {
      fail(err);
      busy(e.target, false);
    }
  });
}

function joinFamily(fid) {
  state.familyId = fid;
  ls.set('fsl-family', fid);
  enterFamily(fid);
}

function leaveFamily() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.familyId = null;
  state.family = null;
  state.lists = [];
  state.items = [];
  setFamilyDictionary([]);
  ls.set('fsl-family', null);
  renderSetup({});
}

// ---------- 主畫面 ----------

function enterFamily(fid) {
  state.unsubs.forEach((u) => u());
  state.listId = ls.get(`fsl-list-${fid}`);
  renderShell();

  const s = state.store;
  state.unsubs = [
    s.subscribeFamily(fid, (fam) => {
      state.family = fam;
      renderTitle();
    }),
    s.subscribeLists(
      fid,
      (lists) => {
        state.lists = lists.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (!state.lists.some((l) => l.id === state.listId)) selectList(state.lists[0]?.id || null, false);
        render();
      },
      fail,
    ),
    s.subscribeItems(
      fid,
      (items) => {
        state.items = items;
        render();
      },
      fail,
    ),
    s.subscribeDict(fid, (entries) => {
      setFamilyDictionary(entries);
      render();
    }),
    ...dinnerOnEnterFamily(fid),
  ];
}

function showView(view) {
  const dinner = view === 'dinner';
  ls.set('fsl-view', dinner ? 'dinner' : 'shop');
  document.querySelectorAll('.views [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#shop-view')?.classList.toggle('hidden', dinner);
  $('.addbar')?.classList.toggle('hidden', dinner);
  $('#dinner')?.classList.toggle('hidden', !dinner);
  document.body.classList.toggle('dinner-mode', dinner);
  if (dinner) renderDinner();
  else render();
}

function selectList(id, rerender = true) {
  state.listId = id;
  ls.set(`fsl-list-${state.familyId}`, id);
  if (rerender) render();
}

function renderTitle() {
  const name = state.family?.name;
  const el = $('#family-title');
  if (el) el.textContent = name || t('appName');
  document.title = name ? `${name} · ${t('appName')}` : t('appName');
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function renderShell() {
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <header class="topbar">
      <h1 id="family-title"></h1>
      <span class="offline ${navigator.onLine ? 'hidden' : ''}" id="offline">${esc(t('offline'))}</span>
      ${canInstall() ? `<button class="icon-btn" id="install-btn" aria-label="${esc(t('install'))}" title="${esc(t('install'))}">📲</button>` : ''}
      <button class="icon-btn" id="invite-btn" aria-label="${esc(t('invite'))}" title="${esc(t('invite'))}">👪</button>
      <button class="icon-btn" id="settings-btn" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">⚙️</button>
    </header>
    <nav class="views">
      <button data-view="shop">${esc(t('viewShop'))}</button>
      <button data-view="dinner">${esc(t('viewDinner'))}</button>
    </nav>
    <div id="shop-view">
    <nav class="tabs" id="tabs" role="tablist" aria-label="${esc(t('lists'))}"></nav>
    <main id="list"></main>
    </div>
    <main id="dinner" class="hidden"></main>
    <div class="addbar">
      <form id="add-form" autocomplete="off">
        ${SpeechRecognition ? `<button type="button" class="btn mic" id="mic" aria-label="${esc(t('voice'))}" title="${esc(t('voice'))}">🎤</button>` : ''}
        <input class="input name-input" id="add-name" maxlength="500" placeholder="${esc(t('addPlaceholder'))}" list="history" enterkeyhint="done" aria-label="${esc(t('itemName'))}">
        <button type="button" class="btn icon-square" id="add-photo" aria-label="${esc(t('addPhoto'))}" title="${esc(t('addPhoto'))}">📷</button>
        <input class="input qty-input" id="add-qty" maxlength="12" placeholder="${esc(t('qty'))}" aria-label="${esc(t('qty'))}">
        <button class="btn primary">${esc(t('add'))}</button>
        <input type="file" id="photo-input" accept="image/*" hidden>
      </form>
      <datalist id="history"></datalist>
    </div>`;

  renderTitle();
  $('#invite-btn').onclick = openInvite;
  $('#install-btn')?.addEventListener('click', () => openInstall({ inviteLink: inviteLink(), familyId: state.familyId }));
  document.querySelectorAll('.views [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  showView(ls.get('fsl-view') || 'shop');
  $('#settings-btn').onclick = openSettings;
  $('#add-form').onsubmit = onAdd;
  $('#mic')?.addEventListener('click', startVoice);
  $('#add-photo').onclick = () => $('#photo-input').click();
  $('#photo-input').onchange = onAddPhoto;
  $('#add-name').addEventListener('focus', fillHistory, { once: true });

  $('#tabs').onclick = (e) => {
    const tab = e.target.closest('[data-list]');
    if (tab) selectList(tab.dataset.list);
    else if (e.target.closest('#add-list')) openNewList();
  };

  $('#list').onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (e.target.closest('#clear-done')) return clearDone();
    if (e.target.closest('#empty-add-list')) return openNewList();
    if (!row) return;
    const item = state.items.find((i) => i.id === row.dataset.id);
    if (!item) return;
    if (e.target.closest('.more')) openEditItem(item);
    else if (e.target.closest('.thumb-btn')) openPhotos(item);
    else if (e.target.closest('.link-out')) return; // 由 <a> 自己處理
    else toggleItem(item);
  };
}

function fillHistory() {
  $('#history').innerHTML = pastNames()
    .map((h) => `<option value="${esc(h)}"></option>`)
    .join('');
}

onInstallChange(() => {
  if (!canInstall()) {
    $('#install-btn')?.remove();
    $('.install-card')?.remove();
  }
});

window.addEventListener('online', () => $('#offline')?.classList.add('hidden'));
window.addEventListener('offline', () => $('#offline')?.classList.remove('hidden'));

function render() {
  const tabs = $('#tabs');
  const list = $('#list');
  if (!tabs || !list) return;

  const pending = (lid) => state.items.filter((i) => i.listId === lid && !i.done).length;
  tabs.innerHTML =
    state.lists
      .map(
        (l) =>
          `<button class="tab" role="tab" data-list="${esc(l.id)}" aria-selected="${l.id === state.listId}">${isWish(l) ? '🎁 ' : ''}${esc(listLabel(l))}${
            pending(l.id) ? `<span class="count">${pending(l.id)}</span>` : ''
          }</button>`,
      )
      .join('') + `<button class="tab add" id="add-list" aria-label="${esc(t('newList'))}">${esc(t('newListTab'))}</button>`;

  $('#add-form')?.classList.toggle('hidden', !state.listId);
  const list0 = currentList();
  const addName = $('#add-name');
  if (addName) addName.placeholder = isWish(list0) ? t('wishPlaceholder') : t('addPlaceholder');

  if (!state.listId) {
    list.innerHTML = `<div class="empty"><div class="big">🗒️</div><p>${esc(t('noLists'))}</p>
      <button class="btn primary" id="empty-add-list">${esc(t('newList'))}</button></div>`;
    return;
  }

  const items = state.items.filter((i) => i.listId === state.listId);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  ensureTranslations(items);

  const wish = isWish(list0);
  if (!items.length) {
    list.innerHTML = wish
      ? `<div class="empty"><div class="big">🎁</div><p>${esc(t('emptyWish'))}</p></div>`
      : `<div class="empty"><div class="big">🛒</div><p>${esc(t('emptyList'))}<br><span class="small">${esc(t('emptyListHint'))}</span></p></div>`;
    return;
  }

  let html = '';
  const byCreated = (a, b) => a.createdAt - b.createdAt;
  if (wish) {
    // 想買清單：按「幫邊個買」分組
    const people = [...new Set(todo.map((i) => i.forWho || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    for (const p of people) {
      const group = todo.filter((i) => (i.forWho || '') === p).sort(byCreated);
      html += `<h2 class="group-title">🙋 ${esc(p ? t('forWhoLabel', { name: p }) : t('anyone'))}</h2><ul class="items wish">${group.map(itemRow).join('')}</ul>`;
    }
  } else {
    for (const cat of CATEGORY_IDS) {
      const group = todo.filter((i) => catOf(i) === cat).sort(byCreated);
      if (!group.length) continue;
      html += `<h2 class="group-title">${esc(catLabel(cat))}</h2><ul class="items">${group.map(itemRow).join('')}</ul>`;
    }
  }
  if (!todo.length) html += `<div class="empty"><div class="big">🎉</div><p>${esc(t('allDone'))}</p></div>`;
  if (done.length) {
    html += `<div class="done-head"><h2 class="group-title">✅ ${esc(t('bought'))} (${done.length})</h2>
      <button class="link-btn danger" id="clear-done">${esc(t('clearBought'))}</button></div>
      <ul class="items">${done.map(itemRow).join('')}</ul>`;
  }
  list.innerHTML = html;
}

function itemRow(i) {
  const { text, original, auto } = displayName(i);
  const wish = isWish(state.lists.find((l) => l.id === i.listId));
  const meta = i.done
    ? `${esc(t('boughtBy', { name: i.doneBy || '' }))} · ${esc(timeAgo(i.doneAt))}`
    : [
        i.price && `<span class="price">${esc(i.price)}</span>`,
        i.note && esc(i.note),
        !wish && i.forWho && esc(`🙋 ${t('forWhoLabel', { name: i.forWho })}`),
        i.addedBy && esc(t('addedBy', { name: i.addedBy })),
      ]
        .filter(Boolean)
        .join(' · ');
  const link = safeUrl(i.link);
  return `<li class="item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    <button class="toggle" aria-pressed="${!!i.done}">
      <span class="check" aria-hidden="true">✓</span>
      <span class="body">
        <span class="name">${esc(text)}</span>${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ''}
        ${original ? `<div class="original" lang="${esc(i.lang || 'zh')}">${esc(original)}${auto ? ` <span class="auto">${esc(t('autoTranslated'))}</span>` : ''}</div>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </span>
    </button>
    ${link ? `<a class="icon-btn link-out" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('openLink'))}" title="${esc(t('openLink'))}">🔗</a>` : ''}
    ${
      i.thumb
        ? `<button class="thumb-btn" aria-label="${esc(t('viewPhotos'))}"><img class="thumb" src="${esc(i.thumb)}" alt="">${
            (i.photos?.length || 0) > 1 ? `<span class="thumb-count">${i.photos.length}</span>` : ''
          }</button>`
        : ''
    }
    <button class="icon-btn more" aria-label="${esc(t('editItem', { name: text }))}">⋯</button>
  </li>`;
}

// ---------- 動作 ----------

function onAdd(e) {
  e.preventDefault();
  const nameEl = $('#add-name');
  const qtyEl = $('#add-qty');
  let name = clean(nameEl.value, 500);
  const qty = clean(qtyEl.value, 12);
  if (!name || !state.listId) return;
  // 貼連結：用網站名做名稱，連結另外存
  let link = '';
  const url = name.match(/https?:\/\/\S+/i)?.[0];
  if (url) {
    link = url.slice(0, 500);
    const rest = clean(name.replace(url, ''), 60);
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {}
    name = rest || `🔗 ${host || t('link')}`;
  }
  name = name.slice(0, 60);

  const n = name.toLowerCase();
  const matches = (i) => i.name.toLowerCase() === n || Object.values(i.tr || {}).some((v) => String(v).toLowerCase() === n);
  const same = state.items.find((i) => i.listId === state.listId && matches(i));
  if (same && !same.done) {
    toast(t('alreadyOnList', { name }));
    if (qty && qty !== same.qty) state.store.updateItem(state.familyId, same.id, { qty }).catch(fail);
  } else if (same) {
    // 之前買過，放返入未買
    state.store.updateItem(state.familyId, same.id, { done: false, doneBy: null, qty: qty || same.qty, addedBy: state.me }).catch(fail);
  } else {
    state.store.addItem(state.familyId, newItem(name, { qty, link })).catch(fail);
  }
  if (!link) addHistory(name);
  fillHistory();
  nameEl.value = '';
  qtyEl.value = '';
  nameEl.focus();
}

function newItem(name, extra = {}) {
  const { lang, tr, category } = prepareItem(name, getLang());
  // 「🔗 網站名」唔使翻譯
  if (name.startsWith('🔗')) for (const l of ITEM_LANGS) tr[l] = name;
  return {
    listId: state.listId,
    name,
    lang,
    tr,
    trAuto: {},
    qty: '',
    note: '',
    category,
    addedBy: state.me,
    forWho: isWish(currentList()) ? state.me : '',
    price: '',
    link: '',
    photos: [],
    thumb: '',
    ...extra,
  };
}

// 將一張相變成 { id, thumb }：大相存入 photos，縮圖直接放喺貨品度（清單即刻見到、離線都得）
async function savePhoto(file) {
  const [full, thumb] = await Promise.all([compressImage(file, PHOTO_OPTS), compressImage(file, THUMB_OPTS)]);
  const { id, done } = state.store.addPhoto(state.familyId, full);
  done.catch(fail);
  return { id, thumb };
}

async function onAddPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !state.listId) return;
  const nameEl = $('#add-name');
  const qtyEl = $('#add-qty');
  const name = clean(nameEl.value, 60) || t('photoItemName');
  const qty = clean(qtyEl.value, 12);
  toast(t('processingPhoto'));
  try {
    const { id, thumb } = await savePhoto(file);
    state.store.addItem(state.familyId, newItem(name, { qty, photos: [id], thumb })).catch(fail);
    nameEl.value = '';
    qtyEl.value = '';
    $('#toast').classList.remove('show');
  } catch (err) {
    console.error(err);
    toast(t('photoFailed'));
  }
}

async function addPhotoToItem(item, file) {
  if ((item.photos?.length || 0) >= MAX_PHOTOS) return toast(t('maxPhotos', { n: MAX_PHOTOS }));
  toast(t('processingPhoto'));
  try {
    const { id, thumb } = await savePhoto(file);
    const photos = [...(item.photos || []), id];
    await state.store.updateItem(state.familyId, item.id, { photos, thumb: item.thumb || thumb }).catch(fail);
    $('#toast').classList.remove('show');
    return photos;
  } catch (err) {
    console.error(err);
    toast(t('photoFailed'));
  }
}

async function removePhoto(item, pid) {
  const photos = (item.photos || []).filter((p) => p !== pid);
  let thumb = item.thumb;
  if (item.photos?.[0] === pid) {
    // 第一張冇咗，用下一張整縮圖
    thumb = '';
    if (photos[0]) {
      const next = await state.store.getPhoto(state.familyId, photos[0]).catch(() => null);
      if (next) thumb = await compressImage(next, THUMB_OPTS).catch(() => '');
    }
  }
  state.store.updateItem(state.familyId, item.id, { photos, thumb }).catch(fail);
  state.store.deletePhotos(state.familyId, [pid]).catch(fail);
}

function openPhotos(item) {
  const latest = () => state.items.find((i) => i.id === item.id) || item;
  const draw = (d) => {
    const it = latest();
    const ids = it.photos || [];
    $('.photo-list', d).innerHTML = ids.length
      ? ids
          .map(
            (pid) => `<figure class="photo" data-pid="${esc(pid)}">
              <img alt="" ${pid === ids[0] && it.thumb ? `src="${esc(it.thumb)}"` : ''}>
              <button type="button" class="btn danger small-btn del-photo">🗑 ${esc(t('deletePhoto'))}</button>
            </figure>`,
          )
          .join('')
      : `<p class="muted center">—</p>`;
    $('#more-photo', d).disabled = ids.length >= MAX_PHOTOS;
    // 逐張載入大相
    for (const fig of d.querySelectorAll('.photo')) {
      const img = fig.querySelector('img');
      state.store
        .getPhoto(state.familyId, fig.dataset.pid)
        .then((src) => {
          if (src) img.src = src;
          else if (!img.getAttribute('src')) fig.insertAdjacentHTML('afterbegin', `<p class="small muted">${esc(t('photoUnavailable'))}</p>`);
        })
        .catch(() => {});
    }
  };
  openDialog(
    `<h2>📷 ${esc(displayName(item).text)}</h2>
    <div class="photo-list"></div>
    <div class="actions">
      <button type="button" class="btn" id="more-photo">＋ ${esc(t('addPhoto'))}</button>
      <input type="file" id="more-photo-input" accept="image/*" hidden>
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-close>${esc(t('close'))}</button>
    </div>`,
    (d) => {
      draw(d);
      $('#more-photo', d).onclick = () => $('#more-photo-input', d).click();
      $('#more-photo-input', d).onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const photos = await addPhotoToItem(latest(), file);
        if (photos) setTimeout(() => draw(d), 50);
      };
      $('.photo-list', d).onclick = async (e) => {
        const btn = e.target.closest('.del-photo');
        if (!btn) return;
        await removePhoto(latest(), btn.closest('.photo').dataset.pid);
        setTimeout(() => draw(d), 50);
      };
    },
  );
}

let recognition = null;

// 語音輸入：唔同瀏覽器認嘅語言代碼唔同（Chrome 用 yue-Hant-HK，iPhone Safari 用 zh-HK），唔認就試下一個
function startVoice() {
  const mic = $('#mic');
  if (recognition) {
    recognition.stop(); // 再撳一下 = 停
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let codes = [...langInfo().speech];
  if (isIOS && codes.includes('zh-HK')) codes = ['zh-HK', ...codes.filter((c) => c !== 'zh-HK')];

  const explain = (msg) =>
    openDialog(`<h2>🎤</h2><p>${esc(msg)}</p>
      <div class="actions"><span class="spacer"></span><button class="btn primary" data-close>${esc(t('close'))}</button></div>`);

  const attempt = (i) => {
    const rec = new SpeechRecognition();
    recognition = rec;
    let heard = false;
    let failed = false;
    rec.lang = codes[i];
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = clean(e.results[0]?.[0]?.transcript?.replace(/[。．.!！]$/, ''), 60);
      if (!text) return;
      heard = true;
      const input = $('#add-name');
      input.value = text;
      input.focus();
      toast(t('voiceHeard', { text }), { label: t('add'), run: () => $('#add-form').requestSubmit() });
    };
    rec.onerror = (e) => {
      const err = e.error;
      if (err === 'language-not-supported' && i + 1 < codes.length) {
        failed = 'retry'; // onend 再試下一個
        return;
      }
      failed = 'shown';
      if (err === 'aborted') return;
      if (err === 'not-allowed') explain(t('voiceDenied'));
      else if (err === 'service-not-allowed' || err === 'language-not-supported') explain(t('voiceUnavailable'));
      else if (err === 'no-speech') toast(t('voiceNoSpeech'));
      else if (err === 'audio-capture') toast(t('voiceNoMic'));
      else if (err === 'network') toast(t('voiceNetwork'));
      else toast(t('voiceFailed'));
      console.warn('speech error', err);
    };
    rec.onend = () => {
      recognition = null;
      if (failed === 'retry') return attempt(i + 1);
      mic?.classList.remove('listening');
      if (!heard && !failed) toast(t('voiceNoSpeech'));
    };
    try {
      rec.start();
      mic?.classList.add('listening');
      if (i === 0) toast(t('listening'));
    } catch (err) {
      console.warn('speech start failed', err);
      recognition = null;
      mic?.classList.remove('listening');
      explain(t('voiceUnavailable'));
    }
  };
  attempt(0);
}

function toggleItem(item) {
  const done = !item.done;
  state.store.updateItem(state.familyId, item.id, { done, doneBy: done ? state.me : null }).catch(fail);
  if (navigator.vibrate) navigator.vibrate(10);
}

function deleteItem(item) {
  state.store.deleteItem(state.familyId, item.id).catch(fail);
  // 相片等「復原」時限過咗先刪
  let undone = false;
  if (item.photos?.length) setTimeout(() => undone || state.store.deletePhotos(state.familyId, item.photos).catch(fail), 6000);
  toast(t('deleted', { name: displayName(item).text }), {
    label: t('undo'),
    run: () => {
      undone = true;
      const { id, createdAt, doneAt, done, doneBy, ...rest } = item;
      state.store.addItem(state.familyId, rest).catch(fail);
    },
  });
}

function clearDone() {
  const n = state.items.filter((i) => i.listId === state.listId && i.done).length;
  confirmDialog(t('clearConfirm', { n }), t('clear'), () => state.store.clearDone(state.familyId, state.listId).catch(fail));
}

// ---------- 對話框 ----------

function openEditItem(item) {
  const src = item.lang || 'zh';
  const others = ITEM_LANGS.filter((l) => l !== src);
  openDialog(
    `<form id="edit-form">
      <h2>${esc(t('edit'))}</h2>
      <label class="field"><span>${esc(t('name'))} · ${esc(langInfo(src).label)}</span><input class="input" name="name" maxlength="60" required value="${esc(item.name)}" lang="${esc(src)}"></label>
      <div class="row">
        <label class="field"><span>${esc(t('qty'))}</span><input class="input" name="qty" maxlength="12" value="${esc(item.qty)}"></label>
        <label class="field"><span>${esc(t('list'))}</span><select class="input" name="listId">${state.lists
          .map((l) => `<option value="${esc(l.id)}" ${l.id === item.listId ? 'selected' : ''}>${esc(listLabel(l))}</option>`)
          .join('')}</select></label>
      </div>
      <label class="field"><span>${esc(t('note'))}</span><input class="input" name="note" maxlength="100" value="${esc(item.note)}"></label>
      <details class="more-details" ${isWish(currentList()) || item.forWho || item.price || item.link || item.photos?.length ? 'open' : ''}>
        <summary>📷 ${esc(t('moreDetails'))}</summary>
        <div class="field"><span>${esc(t('addPhoto'))}</span>
          <div class="photo-row">
            ${item.thumb ? `<button type="button" class="thumb-btn" id="edit-view-photos"><img class="thumb" src="${esc(item.thumb)}" alt=""></button>` : ''}
            <button type="button" class="btn" id="edit-photos">${esc(item.photos?.length ? `${t('viewPhotos')} (${t('photosCount', { n: item.photos.length })})` : `＋ ${t('addPhoto')}`)}</button>
          </div>
        </div>
        <div class="row">
          <label class="field"><span>${esc(t('forWho'))}</span><input class="input" name="forWho" maxlength="20" value="${esc(item.forWho)}" list="people"></label>
          <label class="field"><span>${esc(t('price'))}</span><input class="input" name="price" maxlength="20" placeholder="${esc(t('pricePlaceholder'))}" value="${esc(item.price)}"></label>
        </div>
        <datalist id="people">${[...new Set(state.items.flatMap((i) => [i.addedBy, i.forWho]).filter(Boolean))]
          .map((p) => `<option value="${esc(p)}"></option>`)
          .join('')}</datalist>
        <label class="field"><span>${esc(t('link'))}</span><input class="input" name="link" type="url" inputmode="url" maxlength="500" placeholder="https://" value="${esc(item.link)}"></label>
      </details>
      <div class="field"><span>🌐 ${esc(t('translations'))}</span>
        ${others
          .map(
            (l) =>
              `<label class="tr-row"><span class="tr-lang">${esc(langInfo(l).label)}</span><input class="input" name="tr-${l}" maxlength="60" lang="${l}" value="${esc(item.tr?.[l] || '')}"></label>`,
          )
          .join('')}
        <span class="small muted">${esc(t('translationHint'))}</span>
      </div>
      <div class="field"><span>${esc(t('category'))}</span><div class="cats">${CATEGORY_IDS.map(
        (c) => `<label><input type="radio" name="category" value="${c}" ${catOf(item) === c ? 'checked' : ''}><span>${esc(catLabel(c))}</span></label>`,
      ).join('')}</div></div>
      <p class="small muted">${esc(item.addedBy ? t('addedBy', { name: item.addedBy }) : '')} ${item.createdAt ? `· ${esc(timeAgo(item.createdAt))}` : ''}</p>
      <div class="actions">
        <button type="button" class="btn danger" id="del">${esc(t('delete'))}</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (d) => {
      $('#del', d).onclick = () => {
        d.close();
        deleteItem(item);
      };
      const toPhotos = () => openPhotos(item);
      $('#edit-photos', d).onclick = toPhotos;
      $('#edit-view-photos', d)?.addEventListener('click', toPhotos);
      $('#edit-form', d).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = clean(f.get('name'), 60);
        if (!name) return;
        const nameChanged = name !== item.name;
        const category = f.get('category') || 'other';
        const tr = { [src]: name };
        const trAuto = {};
        let manual = false;
        for (const l of others) {
          const v = clean(f.get(`tr-${l}`), 60);
          const before = item.tr?.[l] || '';
          if (v && v !== before) {
            tr[l] = v;
            trAuto[l] = false;
            manual = true;
          } else if (v && !nameChanged) {
            tr[l] = v;
            trAuto[l] = !!item.trAuto?.[l];
          } else if (nameChanged) {
            // 改咗名但冇改翻譯：由字典再攞，攞唔到就等背景重新翻譯
            const entry = lookup(name);
            if (entry?.[l]) tr[l] = entry[l];
          }
        }
        state.store
          .updateItem(state.familyId, item.id, {
            name,
            tr,
            trAuto,
            qty: clean(f.get('qty'), 12),
            note: clean(f.get('note'), 100),
            forWho: clean(f.get('forWho'), 20),
            price: clean(f.get('price'), 20),
            link: safeUrl(clean(f.get('link'), 500)),
            category,
            listId: f.get('listId') || item.listId,
          })
          .catch(fail);
        // 屋企人親手改過嘅翻譯 / 分類，記入家庭字典，下次自動用
        if (manual || category !== item.category) {
          const entry = { cat: category };
          for (const l of ITEM_LANGS) if (tr[l]) entry[l] = tr[l];
          state.store.saveDictEntry(state.familyId, name, entry).catch(fail);
        }
        translating.clear();
        d.close();
      };
    },
  );
}

function kindPicker(kind) {
  return `<div class="field"><span>${esc(t('listKind'))}</span>
    <div class="segmented">${['shop', 'wish']
      .map((k) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${esc(t(k === 'wish' ? 'kindWish' : 'kindShop'))}</span></label>`)
      .join('')}</div>
    <span class="small muted">${esc(t('kindWishHint'))}</span>
  </div>`;
}

function openNewList() {
  openDialog(
    `<form id="list-form">
      <h2>${esc(t('newList'))}</h2>
      <label class="field"><span>${esc(t('name'))}</span><input class="input" name="name" maxlength="30" required placeholder="${esc(t('newListPlaceholder'))}"></label>
      ${kindPicker('shop')}
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('create2'))}</button>
      </div>
    </form>`,
    (d) => {
      $('#list-form', d).onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = clean(f.get('name'), 30);
        if (!name) return;
        d.close();
        try {
          selectList(await state.store.addList(state.familyId, name, f.get('kind') === 'wish' ? 'wish' : 'shop'));
        } catch (err) {
          fail(err);
        }
      };
    },
  );
}

function inviteLink() {
  return `${location.origin}${location.pathname}?f=${state.familyId}`;
}

async function share(text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title: t('appName'), text, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('copied'));
  } catch {
    toast(t('copyFailed'));
  }
}

function openInvite() {
  const local = state.store.mode === 'local';
  openDialog(
    `<h2>${esc(t('invite'))}</h2>
    ${local ? `<div class="demo-note">${esc(t('inviteDemo'))}</div>` : `<p class="small">${esc(t('inviteText'))}</p>`}
    <div class="code">${esc(inviteLink())}</div>
    <p class="small muted">${esc(t('inviteCode'))} <b>${esc(state.familyId)}</b></p>
    <p class="small muted">${esc(t('homeScreenTip'))}</p>
    <div class="actions"><span class="spacer"></span>
      <button class="btn" data-close>${esc(t('close'))}</button>
      <button class="btn primary" id="share">${esc(t('shareLink'))}</button>
    </div>`,
    (d) => {
      $('#share', d).onclick = () => share(t('shareMessage', { name: state.family?.name || t('appName') }), inviteLink());
    },
  );
}

function openSettings() {
  const list = state.lists.find((l) => l.id === state.listId);
  const size = document.documentElement.dataset.size || 'normal';
  openDialog(
    `<form id="settings-form">
      <h2>${esc(t('settings'))}</h2>
      <div class="field"><span>🌐 ${esc(t('language'))}</span>${langPicker('lang')}</div>
      <div class="field"><span>🔠 ${esc(t('textSize'))}</span>
        <div class="segmented">${[
          ['normal', t('sizeNormal')],
          ['large', t('sizeLarge')],
          ['xlarge', t('sizeXLarge')],
        ]
          .map(([v, label]) => `<label><input type="radio" name="size" value="${v}" ${v === size ? 'checked' : ''}><span>${esc(label)}</span></label>`)
          .join('')}</div>
      </div>
      <label class="field"><span>${esc(t('yourNameShort'))}</span><input class="input" name="me" maxlength="20" required value="${esc(state.me)}"></label>
      <label class="field"><span>${esc(t('familyName'))}</span><input class="input" name="family" maxlength="30" required value="${esc(state.family?.name || '')}"></label>
      ${
        list
          ? `<label class="field"><span>${esc(t('currentListName'))}</span><input class="input" name="list" maxlength="30" required value="${esc(list.name)}"></label>
             ${kindPicker(isWish(list) ? 'wish' : 'shop')}`
          : ''
      }
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>

      <div class="section-title">${esc(t('familyCode'))}</div>
      <div class="code">${esc(state.familyId)}</div>

      <div class="section-title">${esc(t('other'))}</div>
      <div class="row wrap">
        ${list ? `<button type="button" class="btn danger" id="del-list">${esc(t('deleteListNamed', { name: list.name }))}</button>` : ''}
        <button type="button" class="btn danger" id="leave">${esc(t('leaveFamily'))}</button>
      </div>
      <p class="small muted">${esc(state.store.mode === 'local' ? t('modeLocal') : t('modeFirebase'))}</p>
    </form>`,
    (d) => {
      // 字體大細即時預覽
      d.querySelectorAll('input[name="size"]').forEach((r) => r.addEventListener('change', () => applyTextSize(r.value, false)));
      d.addEventListener('close', () => applyTextSize(ls.get('fsl-size') || 'normal', false), { once: true });

      $('#settings-form', d).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const me = clean(f.get('me'), 20);
        const fam = clean(f.get('family'), 30);
        const ln = clean(f.get('list'), 30);
        const lang = f.get('lang');
        applyTextSize(f.get('size') || 'normal');
        if (me) rememberName(me);
        if (fam && fam !== state.family?.name) state.store.renameFamily(state.familyId, fam).catch(fail);
        const kind = f.get('kind') === 'wish' ? 'wish' : 'shop';
        const listPatch = {};
        if (list && ln && ln !== list.name) listPatch.name = ln;
        if (list && kind !== (isWish(list) ? 'wish' : 'shop')) listPatch.kind = kind;
        if (list && Object.keys(listPatch).length) state.store.updateList(state.familyId, list.id, listPatch).catch(fail);
        d.close();
        if (lang && lang !== getLang()) {
          changeLang(lang);
          renderShell();
          render();
          refreshPushToken();
        }
        toast(t('saved'));
      };
      $('#del-list', d)?.addEventListener('click', () => {
        const n = state.items.filter((i) => i.listId === list.id).length;
        confirmDialog(t('deleteListConfirm', { name: list.name, n }), t('delete'), () => state.store.deleteList(state.familyId, list.id).catch(fail));
      });
      $('#leave', d).onclick = () => confirmDialog(t('leaveConfirm'), t('leave'), leaveFamily);
    },
  );
}

boot();
