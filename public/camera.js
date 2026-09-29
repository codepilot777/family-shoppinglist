// 📷 連續影相：app 自己嘅相機畫面，撳一下影一張，唔使每張返出嚟。
// 開唔到相機（冇權限、舊瀏覽器）就用電話相機 / 相簿（可以一次揀幾張）。
import { t } from './i18n.js';
import { $, esc } from './ui.js';

// onShot(blob) 每影一張 / 揀一張就叫一次；onDone() 閂咗之後叫
export function openCamera({ onShot, onDone, max = 20 }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'camera';
  dlg.innerHTML = `
    <div class="cam-view">
      <video playsinline muted autoplay></video>
      <div class="cam-msg hidden"></div>
      <div class="cam-flash"></div>
    </div>
    <div class="cam-strip" aria-live="polite"></div>
    <div class="cam-bar">
      <button type="button" class="btn cam-side" id="cam-pick">🖼️ ${esc(t('camAlbum'))}</button>
      <button type="button" class="cam-shutter" id="cam-shoot" aria-label="${esc(t('camShoot'))}"></button>
      <button type="button" class="btn primary cam-side" id="cam-done">${esc(t('camDone'))}</button>
    </div>
    <input type="file" id="cam-files" accept="image/*" multiple hidden>
    <input type="file" id="cam-native" accept="image/*" capture="environment" hidden>`;
  document.body.appendChild(dlg);
  const video = $('video', dlg);
  const strip = $('.cam-strip', dlg);
  let stream = null;
  let count = 0;
  const urls = [];

  const add = (blob) => {
    if (count >= max) return false;
    count++;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    strip.insertAdjacentHTML('beforeend', `<img src="${url}" alt="">`);
    strip.scrollLeft = strip.scrollWidth;
    $('#cam-done', dlg).textContent = `${t('camDone')} (${count})`;
    onShot(blob);
    if (count >= max) $('#cam-shoot', dlg).disabled = true;
    return true;
  };

  const noCamera = () => {
    const msg = $('.cam-msg', dlg);
    msg.innerHTML = `<p>${esc(t('camUnavailable'))}</p>
      <button type="button" class="btn primary" id="cam-native-btn">📷 ${esc(t('camPhoneCamera'))}</button>`;
    msg.classList.remove('hidden');
    $('#cam-native-btn', dlg).onclick = () => $('#cam-native', dlg).click();
    $('#cam-shoot', dlg).onclick = () => $('#cam-native', dlg).click();
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return noCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      if (!dlg.open) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (err) {
      console.warn('camera', err);
      noCamera();
    }
  };

  const stop = () => {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  };

  const shoot = () => {
    if (!stream || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const flash = $('.cam-flash', dlg);
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    canvas.toBlob((blob) => blob && add(blob), 'image/jpeg', 0.92);
  };

  const fromFiles = (e) => {
    for (const f of e.target.files || []) if (!add(f)) break;
    e.target.value = '';
  };

  $('#cam-shoot', dlg).onclick = shoot;
  $('#cam-pick', dlg).onclick = () => $('#cam-files', dlg).click();
  $('#cam-files', dlg).onchange = fromFiles;
  $('#cam-native', dlg).onchange = fromFiles;
  $('#cam-done', dlg).onclick = () => dlg.close();
  dlg.addEventListener('close', () => {
    stop();
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
    dlg.remove();
    onDone?.(count);
  });
  dlg.showModal();
  start();
  return dlg;
}
