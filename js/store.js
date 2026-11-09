// 저장소: 구글시트(Apps Script) 또는 이 기기(IndexedDB)
export const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* ---------- IndexedDB ---------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((ok, no) => {
    const r = indexedDB.open('dressroom', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('items'); r.result.createObjectStore('photos'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((ok, no) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => no(t.error);
  });
}
const idbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
const idbAll = st => tx(st, 'readonly', s => s.getAll());
const idbPut = (st, k, v) => tx(st, 'readwrite', s => { s.put(v, k); });
const idbDel = (st, k) => tx(st, 'readwrite', s => { s.delete(k); });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- 이 기기에만 저장 (연결 전) ---------- */
export const LocalStore = {
  kind: 'local',
  async list() { return (await idbAll('items')) || []; },
  async save(item, newBlobs = []) {
    const now = new Date().toISOString();
    const prev = item.id ? await idbGet('items', item.id) : null;
    const prevPhotos = prev?.photos || [];
    const keep = Array.isArray(item.photos) ? item.photos.filter(p => prevPhotos.includes(p)) : prevPhotos;
    for (const p of prevPhotos) if (!keep.includes(p)) await idbDel('photos', p);
    const added = [];
    for (const b of newBlobs) {
      const k = 'local:' + uid();
      await idbPut('photos', k, { buf: await b.arrayBuffer(), type: b.type || 'image/jpeg' });
      added.push(k);
    }
    const o = { ...item, id: item.id || uid(), photos: keep.concat(added), created: prev?.created || now, updated: now };
    await idbPut('items', o.id, o);
    return o;
  },
  async remove(id) {
    const prev = await idbGet('items', id);
    for (const p of prev?.photos || []) await idbDel('photos', p);
    await idbDel('items', id);
    return true;
  },
  async thumbs(ids) {
    const out = [];
    for (const id of ids) {
      const b = await idbGet('photos', id).catch(() => null);
      if (b) out.push({ id, type: b.type, data: await blobToBase64(new Blob([b.buf], { type: b.type })) });
    }
    return out;
  },
  async getConfig() { return { claudeKey: LS.get('dr.key', ''), model: LS.get('dr.model', ''), owners: LS.get('dr.owners', null) }; },
  async setConfig(c) {
    if ('claudeKey' in c) LS.set('dr.key', c.claudeKey || '');
    if ('model' in c) LS.set('dr.model', c.model || '');
    if ('owners' in c) LS.set('dr.owners', c.owners);
    return this.getConfig();
  },
};

/* ---------- 구글시트 (Apps Script 웹 앱) ---------- */
export function blobToBase64(blob) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
}

export function makeSheetStore(conn) {
  async function call(action, payload = {}, timeoutMs = 45000) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      // text/plain: Apps Script는 preflight에 답하지 못하므로 단순 요청으로 보냄
      const res = await fetch(conn.u, {
        method: 'POST', redirect: 'follow', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: conn.s, action, ...payload }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'server error');
      return j;
    } finally { clearTimeout(tm); }
  }
  return {
    kind: 'sheet',
    async list() { const j = await call('list'); LS.set('dr.cache', j.items); return j.items; },
    cached() { return LS.get('dr.cache', null); },
    async save(item, newBlobs = []) {
      const newPhotos = [];
      for (const b of newBlobs) newPhotos.push({ data: await blobToBase64(b), type: b.type || 'image/jpeg' });
      return (await call('save', { item, newPhotos }, 120000)).item;
    },
    async remove(id) { return (await call('delete', { id })).deleted; },
    async thumbs(ids, size = 320) { return (await call('thumbs', { ids, size }, 90000)).thumbs; },
    async getConfig() { const c = (await call('config')).config; LS.set('dr.sheetcfg', c); return c; },
    cachedConfig() { return LS.get('dr.sheetcfg', null); },
    async setConfig(c) { const r = (await call('setConfig', { config: c })).config; LS.set('dr.sheetcfg', r); return r; },
  };
}

/* ---------- 사진 주소 ---------- */
const blobUrls = new Map();
export async function photoUrl(photo, size = 1200) {
  if (!photo) return null;
  if (photo.startsWith('local:')) {
    if (blobUrls.has(photo)) return blobUrls.get(photo);
    const b = await idbGet('photos', photo).catch(() => null);
    if (!b) return null;
    const u = URL.createObjectURL(new Blob([b.buf], { type: b.type || 'image/jpeg' }));
    blobUrls.set(photo, u);
    return u;
  }
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo)}&sz=w${size}`;
}
export const photoFallback = photo => photo && !photo.startsWith('local:') ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(photo)}` : null;

/* ---------- 연결 링크 ---------- */
export function parseConnect(str) {
  try {
    const m = String(str).match(/connect=([A-Za-z0-9_\-=]+)/);
    const tok = m ? m[1] : String(str).trim();
    const json = atob(tok.replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(decodeURIComponent(escape(json)));
    if (!c.u || !c.s || !/^https:\/\/script\.google(usercontent)?\.com\//.test(c.u)) return null;
    return c;
  } catch (e) { return null; }
}
export function connectLinkFor(conn) {
  const tok = btoa(unescape(encodeURIComponent(JSON.stringify({ u: conn.u, s: conn.s })))).replace(/\+/g, '-').replace(/\//g, '_');
  return location.origin + location.pathname + '#connect=' + tok;
}
