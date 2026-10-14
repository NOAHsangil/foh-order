/* MG롯데평촌점 FOH 발주 — PC 관리자 화면 */
try { localStorage.removeItem('onse.mode'); } catch (e) {}
const DN = ['월', '화', '수', '목', '금', '토', '일'];
const VIEWS = [['dash', '대시보드'], ['grid', '주간 발주표'], ['upload', '발주 파일 올리기'], ['items', '업체·품목 관리'], ['subul', '수불 분석'], ['check', '입력 현황']];
const todayId = (() => { const d = new Date(); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
const thisMon = mondayOf(new Date());
const S = { db: null, dl: null, settings: { safety: 1.2, monInc: true }, vendors: {}, catalog: [], weeks: {}, entries: {}, entUnsub: {}, extraWeeks: [],
  view: thisMon, tab: 'dash', ready: { cfg: false, ven: false, cat: false, wk: false }, gvf: '*', q: '', dper: 'w', up: null, meta: {} };
try { const t = localStorage.getItem('adm.tab'); if (t && VIEWS.some(v => v[0] === t)) S.tab = t; } catch (e) {}
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, dp = 1) => v == null || v === '' ? '–' : (Math.abs(v) < 1e-9 ? '0' : Number(v).toFixed(dp).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
const won = v => v == null ? '–' : Math.round(v).toLocaleString('ko-KR');
const man = v => v == null ? '–' : (Math.abs(v) >= 1e4 ? (Math.round(v / 1e3) / 10).toLocaleString('ko-KR') + '만' : Math.round(v).toLocaleString('ko-KR'));
const md = id => { const [y, m, d] = id.split('-'); return `${+m}/${+d}`; };
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2200); }
function parseNum(s) { s = String(s).replace(/[, ]/g, ''); if (s === '') return null; const v = Number(s); return isNaN(v) ? undefined : v; }
function arrSet(a, i, v) { a = Array.isArray(a) ? a.slice() : []; while (a.length <= i) a.push(null); a[i] = v; return a; }
const normV = s => String(s || '').replace(/\(주\)|㈜|\(유\)|주식회사|\s/g, '').toLowerCase();

/* ---------- data ---------- */
function activeItems() { return S.catalog.filter(i => i.active !== false).sort((a, b) => { const va = S.vendors[a.vendorId]?.order ?? 99, vb = S.vendors[b.vendorId]?.order ?? 99; return va - vb || (a.order ?? 999) - (b.order ?? 999); }); }
function vGroup(v) { return (v && (v.group || v.name)) || '(업체 없음)'; }
function vendorsSorted() { return Object.values(S.vendors).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)); }
function groupsList() { const seen = []; vendorsSorted().forEach(v => { const g = vGroup(v); if (!seen.includes(g)) seen.push(g); }); return seen; }
function isManual(it) { return !!(S.vendors[it.vendorId] || {}).manual; }
function calc(wid) { return computeWeek({ weekId: wid, todayId, settings: S.settings, vendors: S.vendors, items: activeItems(), weekDocs: S.weeks, entries: effEntries() }); }
function subEntries() {
  const want = new Set([addDays(S.view, -14), addDays(S.view, -7), S.view, addDays(S.view, 7), ...S.extraWeeks]);
  for (const w of Object.keys(S.entUnsub)) if (!want.has(w)) { S.entUnsub[w](); delete S.entUnsub[w]; delete S.entries[w]; }
  for (const w of want) if (!S.entUnsub[w]) {
    S.entUnsub[w] = S.db.collection(`weeks/${w}/items`).onSnapshot(snap => { const m = {}; snap.docs.forEach(d => m[d.id] = d.data()); S.entries[w] = m; schedule(); }, onErr);
  }
}
function onErr(e) { console.warn(e); }
async function setEntry(wid, id, fn) {
  const cur = JSON.parse(JSON.stringify((S.entries[wid] || {})[id] || {})); fn(cur);
  (S.entries[wid] = S.entries[wid] || {})[id] = cur;
  try { await S.db.doc(`weeks/${wid}/items/${id}`).set(cur); } catch (e) { toast('저장하지 못했습니다'); }
}
async function setWeek(wid, fn) {
  const cur = JSON.parse(JSON.stringify(S.weeks[wid] || {})); fn(cur); S.weeks[wid] = cur;
  try { await S.db.doc(`weeks/${wid}`).set(cur); } catch (e) { toast('저장하지 못했습니다'); }
}
async function setDoc(path, obj) { try { await S.db.doc(path).set(obj); } catch (e) { toast('저장하지 못했습니다'); } }
function waitWeeks(ws, ms = 8000) {
  const need = ws.filter(w => !S.extraWeeks.includes(w)); if (need.length) { S.extraWeeks.push(...need); subEntries(); }
  return new Promise(res => { const t0 = Date.now(); const chk = () => { if (ws.every(w => S.entries[w] !== undefined) || Date.now() - t0 > ms) res(); else setTimeout(chk, 150); }; chk(); });
}

/* ---------- 금액 계산 ---------- */
function weekStats(wid) {
  const R = calc(wid), items = activeItems(), W = S.weeks[wid] || {}, E = S.entries[wid] || {};
  const day = [0, 1, 2, 3, 4, 5].map(() => ({ rec: 0, ord: 0, act: 0, my: 0 }));
  const byV = {}, byG = {};
  for (const it of items) {
    const o = R.out[it.id], pr = Number(it.price) || 0, v = S.vendors[it.vendorId], g = vGroup(v);
    const V = byV[it.vendorId] = byV[it.vendorId] || { rec: 0, ord: 0, act: 0, days: [0, 0, 0, 0, 0, 0] };
    const G = byG[g] = byG[g] || { rec: 0, ord: 0, act: 0 };
    for (let b = 0; b < 6; b++) {
      if (o.off[b] == null || o.hol[b]) continue;
      const r = o.rec[b]; if (typeof r === 'number' && !(o.past[b] && o.conf[b] != null)) { day[b].rec += r * pr; V.rec += r * pr; G.rec += r * pr; }
      const cov = actCovered(wid, b, it.vendorId);
      let a = 0;
      if (cov) { const e = E[it.id] || {}; const aa = (e.actAmt || [])[b]; a = aa != null ? Number(aa) : (Number(o.conf[b]) || 0) * pr; day[b].act += a; V.act += a; G.act += a; }
      else { a = (Number(o.conf[b]) || 0) * pr; day[b].my += a; }
      day[b].ord += a; V.ord += a; G.ord += a; V.days[b] += a;
    }
  }
  // 앱에 없는 품목(파일에만 있는 것)
  let other = 0; const ao = W.actOther || {}; for (const b of Object.keys(ao)) for (const n of Object.keys(ao[b] || {})) other += Number(ao[b][n]) || 0;
  const sales = [0, 1, 2, 3, 4, 5, 6].map(i => Number((W.sales || [])[i]) || 0);
  return { R, day, byV, byG, other, sales, salesSum: sales.reduce((a, x) => a + x, 0) };
}
function targetOf(g, weekSales) {
  const tg = S.settings.targets || {}, ta = S.settings.targetAmts || {};
  if (ta[g] != null && ta[g] !== '') return Number(ta[g]);
  return (Number(tg[g]) || 0) * weekSales / 100;
}

