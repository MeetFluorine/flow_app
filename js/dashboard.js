(function(){
"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'inward',
  summary: [],           // all movements_summary rows for current mode
  summaryCache: {},      // mode -> { rows, fetchedAt } — lets tab switches render instantly
  filters: { months:new Set(), items:new Set(), stores:new Set(), circles:new Set(), txn:'allocate', flow:null },
  chartMode: 'store',
  page: 1,
  pageSize: 50,
  sort: { key:'qty', dir:'desc' },
  detailTotal: 0,
  detailRows: []
};

const STANDARD_COLUMNS = [
  {k:'month_label', label:'Month'},
  {k:'moir', label:'MO/IR Number'},
  {k:'mo_status', label:'MO Status'},
  {k:'item_code', label:'Item Code'},
  {k:'serial_no', label:'Serial Number'},
  {k:'item_description', label:'Item Description', cls:'desc'},
  {k:'store', label:'Store (SS)'},
  {k:'circle', label:'Circle'},
  {k:'ordered_qty', label:'Ordered Qnty'},
  {k:'non_serial_qty', label:'NonSerialised Inward Qnty'},
  {k:'is_serialised', label:'Serialised Inward'},
  {k:'qty', label:'Qty'}
];
const ISSUANCE_COLUMNS = [
  {k:'month_label', label:'Month'},
  {k:'moir', label:'Transaction Number'},
  {k:'engineer_name', label:'Engineer Name'},
  {k:'item_code', label:'Item Code'},
  {k:'serial_no', label:'Serial Number'},
  {k:'item_description', label:'Item Description', cls:'desc'},
  {k:'store', label:'Store (SS)'},
  {k:'circle', label:'Circle'},
  {k:'material_type', label:'Material Type'},
  {k:'txn_type', label:'Txn Type'},
  {k:'qty', label:'Qty'}
];
function currentColumns(){ return state.mode === 'issuance' ? ISSUANCE_COLUMNS : STANDARD_COLUMNS; }

/* ======================= mode switching ======================= */
document.getElementById('modeSeg').addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  [...e.currentTarget.children].forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  setMode(btn.dataset.v);
});
function setMode(mode){
  state.mode = mode;
  document.getElementById('view-dashboard').setAttribute('data-mode', mode);
  $('modeIndicatorText').textContent = mode==='inward' ? 'MRS INWARD' : mode==='issuance' ? 'ISSUANCE' : 'S2S TRANSFER';
  document.getElementById('txnField').style.display = mode==='issuance' ? '' : 'none';
  document.getElementById('flowField').classList.toggle('hidden', mode!=='s2s');
  state.filters = { months:new Set(), items:new Set(), stores:new Set(), circles:new Set(), txn:'allocate', flow:null };
  state.page = 1;

  const cached = state.summaryCache[mode];
  if(cached){
    // Instant render from what we already have, then quietly refresh behind it —
    // no blank/stale-looking KPIs while switching between already-visited modes.
    state.summary = cached.rows;
    onSummaryReady(mode, /*background=*/false);
    loadMode(mode, /*background=*/true);
  } else {
    // Never fetched this mode yet — show a clear loading state rather than
    // leaving the previous mode's numbers on screen.
    state.summary = [];
    $('statTotalQty').textContent = '…';
    $('statItems').textContent = '…';
    $('statStores').textContent = '…';
    $('statMonths').textContent = '…';
    $('statRows').textContent = '…';
    $('loadedStats').textContent = 'Loading…';
    loadMode(mode, /*background=*/false);
  }
}

