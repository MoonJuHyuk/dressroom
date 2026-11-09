// 사진 자르기: 전체를 찍은 뒤 필요한 부분만 남깁니다. cropImage(blob) → 잘린 Blob 또는 null(취소)
const RATIOS = [['free', '자유', 0], ['45', '4:5', 4 / 5], ['11', '1:1', 1], ['34', '3:4', 3 / 4]];

async function toCanvas(src) {
  let img;
  if (src instanceof Blob) {
    try { img = await createImageBitmap(src, { imageOrientation: 'from-image' }); }
    catch (e) { img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(src); }); }
  } else img = src;
  const c = document.createElement('canvas');
  c.width = img.width || img.naturalWidth; c.height = img.height || img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}
function rotate(c) {
  const r = document.createElement('canvas'); r.width = c.height; r.height = c.width;
  const g = r.getContext('2d'); g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0);
  return r;
}

export async function cropImage(blob, { max = 1600, quality = 0.88 } = {}) {
  let src = await toCanvas(blob);
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'crop';
    ov.innerHTML = `
      <div class="ctop">
        <button type="button" class="btn ghost light" data-a="cancel">취소</button>
        <span class="ctitle">사진 자르기</span>
        <button type="button" class="btn primary light" data-a="done">완료</button>
      </div>
      <div class="cstage"><canvas class="cimg"></canvas><div class="cshade"></div>
        <div class="cbox"><i class="h nw"></i><i class="h ne"></i><i class="h sw"></i><i class="h se"></i><b class="g1"></b><b class="g2"></b></div></div>
      <div class="cbar">
        <div class="chips dark">${RATIOS.map(([k, l], i) => `<button type="button" data-r="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
        <div class="row-btns"><button type="button" class="btn light ghost sm" data-a="rot">↻ 회전</button><button type="button" class="btn light ghost sm" data-a="reset">원래대로</button></div>
      </div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('.cstage'), cv = ov.querySelector('.cimg'), box = ov.querySelector('.cbox'), shade = ov.querySelector('.cshade');
    let ratio = 0, disp = { x: 0, y: 0, w: 0, h: 0 }, r = { x: 0, y: 0, w: 0, h: 0 };

    const layout = (keep = false) => {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const s = Math.min(sw / src.width, sh / src.height);
      const old = { ...disp };
      disp = { w: src.width * s, h: src.height * s };
      disp.x = (sw - disp.w) / 2; disp.y = (sh - disp.h) / 2;
      cv.width = Math.round(disp.w * devicePixelRatio); cv.height = Math.round(disp.h * devicePixelRatio);
      cv.style.cssText = `left:${disp.x}px;top:${disp.y}px;width:${disp.w}px;height:${disp.h}px`;
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      if (keep && old.w) { const k = disp.w / old.w; r = { x: disp.x + (r.x - old.x) * k, y: disp.y + (r.y - old.y) * k, w: r.w * k, h: r.h * k }; }
      else resetRect();
      draw();
    };
    const resetRect = () => {
      if (!ratio) { r = { ...disp }; return; }
      let w = disp.w, h = w / ratio;
      if (h > disp.h) { h = disp.h; w = h * ratio; }
      r = { x: disp.x + (disp.w - w) / 2, y: disp.y + (disp.h - h) / 2, w, h };
    };
    const draw = () => {
      box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      shade.style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${r.x}px ${r.y}px,${r.x}px ${r.y + r.h}px,${r.x + r.w}px ${r.y + r.h}px,${r.x + r.w}px ${r.y}px,${r.x}px ${r.y}px)`;
    };
    const clamp = () => {
      const MIN = 40;
      r.w = Math.max(MIN, Math.min(r.w, disp.w)); r.h = Math.max(MIN, Math.min(r.h, disp.h));
      r.x = Math.min(Math.max(r.x, disp.x), disp.x + disp.w - r.w);
      r.y = Math.min(Math.max(r.y, disp.y), disp.y + disp.h - r.h);
    };

    // 드래그: 상자 안 = 이동, 모서리 = 크기 조절
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      const h = e.target.closest('.h');
      const inBox = e.target.closest('.cbox');
      if (!h && !inBox) return;
      e.preventDefault(); stage.setPointerCapture(e.pointerId);
      drag = { mode: h ? [...h.classList].find(c => c.length === 2) : 'move', sx: e.clientX, sy: e.clientY, r0: { ...r } };
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.r0;
      if (drag.mode === 'move') { r = { ...o, x: o.x + dx, y: o.y + dy }; clamp(); draw(); return; }
      const W = drag.mode.includes('w'), N = drag.mode.includes('n');
      // 고정되는 반대쪽 모서리
      const ax = W ? o.x + o.w : o.x, ay = N ? o.y + o.h : o.y;
      let px = (W ? o.x : o.x + o.w) + dx, py = (N ? o.y : o.y + o.h) + dy;
      px = Math.min(Math.max(px, disp.x), disp.x + disp.w); py = Math.min(Math.max(py, disp.y), disp.y + disp.h);
      let w = Math.max(40, Math.abs(px - ax)), h = Math.max(40, Math.abs(py - ay));
      if (ratio) {
        if (w / h > ratio) w = h * ratio; else h = w / ratio;
        const maxW = W ? ax - disp.x : disp.x + disp.w - ax, maxH = N ? ay - disp.y : disp.y + disp.h - ay;
        if (w > maxW) { w = maxW; h = w / ratio; }
        if (h > maxH) { h = maxH; w = h * ratio; }
      }
      r = { x: W ? ax - w : ax, y: N ? ay - h : ay, w, h };
      draw();
    });
    const end = () => { drag = null; };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

    ov.querySelector('.chips').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      ratio = (RATIOS.find(x => x[0] === b.dataset.r) || RATIOS[0])[2];
      ov.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', x === b));
      resetRect(); draw();
    });
    const close = val => { window.removeEventListener('resize', onResize); ov.remove(); resolve(val); };
    const onResize = () => layout(true);
    window.addEventListener('resize', onResize);
    ov.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'cancel') close(null);
      if (a === 'rot') { src = rotate(src); layout(); }
      if (a === 'reset') { resetRect(); draw(); }
      if (a === 'done') {
        const k = src.width / disp.w;
        const sx = (r.x - disp.x) * k, sy = (r.y - disp.y) * k, sw = r.w * k, shh = r.h * k;
        const s = Math.min(1, max / Math.max(sw, shh));
        const out = document.createElement('canvas'); out.width = Math.round(sw * s); out.height = Math.round(shh * s);
        out.getContext('2d').drawImage(src, sx, sy, sw, shh, 0, 0, out.width, out.height);
        out.toBlob(b => close(b), 'image/jpeg', quality);
      }
    });
    requestAnimationFrame(() => layout());
  });
}
