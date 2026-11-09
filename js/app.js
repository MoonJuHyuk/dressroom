import { LS, LocalStore, makeSheetStore, photoUrl, photoFallback, parseConnect, connectLinkFor, blobToBase64 } from './store.js';
import { lookupModel, readLabel, matchShopping, MODELS } from './ai.js';
import { cropImage } from './crop.js';

const VERSION = '0.2.2';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = v => v !== undefined && v !== null && v !== '';
const money = n => has(n) && Number(n) ? Number(n).toLocaleString('ko-KR') + '원' : '';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------- 카테고리 · 주인 ---------------- */
const CATS = [
  { k: 'hat', ko: '모자', en: 'Hats' },
  { k: 'glasses', ko: '안경', en: 'Eyewear' },
  { k: 'scarf', ko: '목도리', en: 'Scarves' },
  { k: 'tshirt', ko: '티셔츠', en: 'Tees' },
  { k: 'jacket', ko: '자켓', en: 'Jackets' },
  { k: 'watch', ko: '시계', en: 'Watches' },
  { k: 'pants', ko: '바지', en: 'Trousers' },
  { k: 'socks', ko: '양말', en: 'Socks' },
  { k: 'shoes', ko: '신발', en: 'Shoes' },
];
const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));
const catKo = k => CAT[k]?.ko || '기타';
const DEFAULT_OWNERS = { me: '주혁', wife: '모카', both: '공용' };
const OWNER_KEYS = ['me', 'wife', 'both'];
const ownerName = k => (S.cfg.owners || DEFAULT_OWNERS)[k] || DEFAULT_OWNERS[k] || '';

const S = {
  items: [], loaded: false, offline: false,
  owner: LS.get('dr.owner', 'all'), view: 'home', cat: null, q: '', sort: LS.get('dr.sort', 'recent'),
  store: null, conn: null, cfg: {},
};

/* ---------------- 공통 ---------------- */
let toastTm;
function toast(msg, ms = 3000) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTm); toastTm = setTimeout(() => { el.hidden = true; }, ms);
}
function busy(msg) { $('#busyMsg').textContent = msg || ''; $('#busy').hidden = !msg; }
const titleOf = it => it.name || [it.brand, it.color && !it.brand ? it.color : '', catKo(it.category)].filter(has).join(' ') || catKo(it.category);
const subOf = it => [it.name ? it.brand : '', it.color, it.size].filter(has).join(' · ');
const lastTouch = it => it.lastWorn || (it.purchased ? it.purchased + (String(it.purchased).length <= 7 ? '-01' : '') : '') || String(it.created || '').slice(0, 10);
function agoText(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr), n = new Date();
  const m = (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
  if (m <= 0) return '이번 달';
  if (m < 12) return `${m}개월 전`;
  const y = Math.floor(m / 12), r = m % 12;
  return r ? `${y}년 ${r}개월 전` : `${y}년 전`;
}
const idleText = it => it.lastWorn ? `마지막 착용 ${agoText(it.lastWorn)}` : `입은 기록 없음 · ${it.purchased ? '구매 ' + agoText(lastTouch(it)) : '등록 ' + agoText(lastTouch(it))}`;

async function setImg(img, photo, size) {
  const u = await photoUrl(photo, size);
  if (!u) return;
  img.onerror = () => { const f = photoFallback(photo); if (f && img.src !== f) img.src = f; };
  img.src = u;
}
function hydrate(root = document) {
  root.querySelectorAll('img[data-photo]').forEach(img => { if (!img.dataset.done) { img.dataset.done = 1; setImg(img, img.dataset.photo, Number(img.dataset.size) || 600); } });
}
const thumbSize = () => Math.min(900, Math.round(320 * (window.devicePixelRatio || 2)));

/* 사진 줄이기 (긴 변 1600px, JPEG) */
async function shrink(file, max = 1600, q = 0.85) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    src = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}

/* ---------------- 시작 ---------------- */
function readConnFromHash() {
  const href = location.href;
  if (!/connect(=|%3D)/i.test(href)) return;
  const c = parseConnect(href);
  history.replaceState(null, '', location.pathname);
  if (c) { LS.set('dr.conn', c); toast('옷장에 연결했어요'); }
  else toast('연결 링크가 올바르지 않아요');
}
function pickStore() {
  S.conn = LS.get('dr.conn', null);
  S.store = S.conn ? makeSheetStore(S.conn) : LocalStore;
}
async function load() {
  S.offline = false;
  if (S.store.kind === 'sheet') {
    const c = S.store.cached();
    if (c) { S.items = c; S.loaded = true; }
    S.cfg = S.store.cachedConfig() || {};
    render();
    try { S.items = await S.store.list(); } catch (e) { S.offline = true; }
    S.loaded = true;
    S.store.getConfig().then(async c => {
      S.cfg = c;
      // 연결 전에 이 기기에 넣어 둔 API 키·이름이 있으면 시트로 옮겨 두 기기가 같이 쓰게 함
      const lk = LS.get('dr.key', ''), lo = LS.get('dr.owners', null), mv = {};
      if (lk && !c.claudeKey) mv.claudeKey = lk;
      if (lo && !c.owners) mv.owners = lo;
      if (Object.keys(mv).length) { try { S.cfg = await S.store.setConfig(mv); LS.del('dr.key'); LS.del('dr.owners'); toast('이 기기에 넣어 둔 설정을 옷장으로 옮겼어요'); } catch (e) {} }
      else if (lk && c.claudeKey) LS.del('dr.key');
      renderOwners();
    }).catch(() => {});
  } else {
    S.items = await LocalStore.list();
    S.cfg = await LocalStore.getConfig();
    S.loaded = true;
  }
  render();
}