async function fetchAllRows(builderFn, pageSize){
  pageSize = pageSize || 1000;
  let all = [];
  let from = 0;
  while(true){
    const { data, error } = await builderFn().range(from, from+pageSize-1);
    if(error) throw new Error(error.message);
    all = all.concat(data||[]);
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function loadMode(mode, background){
  if(background) $('loadedStats').textContent += ' · refreshing…';
  let rows;
  try{
    rows = await fetchAllRows(()=> db.from('movements_summary').select('*').eq('report_type', mode));
  }catch(err){
    if(!background){ $('loadedStats').textContent = 'Could not load data: ' + err.message; }
    return;
  }
  if(mode !== state.mode) return; // user switched again before this resolved
  state.summaryCache[mode] = { rows, fetchedAt: Date.now() };
  state.summary = rows;
  onSummaryReady(mode, background);
}

function onSummaryReady(mode, background){
  const totalRecords = state.summary.reduce((a,r)=>a+(r.record_count||0),0);
  $('loadedStats').textContent = state.summary.length.toLocaleString() + ' item×store×month combinations loaded (' + totalRecords.toLocaleString() + ' underlying rows)';

  if(mode === 's2s'){
    const flows = Array.from(new Set(state.summary.map(r=>r.flow).filter(Boolean)));
    if(!state.filters.flow || !flows.includes(state.filters.flow)) state.filters.flow = flows[0] || null;
    const flowSeg = $('flowSeg');
    flowSeg.innerHTML = flows.map((f,i)=> '<button data-v="'+escapeHtml(f)+'" class="'+(f===state.filters.flow?'on':'')+'">'+escapeHtml(f)+'</button>').join('');
    [...flowSeg.children].forEach(btn=>{
      btn.addEventListener('click', ()=>{
        [...flowSeg.children].forEach(b=>b.classList.remove('on'));
        btn.classList.add('on');
        state.filters.flow = btn.dataset.v;
        state.page = 1;
        renderAll();
      });
    });
  }

  buildComboOptions();
  renderTableHeader();
  renderAll();
}

/** Forces a fresh fetch of whatever mode is currently selected — used when the
    Dashboard tab is re-opened, so newly-uploaded data shows up without a
    manual page reload. */
function refreshCurrentMode(){
  delete state.summaryCache[state.mode];
  setMode(state.mode);
}

/* ======================= combos (searchable multi-select) ======================= */
function makeCombo(inputId, listId, getOptions, filterSet, placeholder){
  const oldInput = document.getElementById(inputId);
  const oldList = document.getElementById(listId);
  const input = oldInput.cloneNode(true);
  const list = oldList.cloneNode(true);
  oldInput.parentNode.replaceChild(input, oldInput);
  oldList.parentNode.replaceChild(list, oldList);

  function renderList(query){
    const q = (query||'').trim().toLowerCase();
    const opts = getOptions();
    const filtered = q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts;
    list.innerHTML = '';
    if(filtered.length === 0){
      list.innerHTML = '<div class="combo-opt" style="cursor:default;">No matches</div>';
    } else {
      filtered.slice(0,200).forEach(o=>{
        const div = document.createElement('div');
        div.className = 'combo-opt' + (filterSet.has(o.value) ? ' hi' : '');
        div.innerHTML = '<span>' + (filterSet.has(o.value)?'✓ ':'') + escapeHtml(o.label) + '</span>';
        div.addEventListener('mousedown', (e)=>{
          e.preventDefault();
          if(filterSet.has(o.value)) filterSet.delete(o.value); else filterSet.add(o.value);
          input.value = '';
          renderList('');
          renderChips();
          state.page = 1;
          renderAll();
        });
        list.appendChild(div);
      });
    }
    list.classList.add('open');
  }
  input.addEventListener('focus', ()=> renderList(input.value));
  input.addEventListener('input', ()=> renderList(input.value));
  input.addEventListener('blur', ()=> setTimeout(()=> list.classList.remove('open'), 150));
  input.placeholder = placeholder;
  return { renderList };
}

function buildComboOptions(){
  const months = Array.from(new Set(state.summary.map(r=>r.month_label)));
  const items = Array.from(new Map(state.summary.map(r=>[r.item_code, r.item_description])).entries());
  const stores = Array.from(new Set(state.summary.map(r=>r.store))).sort();
  const circles = Array.from(new Set(state.summary.map(r=>r.circle).filter(c=>c))).sort();

  makeCombo('monthInput','monthList', ()=> months.map(m=>({value:m,label:m})), state.filters.months, 'All months');
  makeCombo('itemInput','itemList', ()=> items.sort((a,b)=>a[0].localeCompare(b[0])).map(([code,desc])=>({value:code,label:code+(desc?' — '+String(desc).slice(0,40):'')})), state.filters.items, 'All items');
  makeCombo('storeInput','storeList', ()=> stores.map(s=>({value:s,label:s})), state.filters.stores, 'All stores');
  makeCombo('circleInput','circleList', ()=> circles.map(c=>({value:c,label:c})), state.filters.circles, 'All circles');
}

function renderChips(){
  const wrap = $('activeChips');
  wrap.innerHTML = '';
  const groups = [
    ['months', state.filters.months], ['items', state.filters.items],
    ['stores', state.filters.stores], ['circles', state.filters.circles]
  ];
  groups.forEach(([name,set])=>{
    set.forEach(val=>{
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = escapeHtml(val) + ' <button>×</button>';
      chip.querySelector('button').addEventListener('click', ()=>{
        set.delete(val); renderChips(); state.page=1; renderAll();
      });
      wrap.appendChild(chip);
    });
  });
}

$('clearFiltersBtn').addEventListener('click', ()=>{
  state.filters.months.clear(); state.filters.items.clear();
  state.filters.stores.clear(); state.filters.circles.clear();
  renderChips(); state.page = 1; renderAll();
});
document.getElementById('txnSeg').addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  [...e.currentTarget.children].forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  state.filters.txn = btn.dataset.v;
  renderAll();
});
document.getElementById('chartSeg').addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  [...e.currentTarget.children].forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  state.chartMode = btn.dataset.v;
  renderAll();
});

