import { createStore } from './store.js';
import { canInstall, openInstall, onInstallChange, isIOS } from './install.js';
import { openDevices, deviceLabel, familyCode, parseFamilyCode } from './devices-view.js';
import { watchForUpdates } from './update.js';
import { initWallet, walletOnEnterFamily, renderWallet, openExpense, snapReceipts } from './wallet-view.js';
import { initChores, choresOnEnterFamily, renderChores } from './chores-view.js';
import { initDues, duesOnEnterFamily, renderDues } from './dues-view.js';
import { initCalendar, calendarOnEnterFamily, openCalendar } from './calendar-view.js';
import { initRoster } from './roster-view.js';
import { topFrequent, freqKey } from './freq.js';
import { t, initLang, setLang, getLang, langInfo, LANGS, CATEGORY_IDS, CATEGORY_ICONS } from './i18n.js';
import { ITEM_LANGS, prepareItem, translateTo, setFamilyDictionary, lookup } from './translate.js';
import { compressImage, PHOTO_OPTS, THUMB_OPTS, MAX_PHOTOS } from './image.js';
import { $, esc, ls, clean, toast, fail, timeAgo, openDialog, closeDialog, confirmDialog } from './ui.js';
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
  dataUnsubs: [], // 跟權限開嘅資料訂閱（權限改咗會重開）
  access: null, // { admin, hasAdmin, legacy, tabs }
  accessSig: '',
  freq: [],
};

initLang(ls.get('fsl-lang'));
applyTextSize(ls.get('fsl-size') || 'normal');

function rememberName(name) {
  state.me = name;
  ls.set('fsl-name', name);
}

// 🏠 呢部機加入咗嘅家庭（可以幾個，例如叔叔自己屋企同返嚟食飯嘅屋企）：[{ id, name }]
function knownFamilies() {
  try {
    const list = JSON.parse(ls.get('fsl-families'));
    return Array.isArray(list) ? list.filter((f) => f && typeof f.id === 'string' && f.id) : [];
  } catch {
    return [];
  }
}
const saveFamilies = (list) => ls.set('fsl-families', JSON.stringify(list));
function rememberFamily(fid, name) {
  const list = knownFamilies();
  const f = list.find((x) => x.id === fid);
  if (!f) saveFamilies([...list, { id: fid, name: name || '' }]);
  else if (name && f.name !== name) {
    f.name = name;
    saveFamilies(list);
  }
}
const forgetFamily = (fid) => saveFamilies(knownFamilies().filter((f) => f.id !== fid));
if (state.familyId) rememberFamily(state.familyId); // 舊版只記一個家庭

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
    navigator.serviceWorker.register('sw.js').then(watchForUpdates).catch(() => {});
  }

  const params = new URLSearchParams(location.search);
  const invite = clean(params.get('f'), 40).toLowerCase();
  const inviteKey = clean(params.get('k'), 40).toLowerCase();
  if (VIEWS.some(([v]) => v === params.get('view'))) ls.set('fsl-view', params.get('view'));
  if (location.search) window.history.replaceState(null, '', location.pathname);
  initDinner({ state });
  initWallet({ state });
  initChores({ state });
  initDues({ state });
  initRoster({ state });
  initCalendar({ state, visibleViews: () => visibleViews(), go: (view) => showView(view) });

  try {
    state.store = await createStore();
  } catch (err) {
    console.error(err);
    renderFatal(err);
    return;
  }

  // 通知 / 連結指定家庭（呢部機有加入先得）
  const famParam = clean(params.get('fam'), 40);
  const known = (fid) => knownFamilies().some((f) => f.id === fid) && (ls.get(codeKey(fid)) || state.store.mode === 'local');
  if (famParam && famParam !== state.familyId && known(famParam)) {
    state.familyId = famParam;
    ls.set('fsl-family', famParam);
  }
  if (invite && invite !== state.familyId) {
    if (state.me && known(invite)) {
      state.familyId = invite;
      ls.set('fsl-family', invite);
    } else return renderSetup({ invite, inviteKey, back: state.familyId });
  }
  if (!state.me || !state.familyId) return renderSetup({});
  enterFamily(state.familyId);
  handleDinnerParams(params);
  // 通知連結：?cal=YYYY-MM-DD 開日曆
  const calDate = params.get('cal');
  if (calDate && /^\d{4}-\d{2}-\d{2}$/.test(calDate)) openCalendar(calDate);
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