/* ---------------- 화면 이동 ---------------- */
function go(view, cat = null, push = true) {
  S.view = view; S.cat = cat;
  if (push) history.pushState({ view, cat }, '');
  window.scrollTo(0, 0);
  render();
}
window.addEventListener('popstate', e => {
  if (!$('#overlay').hidden) { closeSheet(false); return; }
  const st = e.state || {};
  S.view = st.view || 'home'; S.cat = st.cat || null;
  render();
});

/* ---------------- 목록 ---------------- */
// 내 옷 / 와이프 옷을 볼 때 '공용'도 같이 보여 줌
const mine = () => S.items.filter(it => S.owner === 'all' || it.owner === S.owner || (S.owner !== 'both' && it.owner === 'both'));
function matchesQ(it, q) {
  return [it.name, it.brand, it.model, it.color, it.material, it.size, it.note, catKo(it.category)].join(' ').toLowerCase().includes(q);
}
const SORTS = [
  ['recent', '최근 등록순', (a, b) => String(b.created || '').localeCompare(String(a.created || ''))],
  ['idle', '오래 안 입은 순', (a, b) => String(lastTouch(a)).localeCompare(String(lastTouch(b)))],
  ['brand', '브랜드순', (a, b) => String(a.brand || '힣').localeCompare(String(b.brand || '힣'), 'ko')],
  ['price', '금액 높은순', (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)],
  ['color', '색상순', (a, b) => String(a.color || '힣').localeCompare(String(b.color || '힣'), 'ko')],
];
const sortFn = k => (SORTS.find(s => s[0] === k) || SORTS[0])[2];

function renderOwners() {
  const opts = [['all', '전체'], ...OWNER_KEYS.map(k => [k, ownerName(k)])];
  $('#owners').innerHTML = opts.map(([k, l]) => `<button data-o="${k}" aria-pressed="${S.owner === k}">${esc(l)}</button>`).join('');
}

function render() {
  const v = S.view, list = mine();
  $('#backBtn').hidden = v === 'home';
  $('#brand').classList.toggle('inner', v !== 'home');
  const total = list.length;
  if (v === 'home') {
    $('#title').textContent = 'Dressroom';
    $('#sub').textContent = S.loaded ? `${S.owner === 'all' ? '우리집' : ownerName(S.owner)} 옷장 · ${total}벌` : ' ';
  } else if (v === 'cat') {
    $('#title').textContent = CAT[S.cat]?.en || '';
    $('#sub').textContent = `${catKo(S.cat)} · ${list.filter(i => i.category === S.cat).length}개`;
  } else if (v === 'idle') {
    $('#title').textContent = 'Forgotten';
    $('#sub').textContent = '오래 손이 안 간 옷';
  }
  $('#sort').hidden = v !== 'cat';
  $('#sort').innerHTML = SORTS.map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('');
  $('#fab').hidden = false;

  const ban = $('#banner');
  if (S.offline) { ban.hidden = false; ban.innerHTML = '<span>인터넷 연결이 없어 마지막으로 받은 목록을 보여드려요.</span>'; }
  else if (S.store.kind === 'local') { ban.hidden = false; ban.innerHTML = '<span>아직 구글시트에 연결되지 않아 이 기기에만 저장돼요.</span><button class="btn sm" id="banSet">연결하기</button>'; $('#banSet').onclick = openSettings; }
  else ban.hidden = true;

  const q = S.q.trim().toLowerCase();
  const box = $('#view');
  if (q) box.innerHTML = gridHTML(list.filter(it => matchesQ(it, q)).sort(sortFn('recent')), `검색 결과`);
  else if (v === 'cat') box.innerHTML = gridHTML(list.filter(it => it.category === S.cat).sort(sortFn(S.sort)), null, true);
  else if (v === 'idle') box.innerHTML = idleHTML(list);
  else box.innerHTML = homeHTML(list);
  hydrate(box);
}

function homeHTML(list) {
  if (!S.loaded) return '<div class="empty">불러오는 중…</div>';
  const tiles = CATS.map(c => {
    const its = list.filter(i => i.category === c.k).sort(sortFn('recent'));
    const cover = its.find(i => i.photos?.length);
    return `<button class="tile" data-cat="${c.k}">
      <span class="ph">${cover ? `<img data-photo="${esc(cover.photos[0])}" data-size="${thumbSize()}" alt="">` : `<span class="ph-empty">${c.en.charAt(0)}</span>`}</span>
      <span class="cap"><span class="en">${c.en}</span><span class="ko">${c.ko}</span><span class="n">${its.length}</span></span>
    </button>`;
  }).join('');
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const idle = list.filter(i => new Date(lastTouch(i)) < yearAgo).length;
  return `<section class="tiles">${tiles}</section>
    <section class="cards">
      <button class="feature" id="goMatch">
        <span class="kicker">In the shop</span>
        <span class="h">매장에서 비교하기</span>
        <span class="p">사고 싶은 옷을 찍으면 집에 있는 비슷한 옷과 어울리는 옷을 찾아드려요.</span>
      </button>
      <button class="feature alt" id="goIdle">
        <span class="kicker">Forgotten</span>
        <span class="h">오래 손이 안 간 옷 <b>${idle}</b></span>
        <span class="p">1년 넘게 입은 기록이 없는 옷을 모아 봐요.</span>
      </button>
    </section>`;
}

