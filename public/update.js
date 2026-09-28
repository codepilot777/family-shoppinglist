// 🔄 新版本提示：有新版本就喺頂部出一條「更新」掣，唔使再「重新整理兩次」。
import { t } from './i18n.js';

let requested = false;

function showBanner(worker) {
  let bar = document.getElementById('update-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.className = 'update-banner';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span></span><button type="button"></button>`;
  bar.querySelector('span').textContent = t('updateReady');
  const btn = bar.querySelector('button');
  btn.textContent = t('updateNow');
  btn.onclick = () => {
    requested = true;
    btn.disabled = true;
    worker.postMessage('SKIP_WAITING');
  };
}

export function watchForUpdates(reg) {
  if (!reg) return reg;
  const offer = (worker) => {
    // 第一次安裝（未有舊版本控制緊頁面）唔使提示
    if (worker && navigator.serviceWorker.controller) showBanner(worker);
  };
  offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') offer(w);
    });
  });
  // 新版本接手之後重新載入（只係撳咗「更新」先做，第一次安裝唔會突然 reload）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!requested) return;
    requested = false;
    location.reload();
  });
  // 手機 app 好少自己檢查：每次返到 app 同埋每個鐘檢查一次
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
  setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  return reg;
}
