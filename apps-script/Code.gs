/**
 * Dressroom — 구글시트 저장 스크립트 (Apps Script)
 *
 * 구글시트 'Dressroom'에 붙어서(확장 프로그램 > Apps Script) 앱의 저장소 역할을 합니다.
 * 원본은 GitHub 저장소의 apps-script/Code.gs 입니다. 여기를 고치면 그 파일도 같이 고치세요.
 *
 * 설치 순서
 *   1) 이 파일 내용을 Apps Script 편집기에 붙여넣고 저장
 *   2) 함수 목록에서 setup 실행 → 권한 허용
 *   3) 배포 > 새 배포 > 웹 앱 (실행: 나, 액세스: 모든 사용자)
 *   4) 웹 앱 URL(…/exec)을 아래 WEB_APP_URL에 붙여넣고 저장
 *   5) 함수 목록에서 connectLink 실행 → 실행 로그의 링크를 폰에서 열기
 */

const APP_URL = 'https://moonjuhyuk.github.io/dressroom/';
const WEB_APP_URL = '';
const SHEET_NAME = 'Items';
const SUMMARY_NAME = '요약';
const PHOTO_FOLDER = 'Dressroom 사진';

// 열 순서 = 앱이 읽고 쓰는 순서. 새 칸은 맨 뒤에만 붙이세요.
const FIELDS = [
  ['id', 'ID'],
  ['owner', '주인'],
  ['category', '종류'],
  ['name', '이름(별칭)'],
  ['brand', '브랜드'],
  ['model', '모델명'],
  ['color', '색상'],
  ['material', '소재'],
  ['size', '사이즈'],
  ['purchased', '구매시기'],
  ['price', '금액'],
  ['note', '기타 메모'],
  ['photos', '사진'],
  ['lastWorn', '마지막으로 입은 날'],
  ['wornCount', '입은 횟수'],
  ['sources', '정보 출처'],
  ['created', '등록일'],
  ['updated', '수정일'],
];
const KEYS = FIELDS.map(f => f[0]);
const NUMERIC = ['price', 'wornCount'];
const TEXTY = ['id', 'purchased', 'lastWorn', 'created', 'updated', 'size', 'model'];
const CATS = [
  ['hat', '모자'], ['glasses', '안경'], ['scarf', '목도리'], ['tshirt', '티셔츠'], ['jacket', '자켓'],
  ['watch', '시계'], ['pants', '바지'], ['socks', '양말'], ['shoes', '신발'],
];

/* ---------------- 처음 한 번 ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME, 0);
    const blank = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  }
  sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS.map(f => f[1])])
    .setFontWeight('bold').setBackground('#1C1A17').setFontColor('#F4EFE6');
  sh.setFrozenRows(1);
  sh.hideColumns(1);
  TEXTY.forEach(k => {
    const c = columnLetter_(KEYS.indexOf(k) + 1);
    sh.getRange(c + ':' + c).setNumberFormat('@');
  });
  sh.getRange(2, KEYS.indexOf('price') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0');

  let sm = ss.getSheetByName(SUMMARY_NAME);
  if (!sm) sm = ss.insertSheet(SUMMARY_NAME, 1);
  const C = columnLetter_(KEYS.indexOf('category') + 1), P = columnLetter_(KEYS.indexOf('price') + 1);
  const rows = [['종류', '개수', '금액 합계(원)']];
  CATS.forEach(([k, label]) => rows.push([label,
    `=COUNTIF(${SHEET_NAME}!${C}2:${C},"${k}")`,
    `=SUMIF(${SHEET_NAME}!${C}2:${C},"${k}",${SHEET_NAME}!${P}2:${P})`]));
  rows.push(['합계', `=SUM(B2:B${CATS.length + 1})`, `=SUM(C2:C${CATS.length + 1})`]);
  sm.getRange(1, 1, rows.length, 3).setValues(rows);
  sm.getRange('A1:C1').setFontWeight('bold').setBackground('#1C1A17').setFontColor('#F4EFE6');
  sm.getRange(2, 2, rows.length - 1, 2).setNumberFormat('#,##0');
  sm.setColumnWidth(1, 120);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  photoFolder_();
  UrlFetchApp.getRequest('https://drive.google.com/'); // 권한 묻기용 (사진 미리보기 가져오기)
  Logger.log('✅ setup 완료. 이제 [배포 > 새 배포 > 웹 앱]을 하고 connectLink를 실행하세요.');
}

/** 배포 후 실행: 폰·PC에서 열 연결 링크를 로그에 출력합니다. */
function connectLink() {
  const url = WEB_APP_URL || ScriptApp.getService().getUrl();
  if (!url || !/\/exec$/.test(url)) { Logger.log('❌ 웹 앱 URL(…/exec)을 맨 위 WEB_APP_URL에 붙여넣고 저장한 뒤 다시 실행하세요.'); return; }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const token = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, s: secret }));
  Logger.log('📱 이 링크를 폰·PC에서 한 번 열면 연결됩니다 (가족 외에는 공유하지 마세요):\n' + APP_URL + '#connect=' + token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('연결') || ss.insertSheet('연결');
  sh.getRange('A1:A3').setValues([['폰에서 아래 링크를 누르면 Dressroom에 연결됩니다 (가족 외 공유 금지)'], [APP_URL + '#connect=' + token], ['링크가 새면 Apps Script에서 resetSecret → connectLink 다시 실행']]);
  sh.setColumnWidth(1, 700);
}

/** 연결 링크가 새어 나갔을 때 실행: 비밀키를 바꿔 기존 기기 연결을 모두 끊습니다. */
function resetSecret() {
  PropertiesService.getScriptProperties().setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('🔑 비밀키를 바꿨습니다. connectLink를 다시 실행해 새 링크로 연결하세요.');
}