function cardHTML(it, extra = '') {
  const p = it.photos?.[0];
  return `<button class="card" data-id="${esc(it.id)}">
    <span class="ph">${p ? `<img data-photo="${esc(p)}" data-size="${thumbSize()}" alt="">` : `<span class="ph-empty">${esc((CAT[it.category]?.en || '?').charAt(0))}</span>`}
      ${S.owner === 'all' && it.owner ? `<span class="who">${esc(ownerName(it.owner))}</span>` : ''}</span>
    <span class="t">${esc(titleOf(it))}</span>
    <span class="s">${esc(extra || subOf(it)) || '&nbsp;'}</span>
  </button>`;
}
function gridHTML(items, heading, inCat) {
  if (!items.length) return `<div class="empty">${inCat ? `아직 등록된 ${esc(catKo(S.cat))}이(가) 없어요.<br>아래 <b>등록</b>을 눌러 사진을 찍어 보세요.` : '찾는 옷이 없어요.'}</div>`;
  return `${heading ? `<h2 class="sec">${esc(heading)} <span>${items.length}</span></h2>` : ''}<div class="grid">${items.map(it => cardHTML(it)).join('')}</div>`;
}
function idleHTML(list) {
  const items = [...list].sort(sortFn('idle'));
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const old = items.filter(i => new Date(lastTouch(i)) < yearAgo), rest = items.filter(i => !(new Date(lastTouch(i)) < yearAgo));
  return `<p class="lead">옷을 입은 날 상세 화면에서 <b>오늘 입었어요</b>를 누르면 이 목록이 정확해져요.</p>
    ${old.length ? `<h2 class="sec">1년 넘게 안 입은 옷 <span>${old.length}</span></h2><div class="grid">${old.map(it => cardHTML(it, idleText(it))).join('')}</div>` : '<div class="empty">1년 넘게 안 입은 옷이 없어요.</div>'}
    ${rest.length ? `<h2 class="sec">그 밖의 옷 (오래된 순) <span>${rest.length}</span></h2><div class="grid">${rest.map(it => cardHTML(it, idleText(it))).join('')}</div>` : ''}`;
}

/* ---------------- 시트(팝업) ---------------- */
function openSheet(html, cls = '') {
  const sh = $('#sheet');
  sh.className = 'sheet ' + cls;
  sh.innerHTML = html;
  $('#overlay').hidden = false;
  document.body.classList.add('locked');
  if (!history.state?.sheet) history.pushState({ ...(history.state || {}), sheet: 1 }, '');
  sh.scrollTop = 0;
  hydrate(sh);
  return sh;
}
function closeSheet(viaHistory = true) {
  $('#overlay').hidden = true;
  document.body.classList.remove('locked');
  $('#sheet').innerHTML = '';
  if (viaHistory && history.state?.sheet) history.back();
}
$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeSheet(); });
const sheetHead = (title, kicker = '') => `<div class="shead"><div>${kicker ? `<div class="kicker">${kicker}</div>` : ''}<h2>${title}</h2></div><button class="x" data-close aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
$('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

/* ---------------- 상세 ---------------- */
function openDetail(id) {
  const it = S.items.find(i => String(i.id) === String(id));
  if (!it) return;
  const rows = [
    ['주인', ownerName(it.owner)], ['종류', catKo(it.category)], ['브랜드', it.brand], ['모델명', it.model],
    ['색상', it.color], ['소재', it.material], ['사이즈', it.size], ['구매시기', it.purchased ? String(it.purchased).replace('-', '년 ') + (String(it.purchased).length === 7 ? '월' : '') : ''],
    ['금액', money(it.price)], ['마지막 착용', it.lastWorn ? `${it.lastWorn} (${agoText(it.lastWorn)})` : '기록 없음'],
    ['입은 횟수', Number(it.wornCount) ? it.wornCount + '번' : ''],
  ].filter(r => has(r[1]));
  const photos = it.photos || [];
  const srcs = String(it.sources || '').split(/\s+/).filter(u => /^https?:\/\//.test(u));
  const sh = openSheet(`${sheetHead(esc(titleOf(it)), esc(CAT[it.category]?.en || ''))}
    ${photos.length ? `<div class="gallery">${photos.map(p => `<img data-photo="${esc(p)}" data-size="1400" alt="">`).join('')}</div>${photos.length > 1 ? `<div class="dots">${photos.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}` : ''}
    <dl class="specs">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${it.note ? `<div class="note">${esc(it.note).replace(/\n/g, '<br>')}</div>` : ''}
    ${srcs.length ? `<div class="srcs">정보 출처 ${srcs.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}</div>` : ''}
    <div class="actions">
      <button class="btn primary" id="wornBtn">${it.lastWorn === today() ? '오늘 입은 걸로 기록됨' : '오늘 입었어요'}</button>
      <button class="btn" id="editBtn">수정</button>
      <button class="btn ghost danger" id="delBtn">삭제</button>
    </div>`, 'detail');
  const g = sh.querySelector('.gallery');
  if (g && photos.length > 1) g.addEventListener('scroll', () => {
    const i = Math.round(g.scrollLeft / g.clientWidth);
    sh.querySelectorAll('.dots i').forEach((d, j) => d.classList.toggle('on', i === j));
  }, { passive: true });
  $('#wornBtn').onclick = async () => {
    if (it.lastWorn === today()) return;
    await saveItem({ ...it, lastWorn: today(), wornCount: (Number(it.wornCount) || 0) + 1 }, [], '기록하는 중…');
    toast('오늘 입은 걸로 기록했어요');
    openDetailReplace(it.id);
  };
  $('#editBtn').onclick = () => openForm(it);
  $('#delBtn').onclick = async () => {
    if (!confirm(`'${titleOf(it)}'을(를) 삭제할까요? 사진도 같이 지워져요.`)) return;
    busy('삭제하는 중…');
    try { await S.store.remove(it.id); S.items = S.items.filter(i => i.id !== it.id); closeSheet(); render(); toast('삭제했어요'); }
    catch (e) { toast('삭제하지 못했어요: ' + e.message); }
    finally { busy(''); }
  };
}
function openDetailReplace(id) { openDetail(id); }

