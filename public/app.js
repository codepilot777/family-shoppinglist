import { createStore } from './store.js';

// ---------- 分類 ----------

const CATEGORIES = [
  { id: 'veg', label: '蔬菜水果', icon: '🥬' },
  { id: 'meat', label: '肉類海鮮', icon: '🥩' },
  { id: 'dairy', label: '奶類同蛋', icon: '🥛' },
  { id: 'staple', label: '米麵糧油', icon: '🍚' },
  { id: 'frozen', label: '急凍食品', icon: '🧊' },
  { id: 'drink', label: '飲品', icon: '🥤' },
  { id: 'snack', label: '零食', icon: '🍪' },
  { id: 'home', label: '日用品', icon: '🧻' },
  { id: 'other', label: '其他', icon: '📦' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

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
  ['drink', ['汽水', '可樂', '果汁', '茶', '咖啡', '啤酒', '酒', '礦泉水', '蒸餾水', '樽裝水', '豆漿', '檸檬水']],
  ['veg', ['菜', '番茄', '蕃茄', '薯仔', '洋蔥', '蘿蔔', '蘋果', '橙', '香蕉', '提子', '士多啤梨', '西瓜', '果', '瓜', '蒜', '薑', '蔥', '芫茜', '菇', '粟米', '西蘭花', '豆角', '椒', '檸檬', '牛油果', '奇異果', '芒果', '梨', '藍莓']],
  ['meat', ['豬', '牛', '雞', '魚', '蝦', '肉', '排骨', '叉燒', '蟹', '帶子', '腸', '火腿', '煙肉', '鴨', '羊', '蠔', '魷']],
  ['staple', ['米', '麵', '意粉', '油', '鹽', '糖', '豉油', '醋', '醬', '粉', '罐頭', '麥皮', '粟米片', '通粉', '米粉', '湯']],
];

function guessCategory(name) {
  const n = name.toLowerCase();
  for (const [cat, words] of [...CATEGORY_OVERRIDES, ...CATEGORY_KEYWORDS]) if (words.some((w) => n.includes(w))) return cat;
  return 'other';
}

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

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => {
    el.classList.remove('show');
    action.run();
  };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}

function fail(err) {
  console.error(err);
  const msg = err?.code === 'permission-denied' ? '冇權限，請檢查 Firestore rules' : err?.message || String(err);
  toast(`出錯：${msg}`);
}