// ---------- 加入 / 登記呢部機 ----------

const codeKey = (fid) => `fsl-code-${fid}`;
const deviceInfo = () => ({ name: state.me, label: deviceLabel() });

// 用邀請代碼登記呢部機；代碼唔啱會 throw
async function registerThisDevice(fid, key) {
  const code = key || fid; // 舊式家庭：代碼就係家庭 ID
  try {
    await state.store.registerDevice(fid, code, deviceInfo());
  } catch (err) {
    if (err?.code !== 'permission-denied') throw err;
    // Firestore rules 未更新（未有 devices）或者舊式家庭：讀得到就照入
    const fam = await state.store.getFamily(fid).catch(() => null);
    if (!fam || fam.joinCode) throw err;
  }
  ls.set(codeKey(fid), code);
}

// 已經入咗嘅家庭：每次開 app 更新「最後使用」（舊式家庭會喺呢度自動登記）
function touchDevice(fid) {
  state.store.registerDevice(fid, ls.get(codeKey(fid)) || fid, deviceInfo()).catch(() => {});
}

// 部機被移除或者代碼換咗：返去加入畫面
let accessLostShown = false;
function onListenError(err) {
  if (err?.code !== 'permission-denied' || !state.familyId) return fail(err);
  if (accessLostShown) return;
  accessLostShown = true;
  const fid = state.familyId;
  const name = state.family?.name || '';
  resetFamily();
  afterFamilyGone(fid);
  openDialog(`<h2>🔒</h2>${name ? `<p><b>${esc(name)}</b></p>` : ''}<p>${esc(t('accessLost'))}</p>
    <div class="actions"><span class="spacer"></span><button class="btn primary" data-close>${esc(t('close'))}</button></div>`);
}

// ---------- 設定畫面（建立 / 加入家庭） ----------