/* ---------------- 저장 ---------------- */
async function saveItem(item, newBlobs, msg = '저장하는 중…') {
  busy(msg);
  try {
    const saved = await S.store.save(item, newBlobs);
    const i = S.items.findIndex(x => String(x.id) === String(saved.id));
    if (i >= 0) S.items[i] = saved; else S.items.push(saved);
    if (S.store.kind === 'sheet') LS.set('dr.cache', S.items);
    render();
    return saved;
  } catch (e) {
    toast('저장하지 못했어요: ' + e.message, 5000);
    throw e;
  } finally { busy(''); }
}

/* ---------------- 등록 · 수정 ---------------- */
function openForm(orig = null, preset = {}) {
  const it = orig ? { ...orig } : { owner: S.owner !== 'all' ? S.owner : LS.get('dr.lastOwner', 'me'), category: S.view === 'cat' ? S.cat : '', ...preset };
  let kept = [...(it.photos || [])];
  let fresh = (preset._blobs || []).map(b => ({ b, u: URL.createObjectURL(b) }));
  const f = (k, label, attrs = '') => `<label class="fld"><span>${label}</span><input name="${k}" value="${esc(it[k] ?? '')}" ${attrs}></label>`;
  const sh = openSheet(`${sheetHead(orig ? '옷 정보 수정' : '새 옷 등록', orig ? 'Edit' : 'New piece')}
    <div class="photos" id="photos"></div>
    <div class="photobtns">
      <label class="btn"><input type="file" accept="image/*" capture="environment" id="camIn" hidden>사진 찍기</label>
      <label class="btn"><input type="file" accept="image/*" multiple id="albIn" hidden>앨범에서 불러오기</label>
    </div>
    <form id="form" autocomplete="off">
      <div class="fld"><span>종류</span><div class="chips" id="catChips">${CATS.map(c => `<button type="button" data-v="${c.k}" aria-pressed="${it.category === c.k}">${c.ko}</button>`).join('')}</div></div>
      <div class="fld"><span>주인</span><div class="chips" id="ownChips">${OWNER_KEYS.map(k => `<button type="button" data-v="${k}" aria-pressed="${it.owner === k}">${esc(ownerName(k))}</button>`).join('')}</div></div>
      <div class="two">${f('brand', '브랜드')}${f('model', '모델명', 'placeholder="알면 적고 → 정보 찾기"')}</div>
      <div class="lookup">
        <label class="btn sm"><input type="file" accept="image/*" capture="environment" id="labelIn" hidden>라벨 찍어서 찾기</label>
        <button type="button" class="btn sm" id="lookBtn">모델명으로 찾기</button>
        <span class="hint">빈 칸에 넣을 내용을 제안만 해요</span>
      </div>
      <div id="sugg"></div>
      ${f('name', '이름(별칭)', 'placeholder="예: 네이비 울 코트"')}
      <div class="two">${f('color', '색상')}${f('material', '소재')}</div>
      <div class="two">${f('size', '사이즈')}${f('purchased', '구매시기', 'type="month"')}</div>
      <div class="two">${f('price', '금액(원)', 'inputmode="numeric"')}${f('lastWorn', '마지막으로 입은 날', 'type="date"')}</div>
      <label class="fld"><span>기타 메모</span><textarea name="note" rows="3">${esc(it.note || '')}</textarea></label>
      <input type="hidden" name="sources" value="${esc(it.sources || '')}">
      <div class="actions sticky"><button type="button" class="btn ghost" data-close>취소</button><button type="submit" class="btn primary">저장</button></div>
    </form>`, 'form');

  const drawPhotos = () => {
    const box = sh.querySelector('#photos');
    box.innerHTML = kept.map((p, i) => `<span class="pp"><img data-photo="${esc(p)}" data-size="400" alt=""><button type="button" data-rk="${i}" aria-label="사진 빼기">×</button><button type="button" class="cut" data-ck="${i}" aria-label="사진 자르기">✂</button></span>`).join('')
      + fresh.map((x, i) => `<span class="pp"><img src="${x.u}" alt=""><button type="button" data-rf="${i}" aria-label="사진 빼기">×</button><button type="button" class="cut" data-cf="${i}" aria-label="사진 자르기">✂</button></span>`).join('')
      + (kept.length + fresh.length ? '' : '<span class="pp none">사진을 찍거나 불러오세요<br><small>여러 장 가능</small></span>');
    hydrate(box);
  };
  drawPhotos();
  sh.querySelector('#photos').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.rk !== undefined) { kept.splice(Number(d.rk), 1); drawPhotos(); }
    if (d.rf !== undefined) { URL.revokeObjectURL(fresh[d.rf].u); fresh.splice(Number(d.rf), 1); drawPhotos(); }
    if (d.cf !== undefined) {
      const i = Number(d.cf), b = await cropImage(fresh[i].b);
      if (b) { URL.revokeObjectURL(fresh[i].u); fresh[i] = { b, u: URL.createObjectURL(b) }; drawPhotos(); }
    }
    if (d.ck !== undefined) {
      // 이미 저장된 사진: 원본을 받아 자르고, 자른 사진으로 바꿔 저장 (원래 사진은 저장할 때 정리됨)
      const i = Number(d.ck);
      busy('사진을 불러오는 중…');
      let src = null;
      try { const t = (await S.store.thumbs([kept[i]], 1600))[0]; if (t) src = await (await fetch(`data:${t.type};base64,${t.data}`)).blob(); }
      catch (err) {} finally { busy(''); }
      if (!src) { toast('사진을 불러오지 못했어요'); return; }
      const b = await cropImage(src);
      if (b) { kept.splice(i, 1); fresh.unshift({ b, u: URL.createObjectURL(b) }); drawPhotos(); toast('저장을 누르면 자른 사진으로 바뀌어요'); }
    }
  });
  const addFiles = async (files, offerCrop = false) => {
    for (const file of files) {
      try {
        let b = await shrink(file);
        if (offerCrop) { const c = await cropImage(b); if (c) b = c; } // 취소하면 전체 사진 그대로
        fresh.push({ b, u: URL.createObjectURL(b) });
      } catch (e) { toast('사진을 읽지 못했어요'); }
    }
    drawPhotos();
  };
  sh.querySelector('#camIn').onchange = e => { addFiles([...e.target.files], true); e.target.value = ''; };
  sh.querySelector('#albIn').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };

  const chipGroup = (sel, key) => sh.querySelector(sel).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    it[key] = b.dataset.v;
    sh.querySelectorAll(sel + ' button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  chipGroup('#catChips', 'category'); chipGroup('#ownChips', 'owner');

  const form = sh.querySelector('#form');
  sh.querySelector('#lookBtn').onclick = () => runLookup(form, it, sh);
  // 라벨(택) 사진: 글자를 읽고 검색해 제안. 라벨 사진은 옷 사진 맨 뒤에도 넣어 둠
  sh.querySelector('#labelIn').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    let b; try { b = await shrink(file, 2000, 0.9); } catch (err) { toast('사진을 읽지 못했어요'); return; }
    const c = await cropImage(b); if (c) b = c; // 라벨 부분만 남기면 더 잘 읽어요
    fresh.push({ b, u: URL.createObjectURL(b) }); drawPhotos();
    runLookup(form, it, sh, b);
  };

  form.onsubmit = async e => {
    e.preventDefault();
    if (!it.category) { toast('종류를 골라 주세요'); return; }
    const fd = new FormData(form), o = { ...it };
    ['brand', 'model', 'name', 'color', 'material', 'size', 'purchased', 'lastWorn', 'note', 'sources'].forEach(k => { const v = String(fd.get(k) || '').trim(); o[k] = v || null; });
    const pr = String(fd.get('price') || '').replace(/[^\d]/g, '');
    o.price = pr ? Number(pr) : null;
    o.photos = kept;
    delete o._blobs;
    LS.set('dr.lastOwner', o.owner);
    try {
      const saved = await saveItem(o, fresh.map(x => x.b), fresh.length ? `사진 ${fresh.length}장과 함께 저장하는 중…` : '저장하는 중…');
      fresh.forEach(x => URL.revokeObjectURL(x.u));
      toast(orig ? '수정했어요' : '옷장에 넣었어요');
      openDetail(saved.id);
    } catch (e) {}
  };
}