/* ---------- render ---------- */
let rq = false;
function schedule() { const ae = document.activeElement; if ((ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.type !== 'file' && ae.type !== 'checkbox' && ae.closest('#main')) || S.hold) { S.pending = true; return; } if (!rq) { rq = true; setTimeout(() => { rq = false; render(); }, 0); } }
document.addEventListener('focusout', () => setTimeout(() => { if (S.pending) { const ae = document.activeElement; if (!(ae && ae.tagName === 'INPUT')) { S.pending = false; render(); } } }, 60));
function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([k, l]) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}><span class="dot"></span>${l}</button>`).join('');
}
function weekNav() {
  return `<div class="wk"><button data-wk="-1" aria-label="이전 주">‹</button><b>${md(S.view)}(월) – ${md(addDays(S.view, 6))}(일)</b><button data-wk="1" aria-label="다음 주">›</button>${S.view !== thisMon ? '<button data-wk="0">이번 주</button>' : ''}</div>`;
}
function render() {
  renderNav();
  const ok = S.ready.cfg && S.ready.ven && S.ready.cat && S.ready.wk;
  if (!ok) { $('#main').innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  const f = { dash: vDash, grid: vGrid, upload: vUpload, items: vItems, subul: vSubul, check: vCheck }[S.tab] || vDash;
  const keep = S.tab === 'grid' ? ($('.gwrap') || {}).scrollTop : null, keepL = S.tab === 'grid' ? ($('.gwrap') || {}).scrollLeft : null;
  $('#main').innerHTML = f();
  if (keep != null && $('.gwrap')) { $('.gwrap').scrollTop = keep; $('.gwrap').scrollLeft = keepL; }
}
function vSoon() {
  const t = VIEWS.find(v => v[0] === S.tab)[1];
  return `<div class="top"><h1>${t}</h1></div><div class="card"><div class="empty">다음 단계에서 만들어집니다.</div></div>`;
}

/* ----- 대시보드 ----- */
function svgDays(st) {
  const W = 620, H = 220, pl = 46, pb = 30, pt = 12, n = 6, gw = (W - pl - 10) / n;
  const mx = Math.max(1, ...st.day.map(d => Math.max(d.rec, d.ord)));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(mx))); const m = mx / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const y = v => pt + (H - pt - pb) * (1 - v / nice);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="요일별 추천 금액과 발주 금액">`;
  for (let i = 0; i <= 4; i++) { const v = nice * i / 4; s += `<line x1="${pl}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line2)"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${man(v)}</text>`; }
  st.day.forEach((d, b) => {
    const x0 = pl + gw * b + gw * 0.18, bw = gw * 0.3;
    s += `<rect x="${x0}" y="${y(d.rec)}" width="${bw}" height="${y(0) - y(d.rec)}" rx="3" fill="var(--accent)" opacity=".55"><title>추천 ${won(d.rec)}원</title></rect>`;
    const ya = y(d.act), ym = y(d.act + d.my);
    s += `<rect x="${x0 + bw + 3}" y="${ya}" width="${bw}" height="${y(0) - ya}" rx="2" fill="var(--act)"><title>실제 발주(파일) ${won(d.act)}원</title></rect>`;
    s += `<rect x="${x0 + bw + 3}" y="${ym}" width="${bw}" height="${ya - ym}" rx="2" fill="var(--brand)"><title>내 발주 입력 ${won(d.my)}원</title></rect>`;
    const dt = addDays(S.view, b);
    s += `<text x="${pl + gw * b + gw / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="${dt === todayId ? 'var(--accent)' : 'var(--muted)'}" font-weight="${dt === todayId ? 700 : 400}">${DN[b]} ${md(dt)}</text>`;
  });
  return s + '</svg>';
}
function vDash() {
  const st = weekStats(S.view), pst = weekStats(addDays(S.view, -7));
  const gs = groupsList(); const sales = st.salesSum;
  let T = 0; gs.forEach(g => T += targetOf(g, sales));
  const ord = st.day.reduce((a, d) => a + d.ord, 0), act = st.day.reduce((a, d) => a + d.act, 0), rec = st.day.reduce((a, d) => a + d.rec, 0);
  const pord = pst.day.reduce((a, d) => a + d.ord, 0);
  const diffP = pord ? (ord - pord) / pord * 100 : null;
  const pct = v => sales ? (v / sales * 100).toFixed(1) + '%' : '–';
  let h = `<div class="top"><h1>대시보드</h1>${weekNav()}<span class="spacer"></span><span class="sub">금액은 부가세 별도</span></div>`;
  h += `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="l">이번 주 발주 금액</div><div class="v num">${won(ord)}원</div><div class="s sub">실제 파일 <b class="num">${won(act)}</b> · 내 발주 <b class="num">${won(ord - act)}</b></div></div>
    <div class="card kpi"><div class="l">목표 대비</div><div class="v num ${T && ord > T ? 'up' : ''}">${T ? Math.round(ord / T * 100) + '%' : '–'}</div><div class="s sub">목표 <b class="num">${won(T)}</b>원 ${T ? (ord > T ? `· <span class="up">${won(ord - T)} 초과</span>` : `· ${won(T - ord)} 남음`) : ''}</div></div>
    <div class="card kpi"><div class="l">예상 매출 대비 발주율</div><div class="v num">${pct(ord)}</div><div class="s sub">주간 예상 매출 <b class="num">${won(sales)}</b>원</div></div>
    <div class="card kpi"><div class="l">전주 대비</div><div class="v num ${diffP > 0 ? 'up' : 'down'}">${diffP == null ? '–' : (diffP > 0 ? '+' : '') + diffP.toFixed(1) + '%'}</div><div class="s sub">전주 <b class="num">${won(pord)}</b>원 · 추천 합계 <b class="num">${won(rec)}</b></div></div>
  </div>`;
  // 업체 묶음별
  let rows = '';
  for (const g of gs) {
    const x = st.byG[g] || { rec: 0, ord: 0, act: 0 }; const t = targetOf(g, sales);
    const mx = Math.max(t, x.rec, x.ord, 1);
    const stt = !t ? '<span class="pill">목표 없음</span>' : x.ord > t ? `<span class="pill bad">${won(x.ord - t)} 초과</span>` : `<span class="pill ok">${won(t - x.ord)} 남음</span>`;
    rows += `<tr><td><b>${esc(g)}</b></td><td class="r num">${t ? won(t) : '–'}</td><td class="r num">${won(x.rec)}</td><td class="r num"><b>${won(x.ord)}</b>${x.act ? `<div class="sub">실제 ${won(x.act)}</div>` : ''}</td><td style="width:22%"><div class="bar"><i style="width:${Math.min(100, x.ord / mx * 100)}%;background:${t && x.ord > t ? 'var(--danger)' : 'var(--brand)'}"></i></div>${t ? `<div class="bar" style="margin-top:3px;height:4px"><i style="width:${Math.min(100, t / mx * 100)}%;background:var(--muted);opacity:.5"></i></div>` : ''}</td><td class="r num">${pct(x.ord)}</td><td>${stt}</td></tr>`;
  }
  h += `<div class="grid g2"><div class="card"><h2>업체별 목표 · 추천 · 발주 <span class="sub">${md(S.view)}~${md(addDays(S.view, 6))}</span></h2>
    <table><thead><tr><th>업체</th><th class="r">목표</th><th class="r">추천</th><th class="r">발주</th><th></th><th class="r">매출 대비</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>
    ${st.other ? `<p class="note">발주 파일에 있지만 앱에 없는 품목(BOH 등) 금액 <b class="num">${won(st.other)}</b>원은 위 합계에 들어가지 않습니다.</p>` : ''}</div>
    <div class="card"><h2>요일별 발주 금액</h2>${svgDays(st)}<div class="legend"><span><i style="background:var(--accent);opacity:.55"></i>추천</span><span><i style="background:var(--act)"></i>실제 발주(파일)</span><span><i style="background:var(--brand)"></i>내 발주 입력</span></div></div></div>`;
  // 할 일
  const tb = (new Date().getDay() + 6) % 7; const todo = [];
  if (S.view === thisMon && tb < 6) {
    const R = st.R; const items = activeItems();
    for (const v of vendorsSorted()) {
      const off = (v.sched || [])[tb]; if (off == null || off === '') continue;
      const its = items.filter(i => i.vendorId === v.id); if (!its.length) continue;
      const o0 = R.out[its[0].id]; if (o0.hol[tb]) { todo.push(`<li><b>${esc(v.name)}</b> 오늘 휴무</li>`); continue; }
      const noStock = its.filter(i => !isManual(i) && R.out[i.id].Kday[tb] === null).length;
      const cov = actCovered(S.view, tb, v.id);
      todo.push(`<li><b>${esc(v.name)}</b> 오늘 발주 → ${DN[(tb + Number(off)) % 7]} 입고 ${cov ? '<span class="pill act">발주 파일 반영됨</span>' : '<span class="pill warn">발주 파일 아직 없음</span>'} ${noStock ? `<span class="pill bad">재고 미입력 ${noStock}개</span>` : ''}</li>`);
    }
  }
  const lastUp = (S.meta.orderfiles || {}).list || [];
  h += `<div class="grid g2"><div class="card"><h2>오늘 할 일 <span class="sub">${S.view === thisMon ? md(todayId) + ' (' + DN[tb] + ')' : '이번 주를 보면 표시됩니다'}</span></h2>${todo.length ? `<ul class="todo">${todo.join('')}</ul>` : '<div class="sub">오늘 발주하는 업체가 없습니다.</div>'}</div>
    <div class="card"><h2>최근 올린 발주 파일 <button class="btn sm" data-tab="upload" style="margin-left:auto">파일 올리기</button></h2>${lastUp.length ? `<table><tbody>${lastUp.slice(0, 5).map(x => `<tr><td>${esc(x.from ? md(x.from) + (x.to && x.to !== x.from ? '~' + md(x.to) : '') : '')} <span class="sub">${esc(x.vendor || '전체 업체')}</span></td><td class="r num">${won(x.amt)}원</td><td class="sub r">${esc(atLocal(x.at).slice(5))}</td></tr>`).join('')}</tbody></table>` : '<div class="sub">아직 올린 파일이 없습니다.</div>'}</div></div>`;
  return h;
}

/* ----- 주간 발주표 ----- */
function vGrid() {
  const R = calc(S.view), items = activeItems(), E = S.entries[S.view] || {};
  const gs = groupsList();
  const q = S.q.trim().toLowerCase();
  const fil = items.filter(it => (S.gvf === '*' || vGroup(S.vendors[it.vendorId]) === S.gvf) && (!q || (it.name + ' ' + (it.code || '') + ' ' + (it.spec || '')).toLowerCase().includes(q)));
  let h = `<div class="top"><h1>주간 발주표</h1>${weekNav()}<span class="spacer"></span>${typeof formButtonsHtml === 'function' ? `<div class="chips" style="align-items:center"><span class="sub">엑셀 받기</span>${formButtonsHtml().replace(/class="btn pri"/, 'class="btn pri sm"').replace(/<div class="chips"[^>]*>/, '').replace(/<\/div>\s*$/, '')}</div>` : ''}</div>`;
  h += `<div class="toolbar"><div class="chips">${['*', ...gs].map(g => `<button class="chip" data-gvf="${esc(g)}" aria-pressed="${S.gvf === g}">${g === '*' ? '전체' : esc(g)}</button>`).join('')}</div>
    <input class="search" id="gq" placeholder="품목 검색 (이름·코드)" value="${esc(S.q)}">
    <span class="spacer"></span><div class="legend"><span><i style="background:var(--act-soft);border:1px solid var(--act)"></i>실제 발주(파일)</span><span><i style="background:var(--accent)"></i>추천</span><span>재고·발주 칸은 바로 입력 · Enter/↑↓로 이동</span></div></div>`;
  const tb = S.view === thisMon ? (new Date().getDay() + 6) % 7 : -1;
  let th1 = `<th class="stick" rowspan="2" style="text-align:left;padding-left:10px">품목</th>`, th2 = '';
  for (let b = 0; b < 6; b++) { th1 += `<th colspan="4" class="dsep ${b === tb ? 'today' : ''}">${DN[b]} ${md(addDays(S.view, b))}</th>`; th2 += `<th class="dsep ${b === tb ? 'today' : ''}">재고</th><th>FC</th><th>추천</th><th>발주</th>`; }
  th1 += `<th rowspan="2">주간<br>발주</th><th rowspan="2">금액</th>`;
  let body = '', r = 0; let lastV = null;
  const flushV = (vid) => {
    if (!vid) return '';
    const vis = fil.filter(i => i.vendorId === vid); let cells = ''; let tot = 0;
    for (let b = 0; b < 6; b++) { let a = 0; for (const it of vis) { const o = R.out[it.id]; if (o.off[b] == null || o.hol[b]) continue; a += (Number(o.conf[b]) || 0) * (Number(it.price) || 0); } tot += a; cells += `<td colspan="4" class="dsep">${a ? won(a) : ''}</td>`; }
    return `<tr class="vsum"><td class="stick" style="text-align:left;padding-left:10px">소계</td>${cells}<td></td><td class="num"><b>${won(tot)}</b></td></tr>`;
  };
  for (const it of fil) {
    const v = S.vendors[it.vendorId] || { name: '(업체 없음)' };
    if (it.vendorId !== lastV) {
      body += flushV(lastV);
      const sched = (v.sched || []).map((o, b) => o == null || o === '' ? null : `${DN[b]}→${DN[(b + Number(o)) % 7]}`).filter(Boolean).join(' · ');
      body += `<tr class="grp"><td class="stick" colspan="1">${esc(v.name)}</td><td colspan="26" style="font-weight:400;color:var(--muted);font-size:12px">${sched || '발주일 미설정'}</td></tr>`;
      lastV = it.vendorId;
    }
    const o = R.out[it.id], e = E[it.id] || {}, pr = Number(it.price) || 0; let wq = 0;
    let row = `<td class="stick name"><b title="${esc(it.name)}">${esc(it.name)}</b><small>${esc(it.spec || '')}${it.unit ? ' · ' + esc(it.unit) : ''} · ${won(pr)}원</small></td>`;
    for (let b = 0; b < 6; b++) {
      const sk = (e.stock || [])[b];
      row += `<td class="in st dsep ${b === tb ? 'today' : ''}"><input data-k="stock:${it.id}:${b}" data-r="${r}" data-c="${b * 2}" value="${sk ?? ''}" inputmode="decimal" aria-label="${esc(it.name)} ${DN[b]} 재고" class="${sk != null && sk !== '' ? 'set' : ''}"></td>`;
      if (o.off[b] == null) { row += `<td class="off" colspan="3"></td>`; continue; }
      if (o.hol[b]) { row += `<td class="hol" colspan="3">휴무</td>`; continue; }
      const fc = o.A[b] != null ? o.use[o.A[b]] : null;
      row += `<td class="c fc num">${fc ? fmt(fc, 2) : ''}</td>`;
      const rc = o.rec[b];
      row += `<td class="c rec num ${rc === 0 ? 'z' : ''}">${typeof rc === 'number' ? fmt(rc, 1) : ''}</td>`;
      const q = o.conf[b]; if (q) wq += q;
      if (actCovered(S.view, b, it.vendorId)) row += `<td class="act" title="발주 파일 기준 실제 발주 ${q ? fmt(q, 2) : '0 (발주 안 함)'}${(e.conf || [])[b] != null ? ' · 내 발주 입력 ' + e.conf[b] : ''}">${q ? fmt(q, 1) : ''}</td>`;
      else { const my = (e.conf || [])[b]; row += `<td class="in"><input data-k="conf:${it.id}:${b}" data-r="${r}" data-c="${b * 2 + 1}" value="${my ?? ''}" inputmode="decimal" aria-label="${esc(it.name)} ${DN[b]} 내 발주" class="${my != null && my !== '' ? 'set' : ''}"></td>`; }
    }
    row += `<td class="c num">${wq ? fmt(wq, 1) : ''}</td><td class="c num" style="width:84px">${wq ? won(wq * pr) : ''}</td>`;
    body += `<tr>${row}</tr>`; r++;
  }
  body += flushV(lastV);
  if (!fil.length) body = `<tr><td colspan="27"><div class="empty">표시할 품목이 없습니다.</div></td></tr>`;
  h += `<div class="gwrap"><table class="gt"><thead><tr>${th1}</tr><tr>${th2}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="note">FC = 입고일 하루 예상 사용량(forecast). 파란 칸은 발주 사이트 파일로 들어온 실제 발주라 여기서 고칠 수 없습니다. 파일을 안 올린 날은 "발주" 칸에 넣은 내 발주로 계산합니다.</p>`;
  return h;
}