// back = 本來睇緊嘅家庭（加入另一個家庭途中可以返去）
async function renderSetup({ invite, inviteKey, back } = {}) {
  back = back && knownFamilies().some((f) => f.id === back) ? back : null;
  const app = $('#app');
  app.className = '';
  document.title = t('appName');
  let inviteFamily = null;
  if (invite) {
    // 未登記嘅機通常讀唔到家庭名（已經鎖好），就顯示一般嘅「加入屋企」
    inviteFamily = await state.store.getFamily(invite).catch(() => null);
  }
  // 保留已經打咗嘅名（例如切換語言嘅時候）
  const typedName = $('#me')?.value;
  const inviteUrl = invite ? `${location.origin}${location.pathname}?f=${invite}${inviteKey ? `&k=${inviteKey}` : ''}` : '';

  const backName = back ? knownFamilies().find((f) => f.id === back)?.name || t('unnamedFamily') : '';
  app.innerHTML = `<div class="setup">
    ${back ? `<button type="button" class="btn setup-back" id="setup-back">${esc(t('backToFamily', { name: backName }))}</button>` : ''}
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
        ? `<div class="card">
            <h2>${esc(inviteFamily ? t('joinFamilyNamed', { name: inviteFamily.name }) : t('joinFamilyGeneric'))}</h2>
            <button class="btn primary block" id="join-invite">${esc(t('join'))}</button>
          </div>
          <p class="or"><button class="link-btn" id="skip-invite">${esc(t('skipInvite'))}</button></p>`
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
              <input class="input" id="code" maxlength="300" autocapitalize="off" autocomplete="off" spellcheck="false">
            </label>
            <button class="btn block" id="join">${esc(t('join'))}</button>
          </div>`
    }
  </div>`;

  app.querySelectorAll('input[name="setup-lang"]').forEach((r) =>
    r.addEventListener('change', () => {
      changeLang(r.value);
      renderSetup({ invite, inviteKey, back });
    }),
  );
  $('#setup-back')?.addEventListener('click', () => joinFamily(back));

  $('#setup-install')?.addEventListener('click', () => openInstall({ inviteLink: inviteUrl, familyId: invite ? familyCode(invite, inviteKey) : '' }));

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

  const join = async (btn, fid, key) => {
    busy(btn, true);
    try {
      await registerThisDevice(fid, key);
      joinFamily(fid);
    } catch (err) {
      console.warn(err);
      toast(err?.code === 'permission-denied' ? t('inviteInvalid') : t('errorPrefix', { msg: err?.message || err }));
      busy(btn, false);
    }
  };

  $('#skip-invite')?.addEventListener('click', () => renderSetup({ back }));

  $('#join-invite')?.addEventListener('click', (e) => {
    if (!needName()) return;
    join(e.target, invite, inviteKey);
  });

  $('#create')?.addEventListener('click', async (e) => {
    if (!needName()) return;
    const familyName = clean($('#family-name').value, 30) || t('defaultFamilyName');
    busy(e.target, true);
    try {
      const { fid, joinCode } = await state.store.createFamily(familyName, t('defaultListName'), deviceInfo());
      ls.set(codeKey(fid), joinCode || fid);
      joinFamily(fid);
      setTimeout(openInvite, 400);
    } catch (err) {
      fail(err);
      busy(e.target, false);
    }
  });

  $('#join')?.addEventListener('click', (e) => {
    if (!needName()) return;
    const { fid, key } = parseFamilyCode($('#code').value);
    if (!fid) return toast(t('needCode'));
    join(e.target, fid, key);
  });
}

function joinFamily(fid) {
  if (state.familyId && state.familyId !== fid) resetFamily();
  state.familyId = fid;
  accessLostShown = false;
  ls.set('fsl-family', fid);
  rememberFamily(fid);
  enterFamily(fid);
}

// 🏠 轉去另一個已加入嘅家庭：清走而家嘅畫面同訂閱先入
function switchFamily(fid) {
  if (fid === state.familyId) return;
  closeDialog();
  resetFamily();
  const app = $('#app');
  app.className = 'loading';
  app.innerHTML = '';
  joinFamily(fid);
}

// 加入 / 開另一個家庭（完成之後兩個都記住）
function addAnotherFamily() {
  const back = state.familyId;
  closeDialog();
  resetFamily();
  renderSetup({ back });
}

function openFamilies() {
  const list = knownFamilies();
  openDialog(
    `<h2>🏠 ${esc(t('switchFamily'))}</h2>
    <p class="small muted">${esc(t('familiesHint'))}</p>
    <ul class="items family-list">${list
      .map(
        (f) => `<li class="item"><button class="toggle" data-fam="${esc(f.id)}" aria-current="${f.id === state.familyId}">
          <span class="body"><span class="name">${esc(f.id === state.familyId ? state.family?.name || f.name : f.name || t('unnamedFamily'))}</span></span>
          <span class="more" aria-hidden="true">${f.id === state.familyId ? '✓' : '›'}</span></button></li>`,
      )
      .join('')}</ul>
    <button type="button" class="btn block" id="add-family">${esc(t('addFamily'))}</button>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn primary" data-close>${esc(t('close'))}</button></div>`,
    (dlg) => {
      dlg.querySelectorAll('[data-fam]').forEach((b) => (b.onclick = () => switchFamily(b.dataset.fam)));
      $('#add-family', dlg).onclick = addAnotherFamily;
    },
  );
}

// 離開 / 被移除之後：仲有其他家庭就轉過去，冇就返去開始畫面
function afterFamilyGone(fid) {
  forgetFamily(fid);
  ls.set(codeKey(fid), null);
  const next = knownFamilies()[0];
  if (next) {
    const app = $('#app');
    app.className = 'loading';
    app.innerHTML = '';
    joinFamily(next.id);
  } else renderSetup({});
}

function resetFamily() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.dataUnsubs.forEach((u) => u());
  state.dataUnsubs = [];
  state.access = null;
  state.accessSig = '';
  state.familyId = null;
  state.family = null;
  state.lists = [];
  state.items = [];
  state.freq = [];
  setFamilyDictionary([]);
  ls.set('fsl-family', null);
}

function leaveFamily() {
  const fid = state.familyId;
  // 自己離開：刪走呢部機嘅登記（之後要邀請連結先入返）
  if (fid) state.store.removeDevice(fid, state.store.uid).catch(() => {});
  resetFamily();
  if (fid) afterFamilyGone(fid);
  else renderSetup({});
}