/* 모델명 → 정보 찾기: 빈 칸에 넣을 값만 제안, 적용은 사용자가 */
async function runLookup(form, it, sh, labelBlob = null) {
  const modelName = form.model.value.trim();
  if (!labelBlob && !modelName) { toast('모델명을 먼저 적거나, 라벨을 찍어 주세요'); form.model.focus(); return; }
  if (!S.cfg.claudeKey) { toast('설정에서 Claude API 키를 먼저 넣어 주세요', 4000); return; }
  const box = sh.querySelector('#sugg'), btn = sh.querySelector('#lookBtn');
  btn.disabled = true; box.innerHTML = `<div class="sugg loading"><div class="spin sm"></div>${labelBlob ? '라벨을 읽고 검색하는 중… (20~40초)' : '검색하는 중… (10~30초)'}</div>`;
  try {
    const common = { key: S.cfg.claudeKey, model: S.cfg.model, brand: form.brand.value.trim(), category: it.category, categories: CATS.map(c => c.k) };
    const r = labelBlob
      ? await readLabel({ ...common, imageBase64: await blobToBase64(labelBlob), modelName })
      : await lookupModel({ ...common, modelName });
    const cand = [
      ['brand', '브랜드', r.brand], ['model', '모델명', labelBlob ? r.model : null], ['name', '이름(별칭)', r.name], ['color', '색상', r.color], ['material', '소재', r.material], ['size', '사이즈', r.size],
      ['price', '금액(원) · 출시가', r.releasePrice ? String(r.releasePrice) : null, r.releasePriceText],
      ['category', '종류', r.category && CAT[r.category] ? r.category : null],
    ].filter(c => has(c[2]));
    if (!cand.length) { box.innerHTML = `<div class="sugg"><p>${labelBlob ? '라벨에서 확실한 정보를 읽지 못했어요. 글자가 잘 보이게 가까이서 다시 찍어 보세요.' : '이 모델명으로 확실한 정보를 찾지 못했어요. 직접 입력해 주세요.'}</p></div>`; return; }
    const cur = k => k === 'category' ? it.category : form[k].value.trim();
    box.innerHTML = `<div class="sugg"><div class="sh">찾은 정보 <small>맞는 것만 적용하세요</small></div>
      ${cand.map(([k, l, v, extra]) => `<div class="srow"><span class="l">${l}</span><span class="v">${esc(k === 'category' ? catKo(v) : k === 'price' ? Number(v).toLocaleString('ko-KR') + '원' : v)}${extra ? ` <small>(${esc(extra)})</small>` : ''}${has(cur(k)) ? ' <small class="kept">· 입력값 있음</small>' : ''}</span><button type="button" class="btn sm" data-ap="${k}">적용</button></div>`).join('')}
      ${r.labelText ? `<p class="sum"><b>라벨에서 읽은 글자</b> ${esc(r.labelText)}</p>` : ''}
      ${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ''}
      ${r.sources?.length ? `<div class="srcs">출처 ${r.sources.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}</div>` : ''}
      <div class="sbtns"><button type="button" class="btn sm primary" id="apEmpty">빈 칸에만 모두 적용</button><button type="button" class="btn sm ghost" id="apClose">닫기</button></div></div>`;
    const apply = k => {
      const v = cand.find(c => c[0] === k)[2];
      if (k === 'category') { it.category = v; sh.querySelectorAll('#catChips button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v)); }
      else form[k].value = v;
      if (r.sources?.length) form.sources.value = r.sources.join(' ');
    };
    box.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => { apply(b.dataset.ap); b.textContent = '적용됨'; b.disabled = true; });
    box.querySelector('#apEmpty').onclick = () => { cand.forEach(([k]) => { if (!has(cur(k))) apply(k); }); box.innerHTML = ''; toast('빈 칸에 적용했어요. 확인 후 저장하세요'); };
    box.querySelector('#apClose').onclick = () => { box.innerHTML = ''; };
  } catch (e) {
    box.innerHTML = `<div class="sugg"><p>정보를 찾지 못했어요: ${esc(e.message === 'NO_KEY' ? 'API 키가 없어요' : e.message)}</p></div>`;
  } finally { btn.disabled = false; }
}

/* ---------------- 매장에서 비교 ---------------- */
function openMatch() {
  let blob = null, url = null, cat = '';
  const sh = openSheet(`${sheetHead('매장에서 비교하기', 'In the shop')}
    <p class="lead">사고 싶은 옷을 찍고 종류를 고르면, 집에 있는 같은 종류를 바로 보여드려요. <b>AI로 비교</b>를 누르면 비슷한 옷과 같이 입기 좋은 옷을 골라줘요.</p>
    <div class="mphoto" id="mphoto"><span>사진을 찍어 주세요</span></div>
    <div class="photobtns">
      <label class="btn primary"><input type="file" accept="image/*" capture="environment" id="mCam" hidden>사진 찍기</label>
      <label class="btn"><input type="file" accept="image/*" id="mAlb" hidden>앨범</label>
    </div>
    <div class="fld"><span>어떤 종류인가요?</span><div class="chips" id="mCats">${CATS.map(c => `<button type="button" data-v="${c.k}" aria-pressed="false">${c.ko}</button>`).join('')}</div></div>
    <div id="mSame"></div>
    <div class="actions"><button class="btn primary" id="mRun" disabled>AI로 비교</button></div>
    <div id="mOut"></div>`, 'match');
  const refresh = () => {
    sh.querySelector('#mRun').disabled = !(blob && cat);
    const same = mine().filter(i => i.category === cat).sort(sortFn('recent'));
    sh.querySelector('#mSame').innerHTML = cat ? (same.length ? `<h3 class="sec">집에 있는 ${esc(catKo(cat))} <span>${same.length}</span></h3><div class="grid sm">${same.map(i => cardHTML(i)).join('')}</div>` : `<div class="empty sm">집에 등록된 ${esc(catKo(cat))}이(가) 없어요. 겹칠 걱정은 없어요.</div>`) : '';
    hydrate(sh.querySelector('#mSame'));
  };
  const setPhoto = async file => {
    try {
      blob = await shrink(file, 1280, 0.82);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      sh.querySelector('#mphoto').innerHTML = `<img src="${url}" alt=""><button type="button" class="btn sm light cutbig" id="mCut">✂ 자르기</button>`;
      sh.querySelector('#mCut').onclick = async () => { const c = await cropImage(blob, { max: 1280, quality: 0.82 }); if (c) { blob = c; URL.revokeObjectURL(url); url = URL.createObjectURL(blob); sh.querySelector('#mphoto img').src = url; } };
      refresh();
    } catch (e) { toast('사진을 읽지 못했어요'); }
  };
  sh.querySelector('#mCam').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    await setPhoto(f);
    if (blob) { const c = await cropImage(blob, { max: 1280, quality: 0.82 }); if (c) { blob = c; URL.revokeObjectURL(url); url = URL.createObjectURL(blob); sh.querySelector('#mphoto img').src = url; } }
  };
  sh.querySelector('#mAlb').onchange = e => { e.target.files[0] && setPhoto(e.target.files[0]); e.target.value = ''; };
  sh.querySelector('#mCats').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.v; sh.querySelectorAll('#mCats button').forEach(x => x.setAttribute('aria-pressed', x === b)); refresh();
  });
  sh.querySelector('#mSame').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); });
  sh.querySelector('#mRun').onclick = async () => {
    if (!S.cfg.claudeKey) { toast('설정에서 Claude API 키를 먼저 넣어 주세요', 4000); return; }
    const out = sh.querySelector('#mOut'), run = sh.querySelector('#mRun');
    run.disabled = true;
    out.innerHTML = '<div class="sugg loading"><div class="spin sm"></div>집 옷 사진을 모으고 비교하는 중… (20~40초)</div>';
    try {
      const pool = mine().filter(i => i.photos?.length);
      const same = pool.filter(i => i.category === cat).sort(sortFn('recent')).slice(0, 14);
      const others = [];
      const byCat = CATS.filter(c => c.k !== cat).map(c => pool.filter(i => i.category === c.k).sort(sortFn('recent')));
      for (let r = 0; others.length < 16 && byCat.some(l => l.length > r); r++) byCat.forEach(l => { if (l[r] && others.length < 16) others.push(l[r]); });
      const pick = [...same, ...others];
      if (!pick.length) { out.innerHTML = '<div class="sugg"><p>비교할 집 옷 사진이 아직 없어요. 옷을 먼저 등록해 주세요.</p></div>'; return; }
      const thumbs = await S.store.thumbs(pick.map(i => i.photos[0]), 320);
      const tmap = Object.fromEntries(thumbs.map(t => [t.id, t]));
      const owned = pick.map(i => ({ id: i.id, label: [catKo(i.category), i.brand, i.color, i.material, i.name].filter(has).join(' / '), thumb: tmap[i.photos[0]] }));
      const r = await matchShopping({ key: S.cfg.claudeKey, model: S.cfg.model, photo: await blobToBase64(blob), photoType: 'image/jpeg', catLabel: catKo(cat), owned });
      const row = x => { const it = S.items.find(i => String(i.id) === String(x.id)); return it ? `<button class="mrow card-like" data-id="${esc(it.id)}"><span class="ph">${it.photos?.[0] ? `<img data-photo="${esc(it.photos[0])}" data-size="300" alt="">` : ''}</span><span><b>${esc(titleOf(it))}</b><small>${esc(x.reason)}</small></span></button>` : ''; };
      out.innerHTML = `<div class="verdict">${esc(r.verdict)}</div>
        <h3 class="sec">비슷한 옷 <span>${r.similar.length}</span></h3>${r.similar.length ? r.similar.map(row).join('') : '<div class="empty sm">비슷한 옷은 없어 보여요.</div>'}
        <h3 class="sec">같이 입기 좋은 옷 <span>${r.pairs.length}</span></h3>${r.pairs.length ? r.pairs.map(row).join('') : '<div class="empty sm">추천할 조합을 찾지 못했어요.</div>'}
        <div class="actions"><button class="btn" id="mBuy">샀어요 → 옷장에 등록</button></div>`;
      hydrate(out);
      out.querySelectorAll('.mrow').forEach(b => b.onclick = () => openDetail(b.dataset.id));
      out.querySelector('#mBuy').onclick = () => openForm(null, { category: cat, _blobs: [blob], purchased: today().slice(0, 7) });
    } catch (e) {
      out.innerHTML = `<div class="sugg"><p>비교하지 못했어요: ${esc(e.message)}</p></div>`;
    } finally { run.disabled = !(blob && cat); }
  };
}