/* ======================= KPI + chart (computed from summary table) ======================= */
function qtyOfSummaryRow(r){
  if(state.mode !== 'issuance') return Number(r.qty)||0;
  const allocate = Number(r.qty)||0, recover = Number(r.recover_qty)||0;
  if(state.filters.txn === 'allocate') return allocate;
  if(state.filters.txn === 'recover') return recover;
  if(state.filters.txn === 'all') return allocate + recover;
  return allocate - recover;
}
function filteredSummary(){
  const f = state.filters;
  return state.summary.filter(r=>{
    if(f.months.size && !f.months.has(r.month_label)) return false;
    if(f.items.size && !f.items.has(r.item_code)) return false;
    if(f.stores.size && !f.stores.has(r.store)) return false;
    if(f.circles.size && !f.circles.has(r.circle)) return false;
    if(state.mode === 's2s' && f.flow && r.flow !== f.flow) return false;
    return true;
  });
}

function renderAll(){
  const rows = filteredSummary();
  let totalQty = 0, totalRecords = 0;
  const itemSet=new Set(), storeSet=new Set(), monthSet=new Set();
  const byStore=new Map(), byItem=new Map(), byMonth=new Map();
  rows.forEach(r=>{
    const q = qtyOfSummaryRow(r);
    totalQty += q;
    totalRecords += r.record_count||0;
    itemSet.add(r.item_code); storeSet.add(r.store); monthSet.add(r.month_label);
    byStore.set(r.store, (byStore.get(r.store)||0)+q);
    byItem.set(r.item_code, (byItem.get(r.item_code)||0)+q);
    byMonth.set(r.month_label, (byMonth.get(r.month_label)||0)+q);
  });
  $('statTotalQty').textContent = Math.round(totalQty).toLocaleString();
  $('statItems').textContent = itemSet.size.toLocaleString();
  $('statStores').textContent = storeSet.size.toLocaleString();
  $('statMonths').textContent = monthSet.size.toLocaleString();
  $('statRows').textContent = totalRecords.toLocaleString();

  renderChart(byStore, byItem, byMonth);
  loadDetailPage(state.page);
}