/* ----- 발주 파일 올리기 ----- */
function cellsOfHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return [...doc.querySelectorAll('table')].map(t => [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())));
}
function cellsOfXlsx(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).map(r => r.map(x => String(x ?? '').trim())));
}
function parseOrderFile(buf) {
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 2000));
  const tables = /<table|<html/i.test(head) ? cellsOfHtml(new TextDecoder('utf-8').decode(buf)) : cellsOfXlsx(buf);
  const rowsAll = tables.flat();
  const dt = s => { const m = String(s || '').match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
  const num = s => { const v = Number(String(s ?? '').replace(/[,\s원]/g, '')); return isNaN(v) ? 0 : v; };
  let from = null, to = null, vFilter = '', cFilter = '';
  for (const r of rowsAll) {
    const i = r.indexOf('주문일'); if (i >= 0) { const ds = r.slice(i + 1, i + 4).map(dt).filter(Boolean); if (ds.length) { from = ds[0]; to = ds[ds.length - 1]; } }
    const j = r.indexOf('거래처'); if (j >= 0 && r.includes('주문일')) vFilter = [r[j + 1], r[j + 2]].map(x => String(x || '').trim()).find(x => x && !/^\d+$/.test(x)) || '';
    const k = r.indexOf('품목코드'); if (k >= 0 && r.includes('주문일')) cFilter = (r[k + 1] || r[k + 2] || '').trim();
  }
  let hi = -1, H = null;
  for (let t = 0; t < rowsAll.length; t++) { const r = rowsAll[t]; if (r.includes('품목코드') && r.includes('주문수량')) { hi = t; H = r; break; } }
  if (hi < 0) throw new Error('발주 파일 형식(품목코드·주문수량 칸)을 찾지 못했습니다');
  const c = n => H.indexOf(n);
  const ix = { vendor: c('거래처명'), type: c('주문타입'), od: c('주문일자'), ad: c('입고예정일'), code: c('품목코드'), name: c('품목명칭'), spec: c('규격'), unit: c('단위'), price: c('단가'), qty: c('주문수량'), amt: c('공급가'), vat: c('부가세'), tot: c('합계'), who: c('주문자'), at: c('주문시각') };
  const rows = [];
  for (let t = hi + 1; t < rowsAll.length; t++) {
    const r = rowsAll[t]; const code = String(r[ix.code] || '').trim();
    if (!/^\d+$/.test(code)) continue;
    const od = dt(r[ix.od]); if (!od) continue;
    rows.push({ vendor: r[ix.vendor] || '', type: r[ix.type] || '', od, ad: dt(r[ix.ad]), code, name: r[ix.name] || '', spec: r[ix.spec] || '', unit: r[ix.unit] || '',
      price: num(r[ix.price]), qty: num(r[ix.qty]), amt: ix.amt >= 0 ? num(r[ix.amt]) : num(r[ix.price]) * num(r[ix.qty]), vat: ix.vat >= 0 ? num(r[ix.vat]) : 0, who: ix.who >= 0 ? r[ix.who] : '' });
  }
  if (!from && rows.length) { const ds = rows.map(x => x.od).sort(); from = ds[0]; to = ds[ds.length - 1]; }
  return { from, to, vFilter, cFilter, rows };
}
function atLocal(iso) { if (!iso) return ''; const d = new Date(iso); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function dayIdx(id) { const d = new Date(id + 'T00:00:00'); return (d.getDay() + 6) % 7; }
function datesBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function buildPreview(name, P) {
  const byCode = {}; S.catalog.forEach(it => { if (it.code) (byCode[String(it.code).trim()] = byCode[String(it.code).trim()] || []).push(it); });
  const pick = r => { const cs = byCode[r.code]; if (!cs) return null; if (cs.length === 1) return cs[0];
    const nv = normV(r.vendor); return cs.find(it => { const v = S.vendors[it.vendorId]; return v && (normV(v.name) === nv || nv.includes(normV(v.name)) || normV(v.name).includes(nv)); }) || cs.find(it => it.active !== false) || cs[0]; };
  const vByName = {}; vendorsSorted().forEach(v => vByName[normV(v.name)] = v);
  const matched = [], unmatched = [], warn = [], price = {};
  for (const r of P.rows) {
    const it = pick(r);
    if (!it) { unmatched.push(r); continue; }
    matched.push(Object.assign({ it }, r));
    const v = S.vendors[it.vendorId];
    if (v && normV(v.name) !== normV(r.vendor) && !normV(r.vendor).includes(normV(v.name)) && !normV(v.name).includes(normV(r.vendor))) warn.push(`${r.name}: 앱은 ${v.name}, 파일은 ${r.vendor}`);
    const b = dayIdx(r.od); const off = v ? (v.sched || [])[b] : null;
    if (b === 6) warn.push(`${md(r.od)}(일) 발주 ${r.name} — 일요일 발주는 계산에 넣지 않습니다`);
    else if (v && (off == null || off === '')) warn.push(`${r.name}: ${DN[b]}요일은 앱에서 ${v.name} 발주일이 아님 (계산에 안 들어감)`);
    else if (v && r.ad && addDays(r.od, Number(off)) !== r.ad) warn.push(`${r.name}: 입고예정 ${md(r.ad)} (앱 설정은 ${md(addDays(r.od, Number(off)))})`);
    if (r.price && Number(it.price) !== r.price) price[it.id] = { it, old: Number(it.price) || 0, nw: r.price };
  }
  // 범위: 업체 필터가 있으면 그 업체만
  let scopeV = vendorsSorted().map(v => v.id);
  if (P.vFilter && !/전체/.test(P.vFilter)) { const v = vByName[normV(P.vFilter)] || vendorsSorted().find(x => normV(x.name).includes(normV(P.vFilter)) || normV(P.vFilter).includes(normV(x.name))); scopeV = v ? [v.id] : []; }
  const dates = P.from ? datesBetween(P.from, P.to || P.from).filter(d => dayIdx(d) < 6) : [];
  const byV = {}; for (const m of matched) { const k = S.vendors[m.it.vendorId]?.name || m.vendor; byV[k] = byV[k] || { n: 0, amt: 0 }; byV[k].n++; byV[k].amt += m.amt; }
  const byVo = {}; for (const u of unmatched) { byVo[u.vendor] = byVo[u.vendor] || { n: 0, amt: 0 }; byVo[u.vendor].n++; byVo[u.vendor].amt += u.amt; }
  return { name, P, matched, unmatched, warn: [...new Set(warn)], price: Object.values(price), scopeV, dates, byV, byVo, upPrice: true };
}
async function onOrderFile(file) {
  if (!file) return;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const P = parseOrderFile(buf);
    if (!P.rows.length) { toast('파일에 주문 줄이 없습니다'); return; }
    S.up = buildPreview(file.name, P); render();
  } catch (e) { console.warn(e); toast(e.message || '파일을 읽지 못했습니다'); }
}
async function applyUpload() {
  const U = S.up; if (!U) return;
  const weeks = [...new Set(U.dates.map(d => mondayOf(new Date(d + 'T00:00:00'))))];
  toast('반영하는 중…');
  await waitWeeks(weeks);
  const scopeSet = new Set(U.scopeV);
  const dateSet = new Set(U.dates);
  // 품목·날짜별 합계
  const q = {}, a = {};
  for (const m of U.matched) { if (!dateSet.has(m.od)) continue; const k = m.it.id + '|' + m.od; q[k] = (q[k] || 0) + m.qty; a[k] = (a[k] || 0) + m.amt; }
  const other = {}; for (const u of U.unmatched) { if (!dateSet.has(u.od)) continue; const b = dayIdx(u.od); const w = mondayOf(new Date(u.od + 'T00:00:00')); ((other[w] = other[w] || {})[b] = other[w][b] || {}); other[w][b][u.vendor] = (other[w][b][u.vendor] || 0) + u.amt; }
  let writes = 0;
  for (const w of weeks) {
    const ds = U.dates.filter(d => mondayOf(new Date(d + 'T00:00:00')) === w);
    const bs = ds.map(dayIdx);
    // 품목 기록
    for (const it of S.catalog) {
      if (!scopeSet.has(it.vendorId)) continue;
      const cur = (S.entries[w] || {})[it.id] || {};
      let changed = false; let act = Array.isArray(cur.act) ? cur.act.slice() : []; let actAmt = Array.isArray(cur.actAmt) ? cur.actAmt.slice() : [];
      for (const d of ds) {
        const b = dayIdx(d), k = it.id + '|' + d; const nq = q[k] || 0, na = a[k] || 0;
        const pq = act[b]; const hadQ = pq != null && pq !== '';
        if ((nq !== 0 || hadQ) && (Number(pq || 0) !== nq || Number(actAmt[b] || 0) !== na || !hadQ)) { act = arrSet(act, b, nq); actAmt = arrSet(actAmt, b, na); changed = true; }
      }
      if (changed) { await setEntry(w, it.id, c => { c.act = act; c.actAmt = actAmt; }); writes++; }
    }
    // 주 기록: 반영한 업체·요일, 앱에 없는 품목 금액
    await setWeek(w, c => {
      const av = c.actV || {};
      for (const vid of U.scopeV) { let arr = av[vid] || []; for (const b of bs) arr = arrSet(arr, b, true); av[vid] = arr; }
      c.actV = av;
      const ao = c.actOther || {};
      for (const b of bs) {
        const prev = ao[b] || {}; const keep = {};
        if (U.scopeV.length !== vendorsSorted().length) for (const n of Object.keys(prev)) { const v = vendorsSorted().find(x => normV(x.name) === normV(n)); if (v && !scopeSet.has(v.id)) keep[n] = prev[n]; }
        ao[b] = Object.assign(keep, (other[w] || {})[b] || {});
      }
      c.actOther = ao;
    });
  }
  if (U.upPrice) for (const p of U.price) { await setDoc(`catalog/${p.it.id}`, Object.assign({}, p.it, { price: p.nw })); }
  const amt = U.matched.filter(m => dateSet.has(m.od)).reduce((s, m) => s + m.amt, 0);
  const log = ((S.meta.orderfiles || {}).list || []).slice(0, 49);
  log.unshift({ at: new Date().toISOString(), file: U.name, from: U.P.from, to: U.P.to, vendor: U.scopeV.length === 1 ? (S.vendors[U.scopeV[0]] || {}).name : '', rows: U.P.rows.length, matched: U.matched.length, amt, other: U.unmatched.reduce((s, u) => s + u.amt, 0) });
  await setDoc('meta/orderfiles', { list: log });
  S.up = null; toast(`반영했습니다 · 품목 ${writes}개 기록`); render();
}
function vUpload() {
  let h = `<div class="top"><h1>발주 파일 올리기</h1><span class="sub">발주 사이트에서 내려받은 주문 내역 엑셀(.xls / .xlsx)</span></div>`;
  h += `<label class="drop" id="drop"><input type="file" id="ofile" accept=".xls,.xlsx,.html,.htm" hidden><b>여기에 파일을 끌어다 놓거나 클릭해서 고르세요</b><div class="sub" style="margin-top:6px">파일의 주문일 기간에 있는 업체·요일은 이 파일 수량을 "실제 발주"로 계산합니다. 같은 기간을 다시 올리면 새 파일 내용으로 바뀝니다(두 번 더해지지 않음).</div></label>`;
  const U = S.up;
  if (U) {
    const amt = U.matched.reduce((s, m) => s + m.amt, 0), oamt = U.unmatched.reduce((s, m) => s + m.amt, 0);
    h += `<div class="card" style="margin-top:16px"><h2>미리보기 <span class="sub">${esc(U.name)}</span></h2>
    <div class="kv"><div><small>주문일 기간</small><b>${U.P.from ? md(U.P.from) + (U.P.to !== U.P.from ? ' ~ ' + md(U.P.to) : '') : '–'}</b></div>
      <div><small>반영할 업체</small><b>${U.scopeV.length === vendorsSorted().length ? '전체' : esc(U.scopeV.map(id => (S.vendors[id] || {}).name).join(', ') || '없음')}</b></div>
      <div><small>앱 품목 (FOH)</small><b class="num">${U.matched.length}줄 · ${won(amt)}원</b></div>
      <div><small>앱에 없는 품목 (BOH 등)</small><b class="num">${U.unmatched.length}줄 · ${won(oamt)}원</b></div></div>
    <table><thead><tr><th>업체</th><th class="r">앱 품목 줄</th><th class="r">금액</th></tr></thead><tbody>${Object.entries(U.byV).map(([k, x]) => `<tr><td>${esc(k)}</td><td class="r num">${x.n}</td><td class="r num">${won(x.amt)}</td></tr>`).join('')}</tbody></table>
    ${U.warn.length ? `<div class="warnbox"><b>확인해 주세요</b><ul style="margin:6px 0 0;padding-left:18px">${U.warn.slice(0, 12).map(w => `<li>${esc(w)}</li>`).join('')}${U.warn.length > 12 ? `<li>외 ${U.warn.length - 12}건</li>` : ''}</ul></div>` : ''}
    ${U.price.length ? `<details style="margin-top:10px"><summary>단가가 앱과 다른 품목 ${U.price.length}개</summary><table><tbody>${U.price.map(p => `<tr><td>${esc(p.it.name)}</td><td class="r num">${won(p.old)} → <b>${won(p.nw)}</b></td></tr>`).join('')}</tbody></table></details>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="upPrice" ${U.upPrice ? 'checked' : ''}> 앱 단가를 파일의 실제 단가로 바꾸기</label>` : ''}
    <details style="margin-top:10px"><summary>파일 내용 전체 보기 (${U.P.rows.length}줄)</summary><div class="scroll" style="margin-top:8px"><table><thead><tr><th>주문일</th><th>입고</th><th>거래처</th><th>품목</th><th class="r">수량</th><th class="r">공급가</th><th>앱</th></tr></thead><tbody>${U.P.rows.map(r => `<tr><td>${md(r.od)}</td><td>${r.ad ? md(r.ad) : ''}</td><td>${esc(r.vendor)}</td><td>${esc(r.name)} <span class="sub">${esc(r.spec)}</span></td><td class="r num">${fmt(r.qty, 2)}</td><td class="r num">${won(r.amt)}</td><td>${U.matched.some(m => m.code === r.code && m.od === r.od) ? '<span class="pill ok">반영</span>' : '<span class="pill">앱에 없음</span>'}</td></tr>`).join('')}</tbody></table></div></details>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn pri" data-upgo ${U.dates.length ? '' : 'disabled'}>앱에 반영하기</button><button class="btn" data-upcancel>취소</button></div></div>`;
  }
  const lg = (S.meta.orderfiles || {}).list || [];
  h += `<div class="card" style="margin-top:16px"><h2>올린 기록</h2>${lg.length ? `<table><thead><tr><th>올린 시각</th><th>파일</th><th>주문일</th><th>업체</th><th class="r">앱 품목 금액</th><th class="r">앱에 없는 품목</th></tr></thead><tbody>${lg.map(x => `<tr><td class="sub">${esc(atLocal(x.at))}</td><td>${esc(x.file)}</td><td>${x.from ? md(x.from) + (x.to && x.to !== x.from ? '~' + md(x.to) : '') : ''}</td><td>${esc(x.vendor || '전체')}</td><td class="r num">${won(x.amt)}</td><td class="r num">${won(x.other)}</td></tr>`).join('')}</tbody></table>` : '<div class="sub">아직 없습니다.</div>'}</div>`;
  return h;
}