/* ---------------- 설정 ---------------- */
function openSettings() {
  const conn = S.store.kind === 'sheet';
  const owners = S.cfg.owners || DEFAULT_OWNERS;
  const sh = openSheet(`${sheetHead('설정', 'Settings')}
    <section class="set">
      <h3>연결</h3>
      ${conn ? `<p>구글시트 <b>Dressroom</b>에 연결돼 있어요. 두 분 폰이 같은 옷장을 봐요.</p>
        <div class="row-btns"><button class="btn" id="copyLink">다른 기기 연결 링크 ${navigator.share ? '보내기' : '복사'}</button>
        ${S.cfg.sheetUrl ? `<a class="btn ghost" href="${esc(S.cfg.sheetUrl)}" target="_blank" rel="noopener">시트 열기</a>` : ''}</div>
        <p class="hint">와이프 폰 등 다른 기기에서 이 링크를 한 번 열면 연결돼요. 가족 외에는 보내지 마세요.</p>`
      : `<p>연결 링크를 붙여넣으면 구글시트 옷장에 연결돼요.</p>
        <label class="fld"><textarea id="connIn" rows="3" placeholder="https://…#connect=…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></label>
        <div class="row-btns">${navigator.clipboard?.readText ? '<button class="btn" id="pasteBtn">복사한 링크 붙여넣기</button>' : ''}<button class="btn primary" id="connBtn">연결</button></div>`}
    </section>
    <section class="set">
      <h3>주인 이름</h3>
      <div class="three">${OWNER_KEYS.map(k => `<label class="fld"><span>${k === 'both' ? '함께' : k === 'me' ? '나' : '배우자'}</span><input data-own="${k}" value="${esc(owners[k] || '')}"></label>`).join('')}</div>
      <button class="btn sm" id="ownSave">이름 저장</button>
    </section>
    <section class="set">
      <h3>AI (모델명 찾기 · 매장 비교)</h3>
      <label class="fld"><span>Claude API 키 ${conn ? '(두 기기가 같이 써요)' : ''}</span><input id="keyIn" type="password" placeholder="${S.cfg.claudeKey ? '저장됨 · 바꾸려면 새로 입력' : 'sk-ant-…'}" autocomplete="off"></label>
      <label class="fld"><span>모델</span><select id="modelIn">
        <option value="${MODELS.sonnet}" ${S.cfg.model !== MODELS.haiku ? 'selected' : ''}>Sonnet (정확)</option>
        <option value="${MODELS.haiku}" ${S.cfg.model === MODELS.haiku ? 'selected' : ''}>Haiku (빠르고 저렴)</option></select></label>
      <div class="row-btns"><button class="btn sm" id="keySave">저장</button>${S.cfg.claudeKey ? '<button class="btn sm ghost danger" id="keyDel">키 지우기</button>' : ''}</div>
    </section>
    <section class="set">
      <h3>앱</h3>
      <div class="row-btns"><button class="btn sm" id="reload">새로고침</button>${conn ? '<button class="btn sm ghost danger" id="disc">이 기기 연결 끊기</button>' : ''}</div>
      <p class="hint">Dressroom v${VERSION}</p>
    </section>`, 'settings');
  const q = s => sh.querySelector(s);
  if (conn) q('#copyLink').onclick = async () => {
    const link = connectLinkFor(S.conn);
    if (navigator.share) { try { await navigator.share({ title: 'Dressroom 연결', text: '이 링크를 열면 우리집 옷장에 연결돼요', url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); toast('링크를 복사했어요'); } catch (e) { prompt('이 링크를 복사하세요', link); }
  };
  if (!conn && q('#pasteBtn')) q('#pasteBtn').onclick = async () => {
    try { q('#connIn').value = await navigator.clipboard.readText(); q('#connBtn').click(); }
    catch (e) { toast('붙여넣기 권한이 없어요. 입력칸을 길게 눌러 붙여넣어 주세요', 5000); }
  };
  if (!conn) q('#connBtn').onclick = () => {
    const raw = q('#connIn').value;
    const c = parseConnect(raw);
    if (!c) { const r = raw.trim(); toast(`연결 링크가 올바르지 않아요 (${r.length}자 · "${r.slice(0, 32)}…")`, 7000); return; }
    LS.set('dr.conn', c); pickStore(); closeSheet(); load(); toast('연결했어요');
  };
  q('#ownSave').onclick = async () => {
    const o = {}; sh.querySelectorAll('[data-own]').forEach(i => { o[i.dataset.own] = i.value.trim() || DEFAULT_OWNERS[i.dataset.own]; });
    try { S.cfg = await S.store.setConfig({ owners: o }); renderOwners(); render(); toast('저장했어요'); } catch (e) { toast('저장하지 못했어요: ' + e.message); }
  };
  q('#keySave').onclick = async () => {
    const c = { model: q('#modelIn').value }; const k = q('#keyIn').value.trim(); if (k) c.claudeKey = k;
    try { S.cfg = await S.store.setConfig(c); toast('저장했어요'); closeSheet(); } catch (e) { toast('저장하지 못했어요: ' + e.message); }
  };
  q('#keyDel') && (q('#keyDel').onclick = async () => { if (!confirm('API 키를 지울까요?')) return; S.cfg = await S.store.setConfig({ claudeKey: '' }); closeSheet(); toast('지웠어요'); });
  q('#reload').onclick = () => location.reload();
  q('#disc') && (q('#disc').onclick = () => { if (!confirm('이 기기의 연결을 끊을까요? (시트의 데이터는 그대로예요)')) return; LS.del('dr.conn'); LS.del('dr.cache'); LS.del('dr.sheetcfg'); location.reload(); });
}

/* ---------------- 이벤트 ---------------- */
$('#owners').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.owner = b.dataset.o; LS.set('dr.owner', S.owner); renderOwners(); render();
});
$('#view').addEventListener('click', e => {
  const tile = e.target.closest('.tile'); if (tile) { go('cat', tile.dataset.cat); return; }
  const card = e.target.closest('.card'); if (card) { openDetail(card.dataset.id); return; }
  if (e.target.closest('#goMatch')) openMatch();
  if (e.target.closest('#goIdle')) go('idle');
});
$('#backBtn').onclick = () => { if (history.state?.view && history.state.view !== 'home') history.back(); else go('home', null, false); };
$('#setBtn').onclick = openSettings;
$('#fab').onclick = () => openForm();
$('#q').addEventListener('input', e => { S.q = e.target.value; render(); });
$('#sort').addEventListener('change', e => { S.sort = e.target.value; LS.set('dr.sort', S.sort); render(); });

/* ---------------- 실행 ---------------- */
readConnFromHash();
pickStore();
history.replaceState({ view: 'home' }, '');
renderOwners();
render();
load();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
  reg.update().catch(() => {});
  reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'activated' && navigator.serviceWorker.controller && !sessionStorage.getItem('dr.reloaded')) { sessionStorage.setItem('dr.reloaded', '1'); location.reload(); } }); });
}).catch(() => {});
