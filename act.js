/* 실제 발주(발주 사이트 파일) 반영 — 폰 앱과 PC 관리자 화면이 같이 씀
   weeks/{주}.actV[업체id][b] = 그 업체·요일은 발주 파일을 올렸음(true)
   weeks/{주}/items/{품목}.act[b] / actAmt[b] = 파일의 실제 주문 수량 / 공급가
   파일을 올린 업체·요일은 실제 수량(파일에 없으면 0)으로, 안 올린 날은 "내 발주"로 계산 */
function actCovered(wid, b, vid) {
  const w = (S.weeks || {})[wid] || {}; const av = w.actV || {};
  if (vid) return !!(av[vid] || [])[b];
  return Object.values(av).some(a => !!(a || [])[b]);
}
function effEntries() {
  const out = {};
  const vOf = {}; for (const it of (S.catalog || [])) vOf[it.id] = it.vendorId;
  for (const wid of Object.keys(S.entries || {})) {
    const W = (S.weeks || {})[wid] || {}; const av = W.actV || {}; const E = S.entries[wid] || {};
    if (!Object.keys(av).length) { out[wid] = E; continue; }
    const o = {}; const ids = new Set(Object.keys(E).concat((S.catalog || []).map(i => i.id)));
    for (const id of ids) {
      const ad = av[vOf[id]] || [];
      const e = E[id] || {};
      if (!ad.some(Boolean)) { if (E[id]) o[id] = e; continue; }
      const c = Array.isArray(e.conf) ? e.conf.slice() : [];
      while (c.length < 6) c.push(null);
      for (let b = 0; b < 6; b++) if (ad[b]) { const a = (e.act || [])[b]; c[b] = (a === null || a === undefined || a === '') ? 0 : Number(a); }
      o[id] = Object.assign({}, e, { conf: c, myConf: e.conf || [] });
    }
    out[wid] = o;
  }
  return out;
}