function monthOrderOf(label){
  const r = state.summary.find(x=>x.month_label===label);
  return r ? r.month_order : 99;
}
function renderChart(byStore, byItem, byMonth){
  const body = $('chartBody');
  let source = byStore;
  if(state.chartMode === 'item') source = byItem;
  else if(state.chartMode === 'month'){
    source = new Map(Array.from(byMonth.entries()).sort((a,b)=> monthOrderOf(a[0]) - monthOrderOf(b[0])));
  }
  const entries = Array.from(source.entries());
  const top = state.chartMode==='month' ? entries : entries.sort((a,b)=>b[1]-a[1]).slice(0,15);
  const max = Math.max(1, ...top.map(e=>e[1]));
  if(top.length === 0){
    body.innerHTML = '<div class="emptystate">No data matches the current filters.</div>';
    return;
  }
  body.innerHTML = top.map(([label,val])=>{
    const pct = Math.max(2, (val/max)*100);
    return '<div class="chartbar"><div class="name" title="'+escapeHtml(label)+'">'+escapeHtml(label)+'</div>'+
      '<div class="track"><div class="fill" style="width:'+pct+'%"></div></div>'+
      '<div class="num">'+Math.round(val).toLocaleString()+'</div></div>';
  }).join('');
}

/* ======================= detail table (server-paginated) ======================= */
function renderTableHeader(){
  const cols = currentColumns();
  $('tableHead').innerHTML = '<tr>' + cols.map(c =>
    '<th' + (c.cls ? ' class="'+c.cls+'"' : '') + ' data-k="'+c.k+'">' + escapeHtml(c.label) + '</th>'
  ).join('') + '</tr>';
  document.querySelectorAll('#dataTable th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const k = th.dataset.k;
      if(state.sort.key === k){ state.sort.dir = state.sort.dir==='asc'?'desc':'asc'; }
      else { state.sort.key = k; state.sort.dir = 'desc'; }
      state.page = 1;
      renderAll();
    });
  });
}

function baseQuery(){
  let q = db.from('movements_raw').select('*', { count:'exact' }).eq('report_type', state.mode);
  const f = state.filters;
  if(f.months.size) q = q.in('month_label', Array.from(f.months));
  if(f.items.size) q = q.in('item_code', Array.from(f.items));
  if(f.stores.size) q = q.in('store', Array.from(f.stores));
  if(f.circles.size) q = q.in('circle', Array.from(f.circles));
  if(state.mode === 's2s' && f.flow) q = q.eq('flow', f.flow);
  const search = $('tableSearch').value.trim();
  if(search){
    const s = search.replace(/[%_]/g,'');
    q = q.or(['item_code.ilike.%'+s+'%','store.ilike.%'+s+'%','item_description.ilike.%'+s+'%','moir.ilike.%'+s+'%','mo_status.ilike.%'+s+'%','serial_no.ilike.%'+s+'%','engineer_name.ilike.%'+s+'%','material_type.ilike.%'+s+'%'].join(','));
  }
  return q;
}

async function loadDetailPage(page){
  const start = (page-1)*state.pageSize;
  const end = start + state.pageSize - 1;
  const sortCol = ['month_label','moir','mo_status','item_code','serial_no','item_description','store','circle','ordered_qty','non_serial_qty','is_serialised','qty','engineer_name','material_type','txn_type'].includes(state.sort.key) ? state.sort.key : 'qty';
  let q = baseQuery().order(sortCol, { ascending: state.sort.dir==='asc' }).range(start, end);
  const { data, error, count } = await q;
  if(error){
    $('tableBody').innerHTML = '<tr><td colspan="'+currentColumns().length+'"><div class="emptystate">Could not load rows: '+escapeHtml(error.message)+'</div></td></tr>';
    return;
  }
  state.detailRows = data || [];
  state.detailTotal = count || 0;
  renderTableBody();
}