// ---------- 主畫面 ----------

// 👑 權限：舊式家庭 / 未有管理員 / 示範模式 → 用晒；管理員 → 用晒；屋企人 → 管理員畀佢嘅分頁
const ALL_TABS = ['shop', 'dinner', 'chores', 'dues', 'wallet'];
const DEFAULT_TABS = ['shop', 'dinner'];
function computeAccess(fam, dev) {
  const legacy = !fam?.joinCode;
  const hasAdmin = !!fam?.hasAdmin;
  if (state.store.mode === 'local' || legacy || !hasAdmin) return { admin: false, hasAdmin, legacy, tabs: ALL_TABS };
  const admin = dev?.role === 'admin';
  const granted = Array.isArray(dev?.tabs) ? dev.tabs : DEFAULT_TABS;
  return { admin, hasAdmin, legacy, tabs: admin ? ALL_TABS : ALL_TABS.filter((tab) => granted.includes(tab)) };
}
const canTab = (tab) => !!state.access?.tabs.includes(tab);

function enterFamily(fid) {
  state.unsubs.forEach((u) => u());
  state.dataUnsubs.forEach((u) => u());
  state.dataUnsubs = [];
  state.access = null;
  state.accessSig = '';
  state.listId = ls.get(`fsl-list-${fid}`);

  const s = state.store;
  touchDevice(fid);
  let registered = false;
  let fam; // undefined = 未知
  let dev;
  // 家庭同呢部機嘅登記都知道咗先開畫面；之後權限有變就即刻換
  const update = () => {
    if (fam === undefined || dev === undefined) return;
    const access = computeAccess(fam, dev);
    const sig = JSON.stringify(access);
    if (sig === state.accessSig) return;
    state.access = access;
    state.accessSig = sig;
    startData(fid);
  };
  state.unsubs = [
    s.subscribeFamily(
      fid,
      (f) => {
        state.family = f;
        fam = f;
        if (f?.name) rememberFamily(fid, f.name);
        renderTitle();
        renderDinner(); // 買餸日設定喺 family doc
        renderWallet(); // 低餘額提醒設定都喺 family doc
        update();
      },
      onListenError,
    ),
    // 呢部機嘅登記被刪咗（已鎖好嘅家庭）→ 即刻退出；權限改咗 → 重開畫面
    s.subscribeOwnDevice(
      fid,
      (d) => {
        if (d) registered = true;
        else if (registered && state.family?.joinCode) return onListenError({ code: 'permission-denied' });
        dev = d;
        update();
      },
      onListenError,
    ),
  ];
}

// 淨係訂閱有權限嘅資料（冇權限嘅 Firestore 會拒絕）
function startData(fid) {
  const s = state.store;
  state.dataUnsubs.forEach((u) => u());
  renderShell();
  const subs = [
    s.subscribeDict(fid, (entries) => {
      setFamilyDictionary(entries);
      render();
    }),
    ...dinnerOnEnterFamily(fid, { dinner: canTab('dinner') }),
    ...calendarOnEnterFamily(fid),
  ];
  if (canTab('shop')) {
    subs.push(
      s.subscribeLists(
        fid,
        (lists) => {
          state.lists = lists.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          if (!state.lists.some((l) => l.id === state.listId)) selectList(state.lists[0]?.id || null, false);
          render();
        },
        onListenError,
      ),
      s.subscribeItems(
        fid,
        (items) => {
          state.items = items;
          render();
        },
        onListenError,
      ),
      s.subscribeFreq(
        fid,
        (docs) => {
          state.freq = docs;
          render();
        },
        (err) => console.warn('freq', err),
      ),
    );
  } else {
    state.lists = [];
    state.items = [];
    state.freq = [];
  }
  if (canTab('wallet')) subs.push(...walletOnEnterFamily(fid));
  if (canTab('chores')) subs.push(...choresOnEnterFamily(fid));
  if (canTab('dues')) subs.push(...duesOnEnterFamily(fid));
  state.dataUnsubs = subs;
}