function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return '啱啱';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 個鐘前`;
  return `${Math.floor(s / 86400)} 日前`;
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

function rememberName(name) {
  state.me = name;
  ls.set('fsl-name', name);
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
      ? '請喺 Firebase Console → Authentication → Sign-in method 開啟「匿名 (Anonymous)」登入。'
      : err?.code === 'auth/network-request-failed'
        ? '連唔到網絡。請檢查網絡之後再試。'
        : '請檢查 firebase-config.js 設定。';
  const app = $('#app');
  app.className = 'loading';
  app.innerHTML = `<div class="card" style="max-width:420px">
    <h2>連接唔到 Firebase</h2>
    <p>${esc(hint)}</p>
    <p class="small muted">${esc(err?.code || err?.message || err)}</p>
    <button class="btn primary block" onclick="location.reload()">再試</button>
  </div>`;
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

  app.innerHTML = `<div class="setup">
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>屋企購物清單</h1>
    <p class="lead">一家人一齊加、一齊剔，即時同步</p>
    ${state.store.mode === 'local' ? `<div class="demo-note">⚠️ 示範模式：未設定 Firebase，資料只會存喺呢部裝置，唔會同步俾屋企人。設定方法睇 README。</div>` : ''}

    <div class="card">
      <label class="field"><span>你嘅名（屋企人會見到）</span>
        <input class="input" id="me" maxlength="20" placeholder="例如：媽媽、阿仔" value="${esc(state.me)}" autocomplete="nickname">
      </label>
    </div>

    ${
      invite
        ? inviteFamily
          ? `<div class="card">
              <h2>加入「${esc(inviteFamily.name)}」</h2>
              <button class="btn primary block" id="join-invite">加入</button>
            </div>
            <p class="or"><button class="link-btn" id="skip-invite">唔加入，自己開過一個</button></p>`
          : `<div class="card"><h2>搵唔到呢個家庭</h2><p class="muted small">條邀請連結可能唔啱，或者網絡有問題。</p>
              <button class="btn block" id="skip-invite">返回</button></div>`
        : `<div class="card">
            <h2>建立新家庭</h2>
            <label class="field"><span>家庭名稱</span>
              <input class="input" id="family-name" maxlength="30" value="我哋屋企">
            </label>
            <button class="btn primary block" id="create">建立</button>
          </div>
          <p class="or">或者</p>
          <div class="card">
            <h2>加入屋企人嘅家庭</h2>
            <label class="field"><span>家庭代碼（喺屋企人部機「設定」度搵到）</span>
              <input class="input" id="code" maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false">
            </label>
            <button class="btn block" id="join">加入</button>
          </div>`
    }
  </div>`;

  const needName = () => {
    const name = clean($('#me').value, 20);
    if (!name) {
      toast('請先填你嘅名');
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
    const familyName = clean($('#family-name').value, 30) || '我哋屋企';
    busy(e.target, true);
    try {
      const fid = await state.store.createFamily(familyName, '超市');
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
    if (!code) return toast('請填家庭代碼');
    busy(e.target, true);
    try {
      const fam = await state.store.getFamily(code);
      if (!fam) {
        toast('搵唔到呢個家庭，請檢查代碼');
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
      $('#family-title').textContent = fam?.name || '購物清單';
      document.title = fam?.name ? `${fam.name} · 購物清單` : '屋企購物清單';
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
  ];
}

function selectList(id, rerender = true) {
  state.listId = id;
  ls.set(`fsl-list-${state.familyId}`, id);
  if (rerender) render();
}

function renderShell() {
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <header class="topbar">
      <h1 id="family-title">購物清單</h1>
      <span class="offline ${navigator.onLine ? 'hidden' : ''}" id="offline">離線</span>
      <button class="icon-btn" id="invite-btn" aria-label="邀請屋企人" title="邀請屋企人">👪</button>
      <button class="icon-btn" id="settings-btn" aria-label="設定" title="設定">⚙️</button>
    </header>
    <nav class="tabs" id="tabs" role="tablist" aria-label="清單"></nav>
    <main id="list"></main>
    <div class="addbar">
      <form id="add-form" autocomplete="off">
        <input class="input name-input" id="add-name" maxlength="60" placeholder="要買咩？" list="history" enterkeyhint="done" aria-label="貨品名稱">
        <input class="input qty-input" id="add-qty" maxlength="12" placeholder="數量" aria-label="數量">
        <button class="btn primary" aria-label="加入">加</button>
      </form>
      <datalist id="history"></datalist>
    </div>`;

  $('#invite-btn').onclick = openInvite;
  $('#settings-btn').onclick = openSettings;
  $('#add-form').onsubmit = onAdd;
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
          `<button class="tab" role="tab" data-list="${esc(l.id)}" aria-selected="${l.id === state.listId}">${esc(l.name)}${
            pending(l.id) ? `<span class="count">${pending(l.id)}</span>` : ''
          }</button>`,
      )
      .join('') + `<button class="tab add" id="add-list" aria-label="新增清單">＋ 清單</button>`;

  $('#add-form')?.classList.toggle('hidden', !state.listId);

  if (!state.listId) {
    list.innerHTML = `<div class="empty"><div class="big">🗒️</div><p>未有清單</p>
      <button class="btn primary" id="empty-add-list">新增清單</button></div>`;
    return;
  }

  const items = state.items.filter((i) => i.listId === state.listId);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="big">🛒</div><p>清單係空嘅<br><span class="small">喺下面加啲嘢啦</span></p></div>`;
    return;
  }

  let html = '';
  for (const cat of CATEGORIES) {
    const group = todo.filter((i) => (CAT[i.category] ? i.category : 'other') === cat.id).sort((a, b) => a.createdAt - b.createdAt);
    if (!group.length) continue;
    html += `<h2 class="group-title">${cat.icon} ${cat.label}</h2><ul class="items">${group.map(itemRow).join('')}</ul>`;
  }
  if (!todo.length) html += `<div class="empty"><div class="big">🎉</div><p>全部買晒！</p></div>`;
  if (done.length) {
    html += `<div class="done-head"><h2 class="group-title">✅ 已買 (${done.length})</h2>
      <button class="link-btn danger" id="clear-done">清除已買</button></div>
      <ul class="items">${done.map(itemRow).join('')}</ul>`;
  }
  list.innerHTML = html;
}

function itemRow(i) {
  const meta = i.done
    ? `${esc(i.doneBy || '')} 買咗 · ${timeAgo(i.doneAt)}`
    : [i.note && esc(i.note), i.addedBy && `${esc(i.addedBy)} 加`].filter(Boolean).join(' · ');
  return `<li class="item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    <button class="toggle" aria-pressed="${!!i.done}">
      <span class="check" aria-hidden="true">✓</span>
      <span class="body">
        <span class="name">${esc(i.name)}</span>${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </span>
    </button>
    <button class="icon-btn more" aria-label="編輯 ${esc(i.name)}">⋯</button>
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

  const same = state.items.find((i) => i.listId === state.listId && i.name.toLowerCase() === name.toLowerCase());
  if (same && !same.done) {
    toast(`「${name}」已經喺清單度`);
    if (qty && qty !== same.qty) state.store.updateItem(state.familyId, same.id, { qty }).catch(fail);
  } else if (same) {
    // 之前買過，放返入未買
    state.store.updateItem(state.familyId, same.id, { done: false, doneBy: null, qty: qty || same.qty, addedBy: state.me }).catch(fail);
  } else {
    state.store
      .addItem(state.familyId, {
        listId: state.listId,
        name,
        qty,
        note: '',
        category: guessCategory(name),
        addedBy: state.me,
      })
      .catch(fail);
  }
  addHistory(name);
  fillHistory();
  nameEl.value = '';
  qtyEl.value = '';
  nameEl.focus();
}