function cellText(r, k){
  if(k === 'is_serialised') return r.is_serialised ? 'True' : 'False';
  if(k === 'ordered_qty' || k === 'non_serial_qty') return r[k]==null ? '—' : Math.round(r[k]).toLocaleString();
  if(k === 'qty'){
    if(state.mode === 'issuance') return Math.round(qtyOfSummaryRow({ qty:r.qty, recover_qty:r.recover_qty })).toLocaleString();
    return Math.round(r.qty||0).toLocaleString();
  }
  const v = r[k];
  return (v===null || v===undefined || v==='') ? '—' : v;
}

function renderTableBody(){
  const cols = currentColumns();
  const tbody = $('tableBody');
  if(!state.detailRows.length){
    tbody.innerHTML = '<tr><td colspan="'+cols.length+'"><div class="emptystate">No rows match the current filters / search.</div></td></tr>';
  } else {
    tbody.innerHTML = state.detailRows.map(r=>
      '<tr>' + cols.map(c=>
        c.k === 'item_description'
          ? '<td class="desc" title="'+escapeHtml(r.item_description||'')+'">'+escapeHtml(r.item_description||'—')+'</td>'
          : '<td>'+escapeHtml(String(cellText(r,c.k)))+'</td>'
      ).join('') + '</tr>'
    ).join('');
  }
  const totalPages = Math.max(1, Math.ceil(state.detailTotal / state.pageSize));
  $('tableCount').textContent = state.detailTotal.toLocaleString() + ' matching rows';
  $('pageLabel').textContent = state.page + ' / ' + totalPages;
  document.querySelectorAll('#dataTable th').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.k === state.sort.key);
  });
}

$('tableSearch').addEventListener('input', debounce(()=>{ state.page = 1; loadDetailPage(1); }, 350));
$('prevPageBtn').addEventListener('click', ()=>{ if(state.page>1){ state.page--; loadDetailPage(state.page); } });
$('nextPageBtn').addEventListener('click', ()=>{
  const totalPages = Math.max(1, Math.ceil(state.detailTotal / state.pageSize));
  if(state.page<totalPages){ state.page++; loadDetailPage(state.page); }
});
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

/* ======================= CSV export (all filtered rows, paginated fetch) ======================= */
$('exportCsvBtn').addEventListener('click', async ()=>{
  const btn = $('exportCsvBtn');
  btn.disabled = true; btn.textContent = 'Exporting…';
  try{
    const rows = await fetchAllRows(()=> baseQuery().order('qty', {ascending:false}));
    if(!rows.length){ alert('There is no data to export — adjust or clear your filters and try again.'); return; }
    const cols = currentColumns();
    const header = cols.map(c=>c.label);
    const lines = [header.join(',')];
    rows.forEach(r=>{
      const vals = cols.map(c=>{
        const v = cellText(r, c.k);
        return typeof v === 'string' && (v.includes(',')||v.includes('"')) ? '"'+v.replace(/"/g,'""')+'"' : v;
      });
      lines.push(vals.join(','));
    });
    const csvText = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csvText], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const namePrefix = state.mode==='inward' ? 'mrs_inward' : state.mode==='issuance' ? 'issuance' : 's2s_transfer';
    const a = document.createElement('a');
    a.href = url; a.download = namePrefix + '_filtered.csv'; a.style.display='none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
  }catch(err){
    alert('Could not export CSV: ' + (err && err.message ? err.message : err));
  }finally{
    btn.disabled = false; btn.textContent = 'Export CSV';
  }
});

let hasLoadedOnce = false;
function initDashboard(){
  if(!hasLoadedOnce){
    hasLoadedOnce = true;
    setMode('inward');
  } else {
    refreshCurrentMode();
  }
}

window.DashboardView = { init: initDashboard, refreshCurrentMode: refreshCurrentMode };
})();
