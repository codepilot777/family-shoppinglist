import { createStore } from './store.js';
import { t, initLang, setLang, getLang, langInfo, LANGS, CATEGORY_IDS, CATEGORY_ICONS } from './i18n.js';
import { ITEM_LANGS, prepareItem, translateTo, setFamilyDictionary, lookup } from './translate.js';

// ---------- 小工具 ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};
const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const catOf = (item) => (CATEGORY_IDS.includes(item.category) ? item.category : 'other');
const catLabel = (id) => `${CATEGORY_ICONS[id]} ${t(`cat_${id}`)}`;
// 清單名如果係常見地方（超市、街市…）就跟語言顯示
const listLabel = (l) => lookup(l.name)?.[getLang()] || l.name;

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action)
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}

function fail(err) {
  console.error(err);
  const msg = err?.code === 'permission-denied' ? t('permissionDenied') : err?.message || String(err);
  toast(t('errorPrefix', { msg }));
}

function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('hoursAgo', { n: Math.floor(s / 3600) });
  return t('daysAgo', { n: Math.floor(s / 86400) });
}

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
  if (invite) window.history.replaceState(null, '', location.pathname);

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
  ];
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
      <button class="icon-btn" id="invite-btn" aria-label="${esc(t('invite'))}" title="${esc(t('invite'))}">👪</button>
      <button class="icon-btn" id="settings-btn" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">⚙️</button>
    </header>
    <nav class="tabs" id="tabs" role="tablist" aria-label="${esc(t('lists'))}"></nav>
    <main id="list"></main>
    <div class="addbar">
      <form id="add-form" autocomplete="off">
        ${SpeechRecognition ? `<button type="button" class="btn mic" id="mic" aria-label="${esc(t('voice'))}" title="${esc(t('voice'))}">🎤</button>` : ''}
        <input class="input name-input" id="add-name" maxlength="60" placeholder="${esc(t('addPlaceholder'))}" list="history" enterkeyhint="done" aria-label="${esc(t('itemName'))}">
        <input class="input qty-input" id="add-qty" maxlength="12" placeholder="${esc(t('qty'))}" aria-label="${esc(t('qty'))}">
        <button class="btn primary">${esc(t('add'))}</button>
      </form>
      <datalist id="history"></datalist>
    </div>`;

  renderTitle();
  $('#invite-btn').onclick = openInvite;
  $('#settings-btn').onclick = openSettings;
  $('#add-form').onsubmit = onAdd;
  $('#mic')?.addEventListener('click', startVoice);
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
    else toggleItem(item);
  };
}

function fillHistory() {
  $('#history').innerHTML = pastNames()
    .map((h) => `<option value="${esc(h)}"></option>`)
    .join('');
}

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
          `<button class="tab" role="tab" data-list="${esc(l.id)}" aria-selected="${l.id === state.listId}">${esc(listLabel(l))}${
            pending(l.id) ? `<span class="count">${pending(l.id)}</span>` : ''
          }</button>`,
      )
      .join('') + `<button class="tab add" id="add-list" aria-label="${esc(t('newList'))}">${esc(t('newListTab'))}</button>`;

  $('#add-form')?.classList.toggle('hidden', !state.listId);

  if (!state.listId) {
    list.innerHTML = `<div class="empty"><div class="big">🗒️</div><p>${esc(t('noLists'))}</p>
      <button class="btn primary" id="empty-add-list">${esc(t('newList'))}</button></div>`;
    return;
  }

  const items = state.items.filter((i) => i.listId === state.listId);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  ensureTranslations(items);

  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="big">🛒</div><p>${esc(t('emptyList'))}<br><span class="small">${esc(t('emptyListHint'))}</span></p></div>`;
    return;
  }

  let html = '';
  for (const cat of CATEGORY_IDS) {
    const group = todo.filter((i) => catOf(i) === cat).sort((a, b) => a.createdAt - b.createdAt);
    if (!group.length) continue;
    html += `<h2 class="group-title">${esc(catLabel(cat))}</h2><ul class="items">${group.map(itemRow).join('')}</ul>`;
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
  const meta = i.done
    ? `${esc(t('boughtBy', { name: i.doneBy || '' }))} · ${esc(timeAgo(i.doneAt))}`
    : [i.note && esc(i.note), i.addedBy && esc(t('addedBy', { name: i.addedBy }))].filter(Boolean).join(' · ');
  return `<li class="item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    <button class="toggle" aria-pressed="${!!i.done}">
      <span class="check" aria-hidden="true">✓</span>
      <span class="body">
        <span class="name">${esc(text)}</span>${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ''}
        ${original ? `<div class="original" lang="${esc(i.lang || 'zh')}">${esc(original)}${auto ? ` <span class="auto">${esc(t('autoTranslated'))}</span>` : ''}</div>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </span>
    </button>
    <button class="icon-btn more" aria-label="${esc(t('editItem', { name: text }))}">⋯</button>
  </li>`;
}

// ---------- 動作 ----------

function onAdd(e) {
  e.preventDefault();
  const nameEl = $('#add-name');
  const qtyEl = $('#add-qty');
  const name = clean(nameEl.value, 60);
  const qty = clean(qtyEl.value, 12);
  if (!name || !state.listId) return;

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
    const { lang, tr, category } = prepareItem(name, getLang());
    state.store
      .addItem(state.familyId, { listId: state.listId, name, lang, tr, trAuto: {}, qty, note: '', category, addedBy: state.me })
      .catch(fail);
  }
  addHistory(name);
  fillHistory();
  nameEl.value = '';
  qtyEl.value = '';
  nameEl.focus();
}

function startVoice() {
  const rec = new SpeechRecognition();
  const mic = $('#mic');
  rec.lang = langInfo().speech;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const text = clean(e.results[0]?.[0]?.transcript?.replace(/[。．.!！]$/, ''), 60);
    if (!text) return;
    $('#add-name').value = text;
    $('#add-name').focus();
  };
  rec.onerror = () => toast(t('voiceFailed'));
  rec.onend = () => mic?.classList.remove('listening');
  mic?.classList.add('listening');
  toast(t('listening'));
  try {
    rec.start();
  } catch {
    mic?.classList.remove('listening');
  }
}

function toggleItem(item) {
  const done = !item.done;
  state.store.updateItem(state.familyId, item.id, { done, doneBy: done ? state.me : null }).catch(fail);
  if (navigator.vibrate) navigator.vibrate(10);
}

function deleteItem(item) {
  state.store.deleteItem(state.familyId, item.id).catch(fail);
  toast(t('deleted', { name: displayName(item).text }), {
    label: t('undo'),
    run: () => {
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

const dialog = $('#dialog');
function openDialog(html, setup) {
  if (dialog.open) dialog.close();
  dialog.innerHTML = html;
  setup?.(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dialog.close()));
}
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

function confirmDialog(message, okLabel, onOk) {
  openDialog(
    `<h2>${esc(message)}</h2>
    <div class="actions"><span class="spacer"></span>
      <button class="btn" data-close>${esc(t('cancel'))}</button>
      <button class="btn primary" id="ok">${esc(okLabel)}</button>
    </div>`,
    (d) => {
      $('#ok', d).onclick = () => {
        d.close();
        onOk();
      };
    },
  );
}

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

function openNewList() {
  openDialog(
    `<form id="list-form">
      <h2>${esc(t('newList'))}</h2>
      <label class="field"><span>${esc(t('name'))}</span><input class="input" name="name" maxlength="30" required placeholder="${esc(t('newListPlaceholder'))}"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('create2'))}</button>
      </div>
    </form>`,
    (d) => {
      $('#list-form', d).onsubmit = async (e) => {
        e.preventDefault();
        const name = clean(new FormData(e.target).get('name'), 30);
        if (!name) return;
        d.close();
        try {
          selectList(await state.store.addList(state.familyId, name));
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
          ? `<label class="field"><span>${esc(t('currentListName'))}</span><input class="input" name="list" maxlength="30" required value="${esc(list.name)}"></label>`
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
        if (list && ln && ln !== list.name) state.store.renameList(state.familyId, list.id, ln).catch(fail);
        d.close();
        if (lang && lang !== getLang()) {
          changeLang(lang);
          renderShell();
          render();
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