// 分頁（跟權限）
const VIEWS = [
  ['shop', 'viewShop'],
  ['dinner', 'viewDinner'],
  ['chores', 'viewChores'],
  ['dues', 'viewDues'],
  ['wallet', 'viewWallet'],
];
function visibleViews() {
  return VIEWS.map(([v]) => v).filter((v) => canTab(v));
}

function showView(view) {
  const shown = visibleViews();
  if (!shown.includes(view)) view = shown[0];
  $('#no-access')?.classList.toggle('hidden', shown.length > 0);
  if (!view) return;
  ls.set('fsl-view', view);
  document.querySelectorAll('.views [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#shop-view')?.classList.toggle('hidden', view !== 'shop');
  $('.addbar')?.classList.toggle('hidden', view !== 'shop');
  $('#dinner')?.classList.toggle('hidden', view !== 'dinner');
  $('#wallet')?.classList.toggle('hidden', view !== 'wallet');
  $('#chores')?.classList.toggle('hidden', view !== 'chores');
  $('#dues')?.classList.toggle('hidden', view !== 'dues');
  // 冇底部輸入欄嘅頁唔使留位
  document.body.classList.toggle('dinner-mode', view !== 'shop');
  if (view === 'dinner') renderDinner();
  else if (view === 'wallet') renderWallet();
  else if (view === 'chores') renderChores();
  else if (view === 'dues') renderDues();
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
      <h1><button type="button" class="family-switch" id="family-switch" title="${esc(t('switchFamily'))}"><span id="family-title"></span><span class="fam-caret" aria-hidden="true">${knownFamilies().length > 1 ? '⇅' : '▾'}</span></button></h1>
      <span class="offline ${navigator.onLine ? 'hidden' : ''}" id="offline">${esc(t('offline'))}</span>
      ${canInstall() ? `<button class="icon-btn" id="install-btn" aria-label="${esc(t('install'))}" title="${esc(t('install'))}">📲</button>` : ''}
      <button class="icon-btn" id="cal-btn" aria-label="${esc(t('calendar'))}" title="${esc(t('calendar'))}">📅</button>
      <button class="icon-btn" id="invite-btn" aria-label="${esc(t('invite'))}" title="${esc(t('invite'))}">👪</button>
      <button class="icon-btn" id="settings-btn" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">⚙️</button>
    </header>
    <nav class="views ${visibleViews().length < 2 ? 'hidden' : ''}" style="--n:${visibleViews().length}">
      ${VIEWS.filter(([v]) => visibleViews().includes(v))
        .map(([v, key]) => {
          const [icon, ...label] = t(key).split(' ');
          return `<button data-view="${v}"><span class="v-icon" aria-hidden="true">${esc(icon)}</span><span>${esc(label.join(' '))}</span></button>`;
        })
        .join('')}
    </nav>
    <div id="shop-view">
    <nav class="tabs" id="tabs" role="tablist" aria-label="${esc(t('lists'))}"></nav>
    <div class="shop-tools">
      <span class="shop-title" id="shop-title"></span>
      <button type="button" class="btn shop-start" id="shop-start">${esc(t('shopStart'))}</button>
    </div>
    <div id="freq" class="freq-row"></div>
    <main id="list"></main>
    </div>
    <main id="dinner" class="hidden"></main>
    <main id="wallet" class="hidden"></main>
    <div id="no-access" class="empty hidden"><div class="big">🔒</div><p>${esc(t('noTabs'))}</p></div>
    <main id="chores" class="hidden"></main>
    <main id="dues" class="hidden"></main>
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
  $('#family-switch').onclick = openFamilies;
  $('#invite-btn').onclick = openInvite;
  $('#cal-btn').onclick = () => openCalendar();
  $('#install-btn')?.addEventListener('click', () => openInstall({ inviteLink: inviteLink(), familyId: state.familyId }));
  document.querySelectorAll('.views [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  showView(ls.get('fsl-view') || 'shop');
  $('#settings-btn').onclick = openSettings;
  $('#add-form').onsubmit = onAdd;
  $('#mic')?.addEventListener('click', startVoice);
  $('#add-photo').onclick = () => $('#photo-input').click();
  $('#photo-input').onchange = onAddPhoto;
  $('#add-name').addEventListener('focus', fillHistory, { once: true });

  $('#shop-start').onclick = () => (shopping.on ? stopShopping() : startShopping());
  renderShopBar();
  $('#freq').onclick = (e) => {
    if (e.target.closest('#freq-manage')) return openFreqManage();
    const chip = e.target.closest('[data-freq]');
    if (!chip || !state.listId) return;
    if (addByName(chip.dataset.freq) !== 'dup') toast(t('freqAdded', { name: chip.textContent.replace(/^＋\s*/, '') }));
  };
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
  renderFreq();
  renderShopBar();
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
        !shopping.on && i.addedBy && esc(t('addedBy', { name: i.addedBy })), // 買嘢模式唔使睇邊個加
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

  addByName(name, { qty, link });
  if (!link) addHistory(name);
  fillHistory();
  nameEl.value = '';
  qtyEl.value = '';
  nameEl.focus();
}

// ---------- ⭐ 常買 ----------

const freqLabel = (d) => d.tr?.[getLang()] || lookup(d.name)?.[getLang()] || d.name;

function renderFreq() {
  const row = $('#freq');
  if (!row) return;
  const list = currentList();
  const onList = new Set(
    state.items
      .filter((i) => i.listId === state.listId && !i.done)
      .flatMap((i) => [i.name, ...Object.values(i.tr || {})].map((x) => String(x).trim().toLowerCase())),
  );
  const top = !list || isWish(list) ? [] : topFrequent(state.freq, { exclude: onList });
  row.classList.toggle('hidden', !top.length);
  row.innerHTML = top.length
    ? `<span class="freq-label">${esc(t('freqTitle'))}</span>${top
        .map((d) => `<button type="button" class="freq-chip" data-freq="${esc(d.name)}">＋ ${esc(freqLabel(d))}</button>`)
        .join('')}<button type="button" class="freq-chip manage" id="freq-manage" aria-label="${esc(t('freqManage'))}">⚙️</button>`
    : '';
}

function openFreqManage() {
  const draw = (d) => {
    const all = [...state.freq].sort((a, b) => (b.count || 0) - (a.count || 0));
    $('.freq-list', d).innerHTML = all.length
      ? all
          .map(
            (x) => `<li class="item"><div class="toggle"><span class="body"><span class="name">${esc(freqLabel(x))}</span>
              <div class="meta">${esc(t('timesBought', { n: x.count || 0 }))}</div></span></div>
              <button type="button" class="icon-btn" data-del-freq="${esc(x.id)}" aria-label="${esc(t('delete'))}">✕</button></li>`,
          )
          .join('')
      : `<p class="muted">${esc(t('freqEmpty'))}</p>`;
  };
  openDialog(
    `<h2>${esc(t('freqManage'))}</h2>
    <p class="small muted">${esc(t('freqManageHint'))}</p>
    <ul class="items freq-list"></ul>
    <div class="actions"><span class="spacer"></span><button class="btn primary" data-close>${esc(t('close'))}</button></div>`,
    (d) => {
      draw(d);
      $('.freq-list', d).onclick = (e) => {
        const b = e.target.closest('[data-del-freq]');
        if (!b) return;
        state.store.deleteFreq(state.familyId, b.dataset.delFreq).catch(fail);
        setTimeout(() => draw(d), 150);
      };
    },
  );
}

// ---------- 🛒 買嘢模式：屏幕唔熄、大字大剔格，買完問要唔要記支出 ----------

const shopping = { on: false, since: 0, lock: null };

async function keepAwake() {
  try {
    if (shopping.on && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      shopping.lock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('wake lock', err);
  }
}
document.addEventListener('visibilitychange', () => {
  if (shopping.on && document.visibilityState === 'visible') keepAwake();
});

function startShopping() {
  shopping.on = true;
  shopping.since = Date.now();
  document.body.classList.add('shopping-mode');
  keepAwake();
  render();
  window.scrollTo(0, 0);
}

function stopShopping() {
  // 伺服器時間同部機時間可能差少少，放寬一分鐘
  const bought = state.items.filter((i) => i.done && i.doneBy === state.me && (i.doneAt || 0) >= shopping.since - 60_000).length;
  shopping.on = false;
  shopping.lock?.release().catch(() => {});
  shopping.lock = null;
  document.body.classList.remove('shopping-mode');
  render();
  if (bought && canTab('wallet')) {
    openDialog(
      `<h2>🛒 ${esc(t('shopRecordPrompt', { n: bought }))}</h2>
      <div class="actions"><span class="spacer"></span>
        <button class="btn" data-close>${esc(t('later'))}</button>
        <button class="btn" id="record-now">${esc(t('shopRecord'))}</button>
        <button class="btn primary" id="snap-now">📷 ${esc(t('inboxSnap'))}</button>
      </div>`,
      (d) => {
        $('#record-now', d).onclick = () => openExpense();
        $('#snap-now', d).onclick = () => {
          d.close();
          snapReceipts();
        };
      },
    );
  }
}

function renderShopBar() {
  const btn = $('#shop-start');
  if (!btn) return;
  btn.textContent = shopping.on ? t('shopDone') : t('shopStart');
  btn.classList.toggle('primary', shopping.on);
  // 買嘢模式：頂部淨係顯示清單名 + 剔咗幾多
  const title = $('#shop-title');
  if (!title) return;
  const items = state.items.filter((i) => i.listId === state.listId);
  const list0 = currentList();
  title.innerHTML = shopping.on && list0
    ? `<b>${esc(listLabel(list0))}</b><span>${esc(t('shopProgress', { done: items.filter((i) => i.done).length, total: items.length }))}</span>`
    : '';
}

// 加一樣嘢入目前清單（已經有未買 → 提示；之前買過 → 放返入未買）；回傳 'dup' | 'readded' | 'added'
function addByName(name, { qty = '', link = '' } = {}) {
  const n = name.toLowerCase();
  const matches = (i) => i.name.toLowerCase() === n || Object.values(i.tr || {}).some((v) => String(v).toLowerCase() === n);
  const same = state.items.find((i) => i.listId === state.listId && matches(i));
  if (same && !same.done) {
    toast(t('alreadyOnList', { name }));
    if (qty && qty !== same.qty) state.store.updateItem(state.familyId, same.id, { qty }).catch(fail);
    return 'dup';
  }
  const item = same || newItem(name, { qty, link });
  if (same) {
    // 之前買過，放返入未買
    state.store.updateItem(state.familyId, same.id, { done: false, doneBy: null, qty: qty || same.qty, addedBy: state.me }).catch(fail);
  } else {
    state.store.addItem(state.familyId, item).catch(fail);
  }
  // ⭐ 常買：全家次數 +1（想買清單同連結唔計）
  if (!link && !isWish(currentList())) {
    state.store
      .bumpFreq(state.familyId, freqKey(item.name), { name: item.name, category: item.category || 'other', lang: item.lang || 'zh', tr: item.tr || {} })
      .catch((err) => console.warn('freq', err));
  }
  return same ? 'readded' : 'added';
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
  const k = state.family?.joinCode;
  return `${location.origin}${location.pathname}?f=${state.familyId}${k ? `&k=${k}` : ''}`;
}
const currentFamilyCode = () => familyCode(state.familyId, state.family?.joinCode);

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
    <p class="small muted">${esc(t('inviteCode'))} <b>${esc(currentFamilyCode())}</b></p>
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
      ${
        !state.access?.hasAdmin || state.access.admin
          ? `<label class="field"><span>${esc(t('familyName'))}</span><input class="input" name="family" maxlength="30" required value="${esc(state.family?.name || '')}"></label>`
          : ''
      }
      ${
        list && canTab('shop')
          ? `<label class="field"><span>${esc(t('currentListName'))}</span><input class="input" name="list" maxlength="30" required value="${esc(list.name)}"></label>
             ${kindPicker(isWish(list) ? 'wish' : 'shop')}`
          : ''
      }
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>

      <div class="section-title">${esc(t('familyCode'))}</div>
      <div class="code">${esc(currentFamilyCode())}</div>
      <button type="button" class="btn block devices-btn" id="open-devices">${esc(t('devices'))}</button>

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
        if (me && me !== state.me) {
          rememberName(me);
          touchDevice(state.familyId); // 部機登記入面嘅名都改埋
        }
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
      $('#open-devices', d).onclick = () =>
        openDevices({
          state,
          // 換咗代碼：即刻出分享新連結畫面
          onRotated: () => setTimeout(openInvite, 300),
        });
    },
  );
}

boot();