/* ---------------- 웹 앱 ---------------- */

function doGet() {
  return ContentService.createTextOutput('Dressroom backend is running. 앱에서 연결해 주세요.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (!req.secret || req.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) throw new Error('unauthorized');
    switch (req.action) {
      case 'list':   out = { ok: true, items: listItems_() }; break;
      case 'save':   out = { ok: true, item: saveItem_(req.item || {}, req.newPhotos || []) }; break;
      case 'delete': out = { ok: true, deleted: deleteItem_(String(req.id || '')) }; break;
      case 'thumbs': out = { ok: true, thumbs: thumbs_(req.ids || [], req.size || 320) }; break;
      case 'config': out = { ok: true, config: getConfig_() }; break;
      case 'setConfig': setConfig_(req.config || {}); out = { ok: true, config: getConfig_() }; break;
      default: throw new Error('unknown action');
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 데이터 ---------------- */

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('setup 함수를 먼저 실행하세요');
  return sh;
}

function listItems_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, KEYS.length).getValues().filter(r => r[0]).map(rowToItem_);
}

function rowToItem_(r) {
  const o = {};
  KEYS.forEach((k, i) => {
    let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (v === '') v = null;
    o[k] = v;
  });
  o.id = String(o.id);
  o.photos = o.photos ? String(o.photos).split(',').map(s => s.trim()).filter(String) : [];
  return o;
}

function itemToRow_(o) {
  return KEYS.map(k => {
    let v = o[k];
    if (v === undefined || v === null) return '';
    if (k === 'photos') return (Array.isArray(v) ? v : String(v).split(',')).filter(String).join(',');
    if (NUMERIC.indexOf(k) >= 0) { const n = Number(v); return isNaN(n) ? '' : n; }
    return String(v).slice(0, 49000);
  });
}

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

/**
 * item.photos = 남길 기존 사진 ID 목록(순서대로). newPhotos = [{data(base64), type}] 새로 찍은 사진.
 * 목록에서 빠진 기존 사진은 휴지통으로 보냅니다.
 */
function saveItem_(item, newPhotos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const now = new Date().toISOString();
    const id = item.id ? String(item.id) : Utilities.getUuid();
    const row = findRow_(sh, id);
    const prev = row > 0 ? rowToItem_(sh.getRange(row, 1, 1, KEYS.length).getValues()[0]) : null;
    const o = Object.assign({}, item, { id: id, created: prev ? prev.created : now, updated: now });

    const prevPhotos = prev ? prev.photos : [];
    const keep = Array.isArray(item.photos) ? item.photos.filter(p => prevPhotos.indexOf(p) >= 0) : prevPhotos;
    const added = [];
    (newPhotos || []).forEach((p, i) => {
      if (!p || !p.data) return;
      const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type || 'image/jpeg', (o.category || 'item') + '-' + id.slice(0, 8) + '-' + Date.now() + '-' + i + '.jpg');
      const file = photoFolder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      added.push(file.getId());
    });
    prevPhotos.filter(p => keep.indexOf(p) < 0).forEach(trashFile_);
    o.photos = keep.concat(added);

    const values = [itemToRow_(o)];
    if (row > 0) sh.getRange(row, 1, 1, KEYS.length).setValues(values);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, KEYS.length).setValues(values);
    return rowToItem_(values[0]);
  } finally {
    lock.releaseLock();
  }
}

function deleteItem_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const row = findRow_(sh, id);
    if (row < 0) return false;
    rowToItem_(sh.getRange(row, 1, 1, KEYS.length).getValues()[0]).photos.forEach(trashFile_);
    sh.deleteRow(row);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** 쇼핑 매칭용: 사진 ID들의 작은 미리보기를 base64로 돌려줍니다. */
function thumbs_(ids, size) {
  ids = ids.filter(id => /^[A-Za-z0-9_\-]+$/.test(String(id))).slice(0, 40);
  if (!ids.length) return [];
  const token = ScriptApp.getOAuthToken();
  const reqs = ids.map(id => ({
    url: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + Math.min(Number(size) || 320, 800),
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: true,
  }));
  const res = UrlFetchApp.fetchAll(reqs);
  const out = [];
  res.forEach((r, i) => {
    if (r.getResponseCode() !== 200) return;
    const b = r.getBlob();
    const type = b.getContentType() || 'image/jpeg';
    if (!/^image\//.test(type)) return;
    out.push({ id: ids[i], type: type, data: Utilities.base64Encode(b.getBytes()) });
  });
  return out;
}

function trashFile_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const fid = props.getProperty('PHOTO_FOLDER_ID');
  if (fid) { try { return DriveApp.getFolderById(fid); } catch (e) {} }
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/* ---------------- 같이 쓰는 설정 (Claude 키, 주인 이름) ---------------- */

function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  let owners = null;
  try { owners = JSON.parse(p.getProperty('OWNERS') || 'null'); } catch (e) {}
  return {
    claudeKey: p.getProperty('CLAUDE_KEY') || '',
    model: p.getProperty('CLAUDE_MODEL') || '',
    owners: owners,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function setConfig_(c) {
  const p = PropertiesService.getScriptProperties();
  if ('claudeKey' in c) { if (c.claudeKey) p.setProperty('CLAUDE_KEY', String(c.claudeKey).trim()); else p.deleteProperty('CLAUDE_KEY'); }
  if ('model' in c) { if (c.model) p.setProperty('CLAUDE_MODEL', String(c.model)); else p.deleteProperty('CLAUDE_MODEL'); }
  if ('owners' in c && c.owners) p.setProperty('OWNERS', JSON.stringify(c.owners));
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
