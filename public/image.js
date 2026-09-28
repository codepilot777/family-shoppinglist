// 相片壓縮：喺手機度縮細再存入 Firestore（唔使 Firebase Storage，免費方案都用得）。

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    const img = new Image();
    img.onload = () => {
      if (src instanceof Blob) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (src instanceof Blob) URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

// 回傳 JPEG data URL，長邊最多 maxSide，大細唔超過 maxChars
export async function compressImage(src, { maxSide, maxChars, quality = 0.8 }) {
  const img = await loadImage(src);
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG 透明位變白色
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (let q = quality; q >= 0.45; q -= 0.12) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= maxChars) return data;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('image too large');
}

export const PHOTO_OPTS = { maxSide: 1280, maxChars: 300_000, quality: 0.8 };
export const THUMB_OPTS = { maxSide: 200, maxChars: 20_000, quality: 0.7 };
export const MAX_PHOTOS = 3;