/* ----- 업체·품목 관리 ----- */
const IF = [['code', '품목코드', 't', 92], ['name', '품목명', 't', 230], ['spec', '규격', 't', 150], ['unit', '단위', 't', 52], ['price', '단가', 'n', 78], ['mult', '발주 단위', 'n', 60], ['minStock', '최소재고', 'n', 64], ['minQty', '최소 발주', 'n', 64], ['directRate', '100만원당 사용량', 'n', 86], ['monthUse', '지난달 사용량', 'n', 76]];
function itemsSorted() { return S.catalog.slice().sort((a, b) => ((S.vendors[a.vendorId]?.order ?? 99) - (S.vendors[b.vendorId]?.order ?? 99)) || (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name))); }
async function saveItem(id, patch) { const it = S.catalog.find(x => x.id === id); if (!it) return; const nx = Object.assign({}, it, patch); Object.assign(it, patch); await setDoc(`catalog/${id}`, nx); }
async function saveVendor(id, patch) { const v = S.vendors[id]; if (!v) return; const nx = Object.assign({}, v, patch); Object.assign(v, patch); await setDoc(`vendors/${id}`, nx); }
function vItems() {
  S.isel = S.isel || new Set(); S.isub = S.isub || 'items';
  let h = `<div class="top"><h1>업체·품목 관리</h1><div class="chips"><button class="chip" data-isub="items" aria-pressed="${S.isub === 'items'}">품목</button><button class="chip" data-isub="vendors" aria-pressed="${S.isub === 'vendors'}">업체 · 발주 일정 · 휴무</button></div><span class="spacer"></span><span class="sub">고친 내용은 바로 저장되고 폰 앱에도 반영됩니다</span></div>`;
  return h + (S.isub === 'vendors' ? vVendors() : vItemTable());
}
function vItemTable() {
  const vs = vendorsSorted();
  const q = (S.iq || '').trim().toLowerCase();
  const all = itemsSorted().filter(it => (S.ivf || '*') === '*' || it.vendorId === S.ivf).filter(it => S.ioff || it.active !== false)
    .filter(it => !q || (String(it.name) + ' ' + (it.code || '') + ' ' + (it.spec || '')).toLowerCase().includes(q));
  const sel = S.isel;
  let h = `<div class="toolbar"><div class="chips"><button class="chip" data-ivf="*" aria-pressed="${(S.ivf || '*') === '*'}">전체</button>${vs.map(v => `<button class="chip" data-ivf="${v.id}" aria-pressed="${S.ivf === v.id}">${esc(v.name)}</button>`).join('')}</div>
    <input class="search" id="iq" placeholder="품목 검색" value="${esc(S.iq || '')}"><label class="sub"><input type="checkbox" id="ioff" ${S.ioff ? 'checked' : ''}> 사용 중지 품목도 보기</label>
    <span class="spacer"></span><button class="btn" data-iadd>+ 품목 추가</button><button class="btn" data-ipaste>엑셀에서 붙여넣어 추가</button></div>`;
  if (sel.size) h += `<div class="card" style="padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--brand-soft)"><b>${sel.size}개 선택</b>
    <span class="sub">업체를</span><select id="bulkV">${vs.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select><button class="btn sm" data-bulk="vendor">로 옮기기</button>
    <button class="btn sm" data-bulk="off">사용 중지</button><button class="btn sm" data-bulk="on">사용</button>
    <span class="sub">단가</span><input class="search" style="min-width:90px;width:90px" id="bulkP" placeholder="새 단가"><button class="btn sm" data-bulk="price">로 바꾸기</button>
    <span class="spacer"></span><button class="btn sm" data-bulk="clear">선택 해제</button></div>`;
  if (S.paste) h += pasteBox();
  let body = '', lastV = null;
  for (const it of all) {
    if (it.vendorId !== lastV) { lastV = it.vendorId; const v = S.vendors[lastV]; body += `<tr class="grp"><td colspan="${IF.length + 4}">${esc(v ? v.name : '업체 미지정')} <span class="sub" style="font-weight:400">${all.filter(x => x.vendorId === lastV).length}개</span></td></tr>`; }
    const off = it.active === false;
    body += `<tr style="${off ? 'opacity:.5' : ''}"><td style="width:30px"><input type="checkbox" data-isel="${it.id}" ${sel.has(it.id) ? 'checked' : ''} aria-label="선택"></td>
      <td style="width:54px"><button class="btn sm" data-ion="${it.id}" title="사용/중지">${off ? '중지' : '사용'}</button></td>
      <td style="width:130px"><select data-iv="${it.id}" style="width:124px">${vs.map(v => `<option value="${v.id}" ${it.vendorId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></td>
      ${IF.map(([k, l, t, w]) => `<td style="padding:2px 3px"><input class="cell ${t === 'n' ? 'num r' : ''}" style="width:${w}px" data-if="${it.id}:${k}" value="${esc(it[k] ?? '')}" ${t === 'n' ? 'inputmode="decimal"' : ''} aria-label="${l}"></td>`).join('')}
      <td style="width:64px;white-space:nowrap"><button class="btn sm" data-imv="${it.id}:-1" aria-label="위로">↑</button><button class="btn sm" data-imv="${it.id}:1" aria-label="아래로">↓</button></td></tr>`;
  }
  h += `<div class="gwrap" style="max-height:calc(100vh - 190px)"><table class="itab"><thead><tr><th><input type="checkbox" data-iselall aria-label="모두 선택"></th><th>상태</th><th>업체</th>${IF.map(([k, l, t]) => `<th class="${t === 'n' ? 'r' : ''}">${l}</th>`).join('')}<th>순서</th></tr></thead><tbody>${body || `<tr><td colspan="14"><div class="empty">품목이 없습니다.</div></td></tr>`}</tbody></table></div>
    <p class="note">칸을 고치고 다른 곳을 누르면 저장됩니다. "100만원당 사용량"을 넣으면 수불 사용량 대신 그 값으로 추천합니다. 소모품 업체는 "최소재고 이하일 때 최소 발주 수량"으로 추천합니다.</p>`;
  return h;
}
function pasteBox() {
  const vs = vendorsSorted(); const P = S.paste;
  let prev = '';
  if (P.rows && P.rows.length) prev = `<div class="scroll" style="margin-top:8px"><table><thead><tr><th>품목코드</th><th>품목명</th><th>규격</th><th>단위</th><th class="r">단가</th><th>결과</th></tr></thead><tbody>${P.rows.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td>${esc(r.unit)}</td><td class="r num">${won(r.price)}</td><td>${r.exists ? '<span class="pill warn">이미 있음 · 건너뜀</span>' : '<span class="pill ok">새로 추가</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="card"><h2>엑셀에서 붙여넣어 품목 추가</h2><p class="sub" style="margin:0 0 8px">엑셀에서 <b>품목코드 · 품목명 · 규격 · 단위 · 단가</b> 순서의 칸을 복사해서 붙여넣으세요(머리글 줄은 있어도 됩니다). 발주 사이트·수불현황 엑셀에서 그대로 복사해도 됩니다.</p>
    <textarea id="ptext" rows="6" style="width:100%;font-family:var(--f-num);font-size:12.5px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--surface)">${esc(P.text || '')}</textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span class="sub">추가할 업체</span><select id="pven">${vs.map(v => `<option value="${v.id}" ${P.vid === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select><button class="btn" data-pcheck>확인</button><button class="btn pri" data-pgo ${P.rows && P.rows.some(r => !r.exists) ? '' : 'disabled'}>추가하기</button><button class="btn" data-pclose>닫기</button></div>${prev}</div>`;
}
function parsePaste(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const c = line.split('\t').map(x => x.trim()); if (c.length < 2) continue;
    const ci = c.findIndex(x => /^\d{6,}$/.test(x)); if (ci < 0) continue;
    const rest = c.slice(ci + 1).filter(x => x !== '');
    const num = x => Number(String(x).replace(/[,원\s]/g, ''));
    const pi = rest.findIndex((x, i) => i >= 2 && !isNaN(num(x)) && num(x) > 0);
    const name = rest[0] || '', spec = rest[1] || '', unit = rest.find((x, i) => i >= 2 && /^[A-Za-z가-힣]{1,4}$/.test(x)) || '';
    rows.push({ code: c[ci], name, spec, unit, price: pi >= 0 ? num(rest[pi]) : 0, exists: S.catalog.some(it => String(it.code).trim() === c[ci]) });
  }
  return rows;
}
function vVendors() {
  const vs = vendorsSorted(); const sel = S.hv || (vs[0] || {}).id;
  const opt = (b, o) => `<select data-vs="${b}" style="width:58px">${['', 0, 1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${String(o ?? '') === String(n) ? 'selected' : ''}>${n === '' ? '–' : n + '일'}</option>`).join('')}</select>`;
  let rows = '';
  vs.forEach((v, i) => {
    rows += `<tr data-vid="${v.id}" style="${sel === v.id ? 'background:var(--brand-soft)' : ''}"><td style="white-space:nowrap"><button class="btn sm" data-vmv="${v.id}:-1">↑</button><button class="btn sm" data-vmv="${v.id}:1">↓</button></td>
      <td><input class="cell" style="width:150px" data-vf="${v.id}:name" value="${esc(v.name)}"></td>
      <td><input class="cell" style="width:86px" data-vf="${v.id}:group" value="${esc(v.group || '')}" placeholder="(묶음 없음)"></td>
      <td><select data-vk="${v.id}"><option value="0" ${!v.manual ? 'selected' : ''}>식자재·음료</option><option value="1" ${v.manual ? 'selected' : ''}>소모품</option></select></td>
      ${[0, 1, 2, 3, 4, 5].map(b => `<td class="dsep" data-vsc="${v.id}">${opt(b, (v.sched || [])[b])}</td>`).join('')}
      <td style="white-space:nowrap"><select data-vnw="${v.id}"><option value="">–</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(v.nthWeek) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>번째 <select data-vnd="${v.id}"><option value="">–</option>${DN.map(d => `<option ${v.nthDay === d ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
      <td><button class="btn sm" data-hv="${v.id}">휴무 달력 ${(v.holDates || []).filter(x => x >= todayId).length ? `<span class="pill bad">${(v.holDates || []).filter(x => x >= todayId).length}</span>` : ''}</button></td></tr>`;
  });
  let h = `<div class="card"><h2>업체 · 발주 일정 <span class="sub">요일 칸 = 그 요일에 발주하면 며칠 뒤 입고되는지 (발주 안 하는 날은 –)</span><button class="btn sm" data-vadd style="margin-left:auto">+ 업체 추가</button></h2>
    <div style="overflow:auto"><table><thead><tr><th>순서</th><th>업체명</th><th>묶음</th><th>종류</th>${DN.slice(0, 6).map(d => `<th class="dsep">${d} 발주</th>`).join('')}<th>정기 휴무</th><th>휴무일</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">"묶음"이 같은 업체는 금액 정리·엑셀에서 같이 묶입니다(예: 음료·주류). 정기 휴무는 "셋째 주 수요일"처럼 매달 반복되는 휴무입니다.</p></div>`;
  const v = S.vendors[sel];
  if (v) h += `<div class="card"><h2>${esc(v.name)} 휴무 달력 <span class="sub">날짜를 누르면 휴무/영업이 바뀝니다 · 휴무일은 발주·입고가 없는 것으로 계산</span></h2>${holCal(v)}</div>`;
  return h;
}
function holCal(v) {
  if (!S.hm) S.hm = todayId.slice(0, 7);
  const hd = new Set(v.holDates || []); const out = [];
  for (let k = 0; k < 2; k++) {
    let [y, m] = S.hm.split('-').map(Number); m += k; if (m > 12) { m -= 12; y++; }
    const p = x => String(x).padStart(2, '0'); const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), lead = first.getDay();
    let cells = ['일', '월', '화', '수', '목', '금', '토'].map((d, i) => `<div class="cdh" ${i === 0 ? 'style="color:var(--danger)"' : ''}>${d}</div>`).join('') + '<div></div>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const id = `${y}-${p(m)}-${p(d)}`; const wd = DN[(new Date(y, m - 1, d).getDay() + 6) % 7];
      const auto = !!(v.nthWeek && v.nthDay && v.nthDay === wd && Math.floor((d - 1) / 7) + 1 === Number(v.nthWeek));
      const c = hd.has(id);
      cells += `<button class="cday ${c ? 'closed' : auto ? 'auto' : ''} ${id === todayId ? 'today' : ''}" data-hd="${v.id}:${id}">${d}<small>${c ? '휴무' : auto ? '정기' : ''}</small></button>`;
    }
    out.push(`<div><div style="font-weight:700;margin-bottom:6px">${y}년 ${m}월</div><div class="cgrid">${cells}</div></div>`);
  }
  return `<div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn sm" data-hm="-1">‹ 이전</button><button class="btn sm" data-hm="1">다음 ›</button></div><div class="grid" style="grid-template-columns:1fr 1fr;gap:24px">${out.join('')}</div>`;
}

/* ----- 수불 분석 ----- */
function subulMonths() { return Object.keys(S.meta).filter(k => /^subul_\d{4}-\d{2}$/.test(k)).map(k => k.slice(6)).sort(); }
function parseSubul(buf) {
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 2000));
  const tables = /<table|<html/i.test(head) ? cellsOfHtml(new TextDecoder('utf-8').decode(buf)) : (() => { const wb = XLSX.read(buf, { type: 'array' }); const names = wb.SheetNames.slice().sort((x, y) => (y.includes('수불') ? 1 : 0) - (x.includes('수불') ? 1 : 0)); return names.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); })();
  const nz = v => String(v == null ? '' : v).replace(/\s/g, '');
  const N = v => { const x = Number(String(v ?? '').replace(/[,\s]/g, '')); return isNaN(x) ? 0 : x; };
  for (const rows of tables) {
    let hi = -1, cc = -1;
    for (let i = 0; i < Math.min(rows.length, 40) && hi < 0; i++) { const r = rows[i] || []; for (let j = 0; j < r.length; j++) if (nz(r[j]) === '품목코드' || nz(r[j]) === '상품코드') { hi = i; cc = j; break; } }
    if (hi < 0) continue;
    const h1 = (rows[hi] || []).map(nz), h2 = (rows[hi + 1] || []).map(nz);
    const grpOf = []; let last = ''; for (let j = 0; j < Math.max(h1.length, h2.length); j++) { if (h1[j]) last = h1[j]; grpOf[j] = last; }
    const find = (k, lastOne) => { const js = []; grpOf.forEach((g, j) => { if (g.includes(k) && h2[j] === '수량') js.push(j); }); return js.length ? (lastOne ? js[js.length - 1] : js[0]) : -1; };
    const C = { open: find('이월'), in: find('일반입고'), tin: find('이체입고'), tout: find('이체출고'), claim: find('클레임'), use: find('사용출고'), close: find('재고', true) };
    const std = { open: 8, in: 10, tin: 12, tout: 14, claim: 16, use: 18, close: 20 };
    for (const k of Object.keys(C)) if (C[k] < 0) C[k] = cc + std[k] - 3;
    const ci = { c1: cc - 3, c2: cc - 2, c3: cc - 1, name: cc + 1, spec: cc + 2, unit: h2.indexOf('단위') >= 0 ? h2.indexOf('단위') : cc + 3, price: h2.indexOf('단가') >= 0 ? h2.indexOf('단가') : cc + 4 };
    const items = [];
    for (const r of rows.slice(hi + 1)) {
      const code = String(r && r[cc] != null ? r[cc] : '').trim(); if (!/^\d+$/.test(code)) continue;
      const g = k => [N(r[C[k]]), N(r[C[k] + 1])];
      items.push({ code, c1: r[ci.c1] || '', c2: r[ci.c2] || '', c3: r[ci.c3] || '', name: String(r[ci.name] || ''), spec: String(r[ci.spec] || ''), unit: String(r[ci.unit] || ''), price: N(r[ci.price]),
        open: g('open'), in: g('in'), tin: g('tin'), tout: g('tout'), claim: g('claim'), use: g('use'), close: g('close') });
    }
    if (items.length) return items;
  }
  throw new Error('수불현황에서 "품목코드" 칸을 찾지 못했습니다');
}
async function onSubulFile(file) {
  try {
    const items = parseSubul(new Uint8Array(await file.arrayBuffer()));
    const pm = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const m = (file.name.match(/(20\d{2})[.\-_ ]?(\d{1,2})월?/) || []);
    S.sup = { file: file.name, items, month: m[1] ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : pm, sales: '' };
    render();
  } catch (e) { console.warn(e); toast(e.message || '파일을 읽지 못했습니다'); }
}
async function saveSubul() {
  const U = S.sup; if (!U) return; const mon = U.month; const sales = parseNum(U.sales) || null;
  const mk = mon;
  await setDoc(`meta/subul_${mk}`, { month: mk, file: U.file, at: new Date().toISOString(), sales, items: U.items });
  if (U.apply) {
    // 앱 추천에 쓰는 지난달 사용량(폰 앱 "수불현황 올리기"와 같은 반영)
    const map = {}; U.items.forEach(x => map[x.code] = x);
    for (const it of S.catalog) { const x = map[String(it.code || '').trim()]; if (!x) continue; const d = Object.assign({}, it, { sub: { month: mk, inQty: x.in[0], inAmt: x.in[1], useAmt: x.use[1], tIn: x.tin[1], tOut: x.tout[1], use: x.use[0] } }); if (!isManual(it)) d.monthUse = x.use[0]; await setDoc(`catalog/${it.id}`, d); }
    await setDoc('config/main', Object.assign({}, S.settings, sales ? { monthSales: sales } : {}, { subulAt: todayId, subulFile: U.file, subulMonth: mk }));
  }
  S.sup = null; S.smon = mk; toast(`${mk} 수불현황을 저장했습니다`); render();
}
function daysIn(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function vSubul() {
  const months = subulMonths();
  let h = `<div class="top"><h1>수불 분석</h1>${months.length ? `<div class="chips">${months.map(m => `<button class="chip" data-smon="${m}" aria-pressed="${(S.smon || months[months.length - 1]) === m}">${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월</button>`).join('')}</div>` : ''}<span class="spacer"></span><label class="btn pri" style="cursor:pointer">수불현황 파일 올리기<input type="file" id="sfile" accept=".xls,.xlsx,.html,.htm" hidden></label></div>`;
  if (S.sup) {
    const U = S.sup; const tot = U.items.reduce((a, x) => a + x.use[1], 0);
    h += `<div class="card"><h2>수불현황 저장 <span class="sub">${esc(U.file)} · ${U.items.length}개 품목 · 사용 금액 ${won(tot)}원</span></h2>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><label>몇 월 수불인가요? <input type="month" id="supm" value="${U.month}" class="search" style="min-width:0"></label>
      <label>그 달 총매출 <input id="sups" class="search" style="min-width:0;width:150px" inputmode="numeric" placeholder="예: 264,989,781" value="${esc(U.sales)}"> 원</label>
      <label><input type="checkbox" id="supa" ${U.apply !== false ? 'checked' : ''}> 이 달 사용량을 앱 추천 계산에도 쓰기 (가장 최근 달일 때)</label></div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn pri" data-supgo>저장</button><button class="btn" data-supx>취소</button></div>
      <p class="note">같은 달을 다시 올리면 새 파일로 바뀝니다. 달마다 따로 저장되어 아래에서 여러 달을 비교할 수 있습니다.</p></div>`;
  }
  if (!months.length) return h + `<div class="card"><div class="empty">아직 저장된 수불현황이 없습니다. 영업시스템에서 받은 수불현황 엑셀을 올려 주세요. 지난 달 파일이 있으면 여러 달을 올릴수록 비교가 정확해집니다.</div></div>`;
  const mk = S.smon && months.includes(S.smon) ? S.smon : months[months.length - 1];
  const D = S.meta['subul_' + mk]; const prevK = months[months.indexOf(mk) - 1]; const P = prevK ? S.meta['subul_' + prevK] : null;
  const sales = Number(D.sales) || (S.settings.subulMonth === mk ? Number(S.settings.monthSales) : 0) || 0;
  const psales = P ? (Number(P.sales) || 0) : 0;
  const nd = daysIn(mk);
  const codes = new Set(S.catalog.map(it => String(it.code || '').trim()));
  const scope = S.sscope || 'foh';
  const items = D.items.filter(x => scope === 'all' || codes.has(x.code));
  const pmap = {}; (P ? P.items : []).forEach(x => pmap[x.code] = x);
  const sum = k => items.reduce((a, x) => a + (x[k][1] || 0), 0);
  const useAmt = sum('use'), inAmt = sum('in'), closeAmt = sum('close'), claimAmt = sum('claim');
  const puse = P ? P.items.filter(x => scope === 'all' || codes.has(x.code)).reduce((a, x) => a + x.use[1], 0) : 0;
  h += `<div class="toolbar"><div class="chips"><button class="chip" data-sscope="foh" aria-pressed="${scope === 'foh'}">앱 품목(FOH)만</button><button class="chip" data-sscope="all" aria-pressed="${scope === 'all'}">수불 전체</button></div>
    <span class="sub">${esc(D.file || '')} · 저장 ${esc(atLocal(D.at))}</span><span class="spacer"></span><label class="sub">그 달 총매출 <input id="smsales" class="search" style="min-width:0;width:150px" inputmode="numeric" value="${sales ? sales.toLocaleString('ko-KR') : ''}" placeholder="매출 입력"> 원</label></div>`;
  h += `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="l">사용 금액</div><div class="v num">${won(useAmt)}원</div><div class="s sub">${puse ? `전달 대비 <b class="${useAmt > puse ? 'up' : 'down'}">${((useAmt - puse) / puse * 100).toFixed(1)}%</b>` : '전달 자료 없음'}</div></div>
    <div class="card kpi"><div class="l">매출 대비 사용률</div><div class="v num">${sales ? (useAmt / sales * 100).toFixed(2) + '%' : '–'}</div><div class="s sub">${sales ? `매출 ${won(sales)}원` : '위에 그 달 매출을 넣어 주세요'}${psales && P ? ` · 전달 ${(puse / psales * 100).toFixed(2)}%` : ''}</div></div>
    <div class="card kpi"><div class="l">입고 금액</div><div class="v num">${won(inAmt)}원</div><div class="s sub">입고 − 사용 <b class="num">${won(inAmt - useAmt)}</b>원</div></div>
    <div class="card kpi"><div class="l">기말 재고</div><div class="v num">${won(closeAmt)}원</div><div class="s sub">약 <b class="num">${useAmt ? (closeAmt / (useAmt / nd)).toFixed(1) : '–'}</b>일치 사용량${claimAmt ? ` · 클레임 ${won(claimAmt)}원` : ''}</div></div></div>`;
  // 품목 표
  const rows = items.map(x => {
    const p = pmap[x.code]; const r1 = sales ? x.use[0] / sales * 1e6 : null; const r0 = p && psales ? p.use[0] / psales * 1e6 : null;
    const ch = r1 != null && r0 ? (r1 - r0) / r0 * 100 : (p && p.use[0] ? (x.use[0] - p.use[0]) / p.use[0] * 100 : null);
    const dly = x.use[0] / nd; const cd = dly > 0 ? x.close[0] / dly : (x.close[0] > 0 ? Infinity : null);
    const flags = [];
    if (ch != null && ch >= 30 && x.use[1] > 30000) flags.push('<span class="pill bad">사용 급증</span>');
    if (ch != null && ch <= -30 && (p ? p.use[1] : 0) > 30000) flags.push('<span class="pill act">사용 급감</span>');
    if (cd != null && cd > 21 && x.close[1] > 50000) flags.push('<span class="pill warn">재고 많음</span>');
    if (x.in[0] > x.use[0] * 1.3 && x.in[1] - x.use[1] > 50000) flags.push('<span class="pill warn">입고 > 사용</span>');
    if (x.claim[0]) flags.push('<span class="pill bad">클레임</span>');
    return { x, p, r1, ch, cd, flags };
  });
  const sk = S.ssort || 'use';
  const sorters = { use: (a, b) => b.x.use[1] - a.x.use[1], ch: (a, b) => Math.abs(b.ch ?? 0) - Math.abs(a.ch ?? 0), cd: (a, b) => (b.cd === Infinity ? 1e9 : b.cd ?? -1) - (a.cd === Infinity ? 1e9 : a.cd ?? -1), gap: (a, b) => (b.x.in[1] - b.x.use[1]) - (a.x.in[1] - a.x.use[1]), flag: (a, b) => b.flags.length - a.flags.length || b.x.use[1] - a.x.use[1] };
  rows.sort(sorters[sk] || sorters.use);
  const q = (S.sq || '').toLowerCase();
  const shown = rows.filter(r => !q || (r.x.name + r.x.code).toLowerCase().includes(q));
  const th = (k, l) => `<th class="r" style="cursor:pointer" data-ssort="${k}">${l}${sk === k ? ' ▾' : ''}</th>`;
  // 분류별
  const byC = {}; items.forEach(x => { const k = (x.c2 || x.c1 || '기타'); byC[k] = (byC[k] || 0) + x.use[1]; });
  const cats = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 10); const cmx = Math.max(1, ...cats.map(c => c[1]));
  h += `<div class="grid g3">${''}<div class="card"><h2>분류별 사용 금액</h2>${cats.map(([k, v]) => `<div style="display:grid;grid-template-columns:90px 1fr 70px;gap:8px;align-items:center;margin:6px 0"><span>${esc(k)}</span><div class="bar"><i style="width:${v / cmx * 100}%;background:var(--brand)"></i></div><span class="r num">${man(v)}</span></div>`).join('')}</div>${trendCard(months)}${orderVsIn(mk, D)}</div>
    <div class="card"><h2>품목별 <span class="sub">${shown.length}개 · 제목을 누르면 정렬 · 품목을 누르면 월별 추이</span><input class="search" id="sq" placeholder="검색" value="${esc(S.sq || '')}" style="margin-left:auto;min-width:160px"></h2>
    <div class="scroll" style="max-height:560px"><table><thead><tr><th>품목</th>${th('use', '사용량 · 금액')}<th class="r">100만원당</th>${th('ch', '전달 대비')}<th class="r">입고</th>${th('gap', '입고−사용')}${th('cd', '재고 일수')}<th style="cursor:pointer" data-ssort="flag">확인${sk === 'flag' ? ' ▾' : ''}</th></tr></thead><tbody>
    ${shown.map(r => `<tr data-strend="${r.x.code}" style="cursor:pointer;${S.strend === r.x.code ? 'background:var(--brand-soft)' : ''}"><td><b style="font-weight:500">${esc(r.x.name)}</b><div class="sub">${esc(r.x.spec)} · ${esc(r.x.unit)}</div></td>
      <td class="r num">${fmt(r.x.use[0], 1)}<div class="sub">${won(r.x.use[1])}</div></td><td class="r num">${r.r1 != null ? fmt(r.r1, 3) : '–'}</td>
      <td class="r num ${r.ch > 0 ? 'up' : r.ch < 0 ? 'down' : ''}">${r.ch == null ? '–' : (r.ch > 0 ? '+' : '') + r.ch.toFixed(0) + '%'}</td>
      <td class="r num">${fmt(r.x.in[0], 1)}</td><td class="r num">${won(r.x.in[1] - r.x.use[1])}</td><td class="r num">${r.cd == null ? '–' : r.cd === Infinity ? '사용 없음' : r.cd.toFixed(0) + '일'}</td><td>${r.flags.join(' ')}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">100만원당 = 매출 100만원마다 쓰는 양(앱 추천의 기준). 재고 일수 = 기말 재고 ÷ 하루 평균 사용량. 사용 급증/급감은 전달보다 30% 이상 바뀐 품목입니다.</p></div>`;
  const cl = items.filter(x => x.claim[0] || x.tin[0] || x.tout[0]);
  if (cl.length) h += `<div class="card"><h2>클레임 · 이체 내역 <span class="sub">${cl.length}개 품목</span></h2><table><thead><tr><th>품목</th><th class="r">클레임</th><th class="r">이체입고</th><th class="r">이체출고</th></tr></thead><tbody>${cl.map(x => `<tr><td>${esc(x.name)}</td><td class="r num">${x.claim[0] ? fmt(x.claim[0]) + ' · ' + won(x.claim[1]) : ''}</td><td class="r num">${x.tin[0] ? fmt(x.tin[0]) + ' · ' + won(x.tin[1]) : ''}</td><td class="r num">${x.tout[0] ? fmt(x.tout[0]) + ' · ' + won(x.tout[1]) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  return h;
}
function trendCard(months) {
  const code = S.strend; if (!code) return `<div class="card"><h2>월별 추이</h2><div class="sub">왼쪽 표에서 품목을 누르면 달마다 사용량(매출 100만원당)이 그래프로 나옵니다.</div></div>`;
  const pts = months.map(m => { const D = S.meta['subul_' + m]; const x = (D.items || []).find(i => i.code === code); const s = Number(D.sales) || (S.settings.subulMonth === m ? Number(S.settings.monthSales) : 0); return { m, x, v: x && s ? x.use[0] / s * 1e6 : null, q: x ? x.use[0] : null }; });
  const name = (pts.find(p => p.x) || {}).x?.name || code;
  const vals = pts.map(p => p.v ?? p.q ?? 0); const useRate = pts.some(p => p.v != null);
  const W = 420, H = 170, pl = 44, pb = 26, pt = 10; const mx = Math.max(1e-9, ...vals) * 1.15; const n = pts.length;
  const x = i => pl + (n === 1 ? (W - pl - 10) / 2 : i * (W - pl - 16) / (n - 1)); const y = v => pt + (H - pt - pb) * (1 - v / mx);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(name)} 월별 추이">`;
  for (let i = 0; i <= 3; i++) { const v = mx * i / 3; s += `<line x1="${pl}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line2)"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="10.5" text-anchor="end" fill="var(--muted)">${fmt(v, useRate ? 2 : 0)}</text>`; }
  if (n > 1) s += `<polyline fill="none" stroke="var(--brand)" stroke-width="2.5" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
  vals.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--brand)"><title>${pts[i].m}: ${fmt(v, 3)}</title></circle><text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="var(--muted)">${Number(pts[i].m.slice(5))}월</text>`; });
  s += '</svg>';
  return `<div class="card"><h2>월별 추이</h2><div class="sub" style="margin:-6px 0 6px">${esc(name)} · ${useRate ? '매출 100만원당 사용량' : '사용량 (매출 입력 시 100만원당으로 바뀜)'}</div>${s}${n < 2 ? '<div class="sub">두 달 이상 저장하면 선으로 이어집니다.</div>' : ''}</div>`;
}
function orderVsIn(mk, D) {
  // 그 달에 입고된(입고일 기준) 앱 발주 vs 수불 일반입고
  const [y, m] = mk.split('-').map(Number); const start = `${mk}-01`, end = `${mk}-${String(daysIn(mk)).padStart(2, '0')}`;
  const weeks = []; for (let w = addDays(mondayOf(new Date(start + 'T00:00:00')), -7); w <= end; w = addDays(w, 7)) weeks.push(w);
  const missing = weeks.filter(w => S.entries[w] === undefined);
  if (missing.length) { if (!S.extraWeeks.some(w => missing.includes(w))) { S.extraWeeks.push(...missing); setTimeout(subEntries, 0); } return `<div class="card"><h2>앱 발주 vs 실제 입고</h2><div class="sub">그 달 발주 기록을 불러오는 중…</div></div>`; }
  const ord = {};
  for (const w of weeks) {
    const R = calc(w);
    for (const it of activeItems()) { const o = R.out[it.id]; for (let b = 0; b < 6; b++) { if (o.off[b] == null || o.hol[b] || !o.conf[b]) continue; const ad = addDays(w, o.A[b] - 1); if (ad < start || ad > end) continue; const c = String(it.code || '').trim(); ord[c] = ord[c] || { q: 0, it }; ord[c].q += Number(o.conf[b]) || 0; } }
  }
  const smap = {}; D.items.forEach(x => smap[x.code] = x);
  const rows = Object.entries(ord).map(([c, o]) => { const x = smap[c]; const iq = x ? x.in[0] : 0; return { name: o.it.name, oq: o.q, iq, d: iq - o.q, price: Number(o.it.price) || 0 }; }).filter(r => Math.abs(r.d) >= 1).sort((a, b) => Math.abs(b.d * b.price) - Math.abs(a.d * a.price)).slice(0, 15);
  const anyOrd = Object.keys(ord).length;
  return `<div class="card"><h2>앱 발주 vs 실제 입고 <span class="sub">${Number(mk.slice(5))}월 입고분 · 차이 큰 순</span></h2>${!anyOrd ? '<div class="sub">이 달에 앱에 기록된 발주가 없습니다. 발주 파일을 올리거나 내 발주를 입력하면 비교됩니다.</div>' : rows.length ? `<table><thead><tr><th>품목</th><th class="r">앱 발주</th><th class="r">수불 입고</th><th class="r">차이</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${fmt(r.oq)}</td><td class="r num">${fmt(r.iq)}</td><td class="r num ${r.d < 0 ? 'up' : ''}">${r.d > 0 ? '+' : ''}${fmt(r.d)}</td></tr>`).join('')}</tbody></table><p class="note">차이가 마이너스면 발주보다 덜 들어온 것(결품·누락), 플러스면 앱에 기록되지 않은 발주가 있었던 것입니다.</p>` : '<div class="sub">앱 발주와 수불 입고가 모두 맞습니다.</div>'}</div>`;
}

/* ----- 입력 현황 ----- */
function vCheck() {
  const R = calc(S.view), items = activeItems(), E = S.entries[S.view] || {};
  const vs = vendorsSorted().filter(v => items.some(i => i.vendorId === v.id));
  const tb = S.view === thisMon ? (new Date().getDay() + 6) % 7 : (S.view < thisMon ? 6 : -1);
  let rows = '';
  for (const v of vs) {
    const its = items.filter(i => i.vendorId === v.id); const o0 = R.out[its[0].id];
    let cells = '';
    for (let b = 0; b < 6; b++) {
      const st = its.filter(i => ((E[i.id] || {}).stock || [])[b] != null && ((E[i.id] || {}).stock || [])[b] !== '').length;
      const ordDay = o0.off[b] != null; const hol = ordDay && o0.hol[b];
      let o = '';
      if (!ordDay) o = '<span class="sub">발주 없음</span>';
      else if (hol) o = '<span class="pill">휴무</span>';
      else if (actCovered(S.view, b, v.id)) o = '<span class="pill act">발주 파일</span>';
      else { const n = its.filter(i => ((E[i.id] || {}).conf || [])[b] != null && ((E[i.id] || {}).conf || [])[b] !== '').length; o = n ? `<span class="pill ok">내 발주 ${n}개</span>` : (b <= tb ? '<span class="pill bad">미입력</span>' : '<span class="sub">–</span>'); }
      const stc = st ? `<span class="num">재고 ${st}/${its.length}</span>` : (ordDay && !hol && b <= tb && !v.manual ? '<span class="pill bad">재고 없음</span>' : '<span class="sub">재고 –</span>');
      cells += `<td class="dsep ${b === (new Date().getDay() + 6) % 7 && S.view === thisMon ? 'today' : ''}">${stc}<div style="margin-top:3px">${o}</div></td>`;
    }
    rows += `<tr><td><b>${esc(v.name)}</b><div class="sub">${its.length}개 품목</div></td>${cells}</tr>`;
  }
  // 추천과 차이 큰 품목
  const diffs = [];
  for (const it of items) { const o = R.out[it.id]; for (let b = 0; b < 6; b++) { if (o.off[b] == null || o.hol[b]) continue; const r = o.rec[b], c = o.conf[b]; if (typeof r !== 'number' || c == null) continue; const d = c - r; if (Math.abs(d) >= Math.max(2, r * 0.5)) diffs.push({ it, b, r, c, d, amt: d * (Number(it.price) || 0), act: actCovered(S.view, b, it.vendorId) }); } }
  diffs.sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
  let h = `<div class="top"><h1>입력 현황</h1>${weekNav()}</div>
    <div class="card"><h2>업체 · 요일별 입력 <span class="sub">재고 = 그날 재고를 넣은 품목 수 · 발주 = 발주 파일 반영 / 내 발주 입력 / 미입력</span></h2>
    <table><thead><tr><th>업체</th>${[0, 1, 2, 3, 4, 5].map(b => `<th class="dsep">${DN[b]} ${md(addDays(S.view, b))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card"><h2>추천과 많이 다른 발주 <span class="sub">차이가 2개 이상이면서 추천의 절반 이상 · 금액 큰 순</span></h2>${diffs.length ? `<table><thead><tr><th>요일</th><th>업체</th><th>품목</th><th class="r">추천</th><th class="r">발주</th><th class="r">차이</th><th class="r">금액 차이</th></tr></thead><tbody>${diffs.slice(0, 30).map(x => `<tr><td>${DN[x.b]}</td><td>${esc((S.vendors[x.it.vendorId] || {}).name || '')}</td><td>${esc(x.it.name)} ${x.act ? '<span class="pill act">파일</span>' : ''}</td><td class="r num">${fmt(x.r)}</td><td class="r num">${fmt(x.c)}</td><td class="r num ${x.d > 0 ? 'up' : 'down'}">${x.d > 0 ? '+' : ''}${fmt(x.d)}</td><td class="r num">${won(x.amt)}</td></tr>`).join('')}</tbody></table>` : '<div class="sub">추천과 크게 다른 발주가 없습니다.</div>'}
    <p class="note">재고가 실제와 다르게 입력됐거나, 행사·단체 예약처럼 특별한 이유가 있는지 확인해 보세요.</p></div>`;
  return h;
}

/* ----- 이벤트 (업체·품목 / 수불) ----- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-strend],[data-ssort],label'); if (!t) return;
  const d = t.dataset || {};
  if (d.isub) { S.isub = d.isub; render(); return; }
  if (d.ivf) { S.ivf = d.ivf; render(); return; }
  if (d.ion) { const it = S.catalog.find(x => x.id === d.ion); await saveItem(d.ion, { active: it.active === false }); render(); return; }
  if (d.imv) { const [id, dir] = d.imv.split(':'); const it = S.catalog.find(x => x.id === id); const sib = itemsSorted().filter(x => x.vendorId === it.vendorId); const i = sib.indexOf(it), j = i + Number(dir); if (j < 0 || j >= sib.length) return; [sib[i], sib[j]] = [sib[j], sib[i]]; S.hold = true; for (let k = 0; k < sib.length; k++) if (sib[k].order !== k + 1) await saveItem(sib[k].id, { order: k + 1 }); S.hold = false; render(); return; }
  if (t.hasAttribute('data-iadd')) { const vid = S.ivf && S.ivf !== '*' ? S.ivf : (vendorsSorted()[0] || {}).id; const id = 'i' + Date.now().toString(36); const n = S.catalog.filter(x => x.vendorId === vid).length; const it = { id, name: '새 품목', vendorId: vid, active: true, mult: 1, order: n + 1 }; S.catalog.push(it); await setDoc(`catalog/${id}`, it); S.ivf = vid; render(); toast('품목을 추가했습니다 · 이름과 코드를 넣어 주세요'); return; }
  if (t.hasAttribute('data-ipaste')) { S.paste = S.paste ? null : { text: '', vid: S.ivf && S.ivf !== '*' ? S.ivf : (vendorsSorted()[0] || {}).id }; render(); return; }
  if (t.hasAttribute('data-pclose')) { S.paste = null; render(); return; }
  if (t.hasAttribute('data-pcheck')) { S.paste.text = $('#ptext').value; S.paste.vid = $('#pven').value; S.paste.rows = parsePaste(S.paste.text); if (!S.paste.rows.length) toast('품목코드가 있는 줄을 찾지 못했습니다'); render(); return; }
  if (t.hasAttribute('data-pgo')) { const P = S.paste; let n = S.catalog.filter(x => x.vendorId === P.vid).length; S.hold = true; for (const r of P.rows.filter(r => !r.exists)) { const id = S.catalog.some(x => x.id === r.code) ? r.code + '-' + P.vid : r.code; const it = { id, code: r.code, name: r.name, spec: r.spec, unit: r.unit, price: r.price || null, vendorId: P.vid, active: true, mult: 1, order: ++n }; S.catalog.push(it); await setDoc(`catalog/${id}`, it); } S.hold = false; toast(`${P.rows.filter(r => !r.exists).length}개 품목을 추가했습니다`); S.paste = null; S.ivf = P.vid; render(); return; }
  if (d.bulk) {
    const ids = [...S.isel]; if (d.bulk === 'clear') { S.isel.clear(); render(); return; }
    S.hold = true;
    if (d.bulk === 'vendor') { const vid = $('#bulkV').value; for (const id of ids) await saveItem(id, { vendorId: vid }); toast(`${ids.length}개 품목을 ${(S.vendors[vid] || {}).name}(으)로 옮겼습니다`); }
    if (d.bulk === 'off' || d.bulk === 'on') { for (const id of ids) await saveItem(id, { active: d.bulk === 'on' }); toast(`${ids.length}개 품목을 ${d.bulk === 'on' ? '사용' : '사용 중지'}로 바꿨습니다`); }
    if (d.bulk === 'price') { const p = parseNum($('#bulkP').value); if (p == null || p === undefined) { S.hold = false; toast('단가를 숫자로 넣어 주세요'); return; } for (const id of ids) await saveItem(id, { price: p }); toast('단가를 바꿨습니다'); }
    S.hold = false; S.isel.clear(); render(); return;
  }
  if (d.vmv) { const [id, dir] = d.vmv.split(':'); const vs = vendorsSorted(); const i = vs.findIndex(v => v.id === id), j = i + Number(dir); if (j < 0 || j >= vs.length) return; [vs[i], vs[j]] = [vs[j], vs[i]]; S.hold = true; for (let k = 0; k < vs.length; k++) if (vs[k].order !== k + 1) await saveVendor(vs[k].id, { order: k + 1 }); S.hold = false; render(); return; }
  if (d.hv) { S.hv = d.hv; render(); return; }
  if (d.hm) { let [y, m] = (S.hm || todayId.slice(0, 7)).split('-').map(Number); m += Number(d.hm); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } S.hm = `${y}-${String(m).padStart(2, '0')}`; render(); return; }
  if (d.hd) { const [vid, id] = d.hd.split(':'); const v = S.vendors[vid]; const s = new Set(v.holDates || []); s.has(id) ? s.delete(id) : s.add(id); await saveVendor(vid, { holDates: [...s].sort() }); render(); return; }
  if (t.hasAttribute('data-vadd')) { const id = 'v' + Date.now().toString(36); const v = { id, name: '새 업체', sched: [null, null, null, null, null, null], order: Object.keys(S.vendors).length + 1 }; S.vendors[id] = v; await setDoc(`vendors/${id}`, v); S.hv = id; render(); toast('업체를 추가했습니다'); return; }
  if (d.smon) { S.smon = d.smon; S.strend = null; render(); return; }
  if (d.sscope) { S.sscope = d.sscope; render(); return; }
  if (d.ssort) { S.ssort = d.ssort; render(); return; }
  if (d.strend) { S.strend = d.strend; render(); return; }
  if (t.hasAttribute('data-supgo')) { S.sup.month = $('#supm').value || S.sup.month; S.sup.sales = $('#sups').value; S.sup.apply = $('#supa').checked && (!subulMonths().length || S.sup.month >= subulMonths()[subulMonths().length - 1]); t.disabled = true; await saveSubul(); return; }
  if (t.hasAttribute('data-supx')) { S.sup = null; render(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target; const d = t.dataset || {};
  if (t.id === 'sfile') { await onSubulFile(t.files[0]); t.value = ''; return; }
  if (t.id === 'ioff') { S.ioff = t.checked; render(); return; }
  if (d.isel) { t.checked ? S.isel.add(d.isel) : S.isel.delete(d.isel); render(); return; }
  if (t.hasAttribute('data-iselall')) { const boxes = [...document.querySelectorAll('[data-isel]')]; boxes.forEach(b => t.checked ? S.isel.add(b.dataset.isel) : S.isel.delete(b.dataset.isel)); render(); return; }
  if (d.iv) { await saveItem(d.iv, { vendorId: t.value }); render(); return; }
  if (d.if) { const [id, k] = d.if.split(':'); const num = IF.find(f => f[0] === k)[2] === 'n'; let v = t.value.trim(); if (num) { v = parseNum(v); if (v === undefined) { toast('숫자만 입력하세요'); return; } } await saveItem(id, { [k]: v }); t.style.background = 'var(--ok-soft)'; setTimeout(() => t.style.background = '', 600); return; }
  if (d.vf) { const [id, k] = d.vf.split(':'); await saveVendor(id, { [k]: t.value.trim() || (k === 'group' ? null : t.value) }); return; }
  if (d.vk) { await saveVendor(d.vk, { manual: t.value === '1' }); render(); return; }
  if (d.vs != null) { const vid = t.closest('[data-vsc]').dataset.vsc; const v = S.vendors[vid]; const s = (v.sched || [null, null, null, null, null, null]).slice(); while (s.length < 6) s.push(null); s[Number(d.vs)] = t.value === '' ? null : Number(t.value); await saveVendor(vid, { sched: s }); render(); return; }
  if (d.vnw) { await saveVendor(d.vnw, { nthWeek: t.value ? Number(t.value) : null }); render(); return; }
  if (d.vnd) { await saveVendor(d.vnd, { nthDay: t.value || null }); render(); return; }
  if (t.id === 'smsales') { const v = parseNum(t.value); const mk = S.smon && subulMonths().includes(S.smon) ? S.smon : subulMonths().slice(-1)[0]; const D = S.meta['subul_' + mk]; if (v === undefined) { toast('숫자만 입력하세요'); return; } await setDoc(`meta/subul_${mk}`, Object.assign({}, D, { sales: v })); S.meta['subul_' + mk] = Object.assign({}, D, { sales: v }); render(); return; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'iq' || t.id === 'sq') { S[t.id] = t.value; clearTimeout(S._q2); S._q2 = setTimeout(() => { const pos = t.selectionStart; render(); const el = $('#' + t.id); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); }
});
document.addEventListener('keydown', e => { const t = e.target; if (e.key === 'Enter' && t.tagName === 'INPUT' && (t.dataset.if || t.dataset.vf)) t.blur(); });

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-tab]'); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; try { localStorage.setItem('adm.tab', S.tab); } catch (x) {} render(); window.scrollTo(0, 0); return; }
  if (t.dataset.wk != null) { const d = Number(t.dataset.wk); S.view = d === 0 ? thisMon : addDays(S.view, 7 * d); subEntries(); render(); return; }
  if (t.dataset.gvf != null) { S.gvf = t.dataset.gvf; render(); return; }
  if (t.hasAttribute('data-upgo')) { t.disabled = true; applyUpload(); return; }
  if (t.hasAttribute('data-upcancel')) { S.up = null; render(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'ofile') { await onOrderFile(t.files[0]); t.value = ''; return; }
  if (t.id === 'upPrice' && S.up) { S.up.upPrice = t.checked; return; }
  const k = t.dataset && t.dataset.k; if (!k) return;
  const [kind, id, bs] = k.split(':'); const b = Number(bs);
  const v = parseNum(t.value); if (v === undefined) { toast('숫자만 입력하세요'); return; }
  t.classList.toggle('set', v != null);
  if (kind === 'stock') await setEntry(S.view, id, c => { c.stock = arrSet(c.stock, b, v); });
  if (kind === 'conf') await setEntry(S.view, id, c => { c.conf = arrSet(c.conf, b, v); });
});
document.addEventListener('input', e => { if (e.target.id === 'gq') { S.q = e.target.value; clearTimeout(S._qt); S._qt = setTimeout(() => { const pos = e.target.selectionStart; render(); const el = $('#gq'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); } });
document.addEventListener('keydown', e => {
  const t = e.target; if (!(t.dataset && t.dataset.k)) return;
  const r = Number(t.dataset.r), c = Number(t.dataset.c);
  let nr = null, nc = null;
  if (e.key === 'Enter' || e.key === 'ArrowDown') { nr = r + 1; nc = c; }
  else if (e.key === 'ArrowUp') { nr = r - 1; nc = c; }
  else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) { nr = r; nc = c + 1; }
  else if (e.key === 'ArrowLeft' && t.selectionStart === 0) { nr = r; nc = c - 1; }
  if (nr == null) return;
  e.preventDefault();
  let el = null;
  if (nc !== c) { const all = [...document.querySelectorAll(`input[data-r="${nr}"]`)].sort((a, b) => a.dataset.c - b.dataset.c); el = nc > c ? all.find(x => Number(x.dataset.c) > c) : all.reverse().find(x => Number(x.dataset.c) < c); }
  else el = document.querySelector(`input[data-r="${nr}"][data-c="${nc}"]`);
  if (el) { t.dispatchEvent(new Event('change', { bubbles: true })); el.focus(); el.select(); }
});
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } }));
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); onOrderFile(e.dataTransfer.files[0]); } });

/* ---------- boot ---------- */
render();
(async () => {
  const db = window.claude ? await window.claude.use('db') : null;
  if (!db) { $('#conn').textContent = '연결 실패'; return; }
  S.db = db; $('#conn').textContent = '실시간 연결됨';
  window.claude.use('downloads').then(d => { S.dl = d; schedule(); });
  db.doc('config/main').onSnapshot(s => { S.settings = Object.assign({ safety: 1.2, monInc: true }, s.exists ? s.data() : {}); S.ready.cfg = true; schedule(); }, onErr);
  db.collection('vendors').onSnapshot(s => { const m = {}; s.docs.forEach(d => m[d.id] = Object.assign({ id: d.id }, d.data())); S.vendors = m; S.ready.ven = true; schedule(); }, onErr);
  db.collection('catalog').onSnapshot(s => { S.catalog = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); S.ready.cat = true; schedule(); }, onErr);
  db.collection('weeks').onSnapshot(s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.weeks = m; S.ready.wk = true; schedule(); }, onErr);
  db.collection('meta').onSnapshot(s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); S.meta = m; schedule(); }, onErr);
  subEntries();
})();