function toggleItem(item) {
  const done = !item.done;
  state.store.updateItem(state.familyId, item.id, { done, doneBy: done ? state.me : null }).catch(fail);
  if (navigator.vibrate) navigator.vibrate(10);
}

function deleteItem(item) {
  state.store.deleteItem(state.familyId, item.id).catch(fail);
  toast(`已刪除「${item.name}」`, {
    label: '復原',
    run: () => {
      const { id, createdAt, doneAt, done, doneBy, ...rest } = item;
      state.store.addItem(state.familyId, rest).catch(fail);
    },
  });
}

function clearDone() {
  const n = state.items.filter((i) => i.listId === state.listId && i.done).length;
  confirmDialog(`清除 ${n} 樣已買嘅嘢？`, '清除', () => state.store.clearDone(state.familyId, state.listId).catch(fail));
}

// ---------- 對話框 ----------

const dialog = $('#dialog');
function openDialog(html, setup) {
  dialog.innerHTML = html;
  dialog.onclose = null;
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
      <button class="btn" data-close>取消</button>
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
  openDialog(
    `<form id="edit-form">
      <h2>編輯</h2>
      <label class="field"><span>名稱</span><input class="input" name="name" maxlength="60" required value="${esc(item.name)}"></label>
      <div class="row">
        <label class="field"><span>數量</span><input class="input" name="qty" maxlength="12" value="${esc(item.qty)}"></label>
        <label class="field"><span>清單</span><select class="input" name="listId">${state.lists
          .map((l) => `<option value="${esc(l.id)}" ${l.id === item.listId ? 'selected' : ''}>${esc(l.name)}</option>`)
          .join('')}</select></label>
      </div>
      <label class="field"><span>備註（牌子、大細…）</span><input class="input" name="note" maxlength="100" value="${esc(item.note)}"></label>
      <div class="field"><span>分類</span><div class="cats">${CATEGORIES.map(
        (c) =>
          `<label><input type="radio" name="category" value="${c.id}" ${
            (CAT[item.category] ? item.category : 'other') === c.id ? 'checked' : ''
          }><span>${c.icon} ${c.label}</span></label>`,
      ).join('')}</div></div>
      <p class="small muted">${esc(item.addedBy || '')} ${item.createdAt ? `· ${timeAgo(item.createdAt)}加` : ''}</p>
      <div class="actions">
        <button type="button" class="btn danger" id="del">刪除</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>取消</button>
        <button class="btn primary">儲存</button>
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
        state.store
          .updateItem(state.familyId, item.id, {
            name,
            qty: clean(f.get('qty'), 12),
            note: clean(f.get('note'), 100),
            category: f.get('category') || 'other',
            listId: f.get('listId') || item.listId,
          })
          .catch(fail);
        d.close();
      };
    },
  );
}

function openNewList() {
  openDialog(
    `<form id="list-form">
      <h2>新增清單</h2>
      <label class="field"><span>名稱</span><input class="input" name="name" maxlength="30" required placeholder="例如：街市、藥房、IKEA"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>取消</button>
        <button class="btn primary">新增</button>
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
      await navigator.share({ title: '屋企購物清單', text, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('已複製連結');
  } catch {
    toast('複製唔到，請手動複製');
  }
}

function openInvite() {
  const local = state.store.mode === 'local';
  openDialog(
    `<h2>邀請屋企人</h2>
    ${
      local
        ? `<div class="demo-note">示範模式唔會同步。要設定 Firebase 之後，屋企人先可以一齊用。</div>`
        : `<p class="small">將呢條連結傳俾屋企人（WhatsApp 都得），佢哋打開之後填個名就可以一齊用。</p>`
    }
    <div class="code">${esc(inviteLink())}</div>
    <p class="small muted">或者叫佢哋喺「加入家庭」度輸入代碼：<b>${esc(state.familyId)}</b></p>
    <p class="small muted">📱 提示：喺手機瀏覽器揀「加至主畫面」，用起上嚟就好似一個 app。</p>
    <div class="actions"><span class="spacer"></span>
      <button class="btn" data-close>關閉</button>
      <button class="btn primary" id="share">分享連結</button>
    </div>`,
    (d) => {
      $('#share', d).onclick = () => share(`一齊用「${state.family?.name || '購物清單'}」啦！`, inviteLink());
    },
  );
}

function openSettings() {
  const list = state.lists.find((l) => l.id === state.listId);
  openDialog(
    `<form id="settings-form">
      <h2>設定</h2>
      <label class="field"><span>你嘅名</span><input class="input" name="me" maxlength="20" required value="${esc(state.me)}"></label>
      <label class="field"><span>家庭名稱</span><input class="input" name="family" maxlength="30" required value="${esc(state.family?.name || '')}"></label>
      ${
        list
          ? `<label class="field"><span>目前清單名稱</span><input class="input" name="list" maxlength="30" required value="${esc(list.name)}"></label>`
          : ''
      }
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>取消</button>
        <button class="btn primary">儲存</button>
      </div>

      <div class="section-title">家庭代碼</div>
      <div class="code">${esc(state.familyId)}</div>

      <div class="section-title">其他</div>
      <div class="row">
        ${list ? `<button type="button" class="btn danger" id="del-list">刪除「${esc(list.name)}」</button>` : ''}
        <button type="button" class="btn danger" id="leave">離開家庭</button>
      </div>
      <p class="small muted">${state.store.mode === 'local' ? '⚠️ 示範模式（資料只存喺呢部裝置）' : '✅ 已連接 Firebase，即時同步'}</p>
    </form>`,
    (d) => {
      $('#settings-form', d).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const me = clean(f.get('me'), 20);
        const fam = clean(f.get('family'), 30);
        const ln = clean(f.get('list'), 30);
        if (me) rememberName(me);
        if (fam && fam !== state.family?.name) state.store.renameFamily(state.familyId, fam).catch(fail);
        if (list && ln && ln !== list.name) state.store.renameList(state.familyId, list.id, ln).catch(fail);
        d.close();
        toast('已儲存');
      };
      $('#del-list', d)?.addEventListener('click', () => {
        const n = state.items.filter((i) => i.listId === list.id).length;
        confirmDialog(`刪除「${list.name}」同埋入面 ${n} 樣嘢？全家都會冇咗。`, '刪除', () =>
          state.store.deleteList(state.familyId, list.id).catch(fail),
        );
      });
      $('#leave', d).onclick = () =>
        confirmDialog('離開呢個家庭？（清單唔會刪除，之後可以用代碼再加入）', '離開', leaveFamily);
    },
  );
}

boot();
