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
function schedule() { const ae = document.activeElement; if (ae && ae.tagName === 'INPUT' && ae.type !== 'file' && ae.closest('#main')) { S.pending = true; return; } if (!rq) { rq = true; requestAnimationFrame(() => { rq = false; render(); }); } }
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
  const f = { dash: vDash, grid: vGrid, upload: vUpload, items: vSoon, subul: vSoon, check: vSoon }[S.tab] || vDash;
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
    const j = r.indexOf('거래처'); if (j >= 0 && r.includes('주문일')) vFilter = (r[j + 1] || r[j + 2] || '').trim();
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
  db.doc('meta/orderfiles').onSnapshot(s => { S.meta.orderfiles = s.exists ? s.data() : {}; schedule(); }, onErr);
  subEntries();
})();
