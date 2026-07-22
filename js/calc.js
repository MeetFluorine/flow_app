(function(){
"use strict";

const $ = (id) => document.getElementById(id);
const state = { itemOptions: [], storeOptions: [], s2sFlowDir: {}, calc:{item:'',store:'',i360:0,physical:0}, calcResult:null };

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

async function loadOptions(){
  const rows = await fetchAllRows(()=> db.from('movements_summary').select('item_code,item_description,store'));
  const itemMap = new Map();
  const storeSet = new Set();
  rows.forEach(r=>{
    if(!itemMap.has(r.item_code) || (!itemMap.get(r.item_code) && r.item_description)) itemMap.set(r.item_code, r.item_description);
    if(r.store) storeSet.add(r.store);
  });
  state.itemOptions = Array.from(itemMap.entries()).map(([code,desc])=>({value:code,label:code+(desc?' — '+String(desc).slice(0,60):'')})).sort((a,b)=>a.value.localeCompare(b.value));
  state.storeOptions = Array.from(storeSet).sort().map(s=>({value:s,label:s}));
  makeSingleCombo('calcItemInput','calcItemList', ()=>state.itemOptions, 'All items');
  makeSingleCombo('calcStoreInput','calcStoreList', ()=>state.storeOptions, 'All stores');
}

function makeSingleCombo(inputId, listId, getOptions, placeholder){
  const oldInput = $(inputId);
  const oldList = $(listId);
  const input = oldInput.cloneNode(true);
  const list = oldList.cloneNode(true);
  oldInput.parentNode.replaceChild(input, oldInput);
  oldList.parentNode.replaceChild(list, oldList);
  function renderList(query){
    const q = (query||'').trim().toLowerCase();
    const opts = getOptions();
    const filtered = q ? opts.filter(o=>o.label.toLowerCase().includes(q)) : opts;
    list.innerHTML = '';
    if(!filtered.length){
      list.innerHTML = '<div class="combo-opt" style="cursor:default;">No matches</div>';
    } else {
      filtered.slice(0,200).forEach(o=>{
        const div = document.createElement('div');
        div.className = 'combo-opt';
        div.innerHTML = '<span>'+escapeHtml(o.label)+'</span>';
        div.addEventListener('mousedown', (e)=>{
          e.preventDefault();
          input.value = o.value;
          list.classList.remove('open');
        });
        list.appendChild(div);
      });
    }
    list.classList.add('open');
  }
  input.addEventListener('focus', ()=> renderList(input.value));
  input.addEventListener('input', ()=> renderList(input.value));
  input.addEventListener('blur', ()=> setTimeout(()=>list.classList.remove('open'), 150));
  input.placeholder = placeholder;
}

function matchVal(v, target){
  return String(v==null?'':v).trim().toLowerCase() === String(target||'').trim().toLowerCase();
}
function numOrZeroLocal(v){ if(v==null||v==='') return 0; const n = typeof v==='number'?v:parseFloat(v); return isNaN(n)?0:n; }

async function computeCalculation(item, store){
  const res = { item, store, inwardRows:[], s2sInRows:[], s2sOutRows:[], issuanceByMonth:new Map(), hasUnknownFlow:false };

  const rows = await fetchAllRows(()=> db.from('movements_raw').select('*').ilike('item_code', item).ilike('store', store));

  rows.filter(r=>r.report_type==='inward').forEach(r=>{
    res.inwardRows.push({ order:r.month_order, month:r.month_label, moir:r.moir||'—', ordered:r.ordered_qty||0, qty:r.qty||0, circle:r.circle||'—' });
  });

  const s2sFlowsSeen = new Set();
  rows.filter(r=>r.report_type==='s2s').forEach(r=>{
    const flow = r.flow || '';
    s2sFlowsSeen.add(flow);
    const dir = state.s2sFlowDir[flow] || classifyS2SFlow(flow);
    if(dir === 'unknown') res.hasUnknownFlow = true;
    const row = { order:r.month_order, month:r.month_label, moir:r.moir||'—', ordered:r.ordered_qty||0, qty:r.qty||0, circle:r.circle||'—', flow };
    if(dir === 'outward') res.s2sOutRows.push(row); else res.s2sInRows.push(row);
  });
  res.s2sFlows = Array.from(s2sFlowsSeen);

  rows.filter(r=>r.report_type==='issuance').forEach(r=>{
    const net = (r.qty||0) - (r.recover_qty||0);
    const key = r.month_order + '|' + r.month_label;
    const cur = res.issuanceByMonth.get(key) || { order:r.month_order, month:r.month_label, qty:0, circle:r.circle||'—' };
    cur.qty += net;
    res.issuanceByMonth.set(key, cur);
  });

  const byMonth = (a,b)=> a.order-b.order;
  res.inwardRows.sort(byMonth);
  res.s2sInRows.sort(byMonth);
  res.s2sOutRows.sort(byMonth);
  res.issuanceRows = Array.from(res.issuanceByMonth.values()).sort(byMonth);

  res.totalInward = res.inwardRows.reduce((a,r)=>a+r.qty,0);
  res.totalS2sIn = res.s2sInRows.reduce((a,r)=>a+r.qty,0);
  res.totalIssuance = res.issuanceRows.reduce((a,r)=>a+r.qty,0);
  res.totalS2sOut = res.s2sOutRows.reduce((a,r)=>a+r.qty,0);
  res.combinedInward = res.totalInward + res.totalS2sIn;
  res.combinedIssued = res.totalIssuance + res.totalS2sOut;
  res.remainingCalculated = res.combinedInward - res.combinedIssued;
  return res;
}

function renderSimpleTable(tableEl, columns, rows, totalRow){
  let html = '<thead><tr>' + columns.map(c=>'<th>'+escapeHtml(c.label)+'</th>').join('') + '</tr></thead><tbody>';
  if(!rows.length){
    html += '<tr><td colspan="'+columns.length+'"><div class="emptystate">No matching rows in this report.</div></td></tr>';
  } else {
    rows.forEach(r=>{
      html += '<tr>' + columns.map(c=>'<td>'+escapeHtml(String(c.get(r)))+'</td>').join('') + '</tr>';
    });
  }
  if(totalRow){
    html += '<tr style="font-weight:600;">' + columns.map(c=>'<td>'+escapeHtml(String(c.get(totalRow)))+'</td>').join('') + '</tr>';
  }
  html += '</tbody>';
  tableEl.innerHTML = html;
}

function renderCalcFlowMap(result){
  const box = $('calcFlowMap');
  if(!result.s2sFlows || !result.s2sFlows.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '<b>S2S sheet direction</b> — auto-detected from the sheet name, click any of these to flip it if it\'s wrong:'
    + '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">'
    + result.s2sFlows.map(f=>{
        const dir = state.s2sFlowDir[f] || classifyS2SFlow(f) || 'unknown';
        return '<button class="btn ghost small calc-flow-btn" data-flow="'+escapeHtml(f)+'">'+escapeHtml(f)+' → <b>'+dir+'</b></button>';
      }).join('')
    + '</div>';
  box.querySelectorAll('.calc-flow-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const f = btn.dataset.flow;
      const cur = state.s2sFlowDir[f] || classifyS2SFlow(f);
      state.s2sFlowDir[f] = cur === 'inward' ? 'outward' : 'inward';
      const result = await computeCalculation(state.calc.item, state.calc.store);
      state.calcResult = result;
      renderCalcResults(result);
    });
  });
}

function renderCalcResults(result){
  $('calcResults').classList.remove('hidden');
  renderCalcFlowMap(result);
  const i360 = state.calc.i360 || 0;
  const physical = state.calc.physical || 0;
  const gap = i360 - physical;
  const variance = i360 - result.remainingCalculated;

  const inwardCols = [
    {label:'Month', get:r=>r.month}, {label:'MO/IR Number', get:r=>r.moir},
    {label:'Ordered Qnty', get:r=>Math.round(r.ordered).toLocaleString()},
    {label:'Inward Qnty', get:r=>Math.round(r.qty).toLocaleString()}, {label:'Circle', get:r=>r.circle}
  ];
  const s2sOutCols = [
    {label:'Month', get:r=>r.month}, {label:'MO/IR Number', get:r=>r.moir},
    {label:'Ordered Qnty', get:r=>Math.round(r.ordered).toLocaleString()},
    {label:'Outward Qnty', get:r=>Math.round(r.qty).toLocaleString()}, {label:'Circle', get:r=>r.circle}
  ];
  const issuanceCols = [
    {label:'Month', get:r=>r.month}, {label:'Quantity', get:r=>Math.round(r.qty).toLocaleString()}, {label:'Circle', get:r=>r.circle}
  ];
  const finalCols = [{label:'Metric', get:r=>r.label}, {label:'Value', get:r=>r.value}];

  renderSimpleTable($('calcTableInward'), inwardCols, result.inwardRows,
    {month:'Total', moir:'', ordered:result.inwardRows.reduce((a,r)=>a+r.ordered,0), qty:result.totalInward, circle:''});
  renderSimpleTable($('calcTableS2sIn'), inwardCols, result.s2sInRows,
    {month:'Total', moir:'', ordered:result.s2sInRows.reduce((a,r)=>a+r.ordered,0), qty:result.totalS2sIn, circle:''});
  renderSimpleTable($('calcTableIssuance'), issuanceCols, result.issuanceRows,
    {month:'Total', qty:result.totalIssuance, circle:''});
  renderSimpleTable($('calcTableS2sOut'), s2sOutCols, result.s2sOutRows,
    {month:'Total', moir:'', ordered:result.s2sOutRows.reduce((a,r)=>a+r.ordered,0), qty:result.totalS2sOut, circle:''});
  renderSimpleTable($('calcTableFinal'), finalCols, [
    {label:'Combined Inward (MRS Inward + S2S In)', value:Math.round(result.combinedInward).toLocaleString()},
    {label:'Combined Issued (FE Issuance + S2S Out)', value:Math.round(result.combinedIssued).toLocaleString()},
    {label:'Remaining Stock (Calculated)', value:Math.round(result.remainingCalculated).toLocaleString()},
    {label:'Stock showing in I360 (manual entry)', value:Math.round(i360).toLocaleString()},
    {label:'Physical stock at store (manual entry)', value:Math.round(physical).toLocaleString()},
    {label:'Total Gap (I360 − Physical)', value:Math.round(gap).toLocaleString()},
    {label:'Variance (I360 − Calculated remaining)', value:Math.round(variance).toLocaleString()}
  ], null);

  if(result.hasUnknownFlow){
    $('calcMissingNote').classList.remove('hidden');
    $('calcMissingNote').innerHTML = '<b>Heads up:</b> at least one S2S sheet name didn\'t clearly say which direction it flows — use the "S2S sheet direction" buttons above to set it, then hit Calculate again.';
  } else {
    $('calcMissingNote').classList.add('hidden');
  }
}

$('calcRunBtn').addEventListener('click', async ()=>{
  const item = $('calcItemInput').value.trim();
  const store = $('calcStoreInput').value.trim();
  if(!item || !store){ alert('Pick both an item code and a store first.'); return; }
  $('calcRunBtn').disabled = true;
  $('calcRunBtn').textContent = 'Calculating…';
  try{
    state.calc = { item, store, i360: numOrZeroLocal($('calcI360Input').value), physical: numOrZeroLocal($('calcPhysicalInput').value) };
    const result = await computeCalculation(item, store);
    state.calcResult = result;
    renderCalcResults(result);
  }catch(err){
    alert('Could not run the calculation: ' + (err && err.message ? err.message : err));
  }finally{
    $('calcRunBtn').disabled = false;
    $('calcRunBtn').textContent = 'Calculate';
  }
});

$('calcExportBtn').addEventListener('click', ()=>{
  if(!state.calcResult){ alert('Run a calculation first.'); return; }
  exportCalcExcel(state.calcResult);
});

function exportCalcExcel(result){
  try{
    if(typeof XLSX === 'undefined'){ throw new Error('Spreadsheet engine not available.'); }
    const wsData = [];
    const merges = [];
    let row = 0;
    const addTitle = (text, span)=>{ wsData[row] = [text]; merges.push({s:{r:row,c:0}, e:{r:row,c:span-1}}); row++; };
    const addRow = (vals)=>{ wsData[row] = vals.slice(); row++; };
    const blank = ()=>{ row++; };
    const R = (r)=> r+1;

    const i360 = state.calc.i360 || 0;
    const physical = state.calc.physical || 0;

    addTitle('Calculation — ' + result.item + ' @ ' + result.store, 5);
    addRow(['Generated', new Date().toLocaleString()]);
    blank();

    addTitle('Total order received at store (MRS Inward)', 5);
    addRow(['Month','MO/IR Number','Ordered Qnty','Inward Qnty','Circle']);
    const inwardStart = row;
    result.inwardRows.forEach(r=> addRow([r.month, r.moir, Math.round(r.ordered), Math.round(r.qty), r.circle]));
    const inwardEnd = row - 1;
    const inwardTotalRow = row;
    addRow(['Total', '', result.inwardRows.reduce((a,r)=>a+r.ordered,0), result.totalInward, '']);
    blank();

    addTitle('Total S2S inward — Other to SDFX', 5);
    addRow(['Month','MO/IR Number','Ordered Qnty','Inward Qnty','Circle']);
    const s2sInStart = row;
    result.s2sInRows.forEach(r=> addRow([r.month, r.moir, Math.round(r.ordered), Math.round(r.qty), r.circle]));
    const s2sInEnd = row - 1;
    const s2sInTotalRow = row;
    addRow(['Total', '', result.s2sInRows.reduce((a,r)=>a+r.ordered,0), result.totalS2sIn, '']);
    blank();

    addTitle('Total issuance to FE — by month', 3);
    addRow(['Month','Quantity','Circle']);
    const issuanceStart = row;
    result.issuanceRows.forEach(r=> addRow([r.month, Math.round(r.qty), r.circle]));
    const issuanceEnd = row - 1;
    const issuanceTotalRow = row;
    addRow(['Total', result.totalIssuance, '']);
    blank();

    addTitle('Total S2S outward — SDFX to Other', 5);
    addRow(['Month','MO/IR Number','Ordered Qnty','Outward Qnty','Circle']);
    const s2sOutStart = row;
    result.s2sOutRows.forEach(r=> addRow([r.month, r.moir, Math.round(r.ordered), Math.round(r.qty), r.circle]));
    const s2sOutEnd = row - 1;
    const s2sOutTotalRow = row;
    addRow(['Total', '', result.s2sOutRows.reduce((a,r)=>a+r.ordered,0), result.totalS2sOut, '']);
    blank();

    addTitle('Final stats', 2);
    addRow(['Metric','Value']);
    const combinedInwardRow = row;   addRow(['Combined Inward (MRS Inward + S2S In)', result.combinedInward]);
    const combinedIssuedRow = row;   addRow(['Combined Issued (FE Issuance + S2S Out)', result.combinedIssued]);
    const remainingRow = row;        addRow(['Remaining stock (calculated)', result.remainingCalculated]);
    const i360Row = row;             addRow(['Stock showing in I360 (manual entry)', i360]);
    const physicalRow = row;         addRow(['Physical stock at store (manual entry)', physical]);
    const gapRow = row;              addRow(['Total gap (I360 - Physical)', i360 - physical]);
    const varianceRow = row;         addRow(['Variance (I360 - Calculated remaining)', i360 - result.remainingCalculated]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const setF = (addr, formula, value)=>{ ws[addr] = { t:'n', f:formula, v:value }; };
    if(inwardEnd >= inwardStart){
      setF('C'+R(inwardTotalRow), 'SUM(C'+R(inwardStart)+':C'+R(inwardEnd)+')', result.inwardRows.reduce((a,r)=>a+r.ordered,0));
      setF('D'+R(inwardTotalRow), 'SUM(D'+R(inwardStart)+':D'+R(inwardEnd)+')', result.totalInward);
    }
    if(s2sInEnd >= s2sInStart){
      setF('C'+R(s2sInTotalRow), 'SUM(C'+R(s2sInStart)+':C'+R(s2sInEnd)+')', result.s2sInRows.reduce((a,r)=>a+r.ordered,0));
      setF('D'+R(s2sInTotalRow), 'SUM(D'+R(s2sInStart)+':D'+R(s2sInEnd)+')', result.totalS2sIn);
    }
    if(issuanceEnd >= issuanceStart){
      setF('B'+R(issuanceTotalRow), 'SUM(B'+R(issuanceStart)+':B'+R(issuanceEnd)+')', result.totalIssuance);
    }
    if(s2sOutEnd >= s2sOutStart){
      setF('C'+R(s2sOutTotalRow), 'SUM(C'+R(s2sOutStart)+':C'+R(s2sOutEnd)+')', result.s2sOutRows.reduce((a,r)=>a+r.ordered,0));
      setF('D'+R(s2sOutTotalRow), 'SUM(D'+R(s2sOutStart)+':D'+R(s2sOutEnd)+')', result.totalS2sOut);
    }
    setF('B'+R(combinedInwardRow), 'D'+R(inwardTotalRow)+'+D'+R(s2sInTotalRow), result.combinedInward);
    setF('B'+R(combinedIssuedRow), 'B'+R(issuanceTotalRow)+'+D'+R(s2sOutTotalRow), result.combinedIssued);
    setF('B'+R(remainingRow), 'B'+R(combinedInwardRow)+'-B'+R(combinedIssuedRow), result.remainingCalculated);
    setF('B'+R(gapRow), 'B'+R(i360Row)+'-B'+R(physicalRow), i360 - physical);
    setF('B'+R(varianceRow), 'B'+R(i360Row)+'-B'+R(remainingRow), i360 - result.remainingCalculated);

    ws['!merges'] = merges;
    ws['!cols'] = [{wch:26},{wch:20},{wch:16},{wch:16},{wch:14}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Calculation');
    const safeItem = String(result.item).replace(/[^a-z0-9]+/gi,'_');
    const safeStore = String(result.store).replace(/[^a-z0-9]+/gi,'_');
    XLSX.writeFile(wb, 'calculation_' + safeItem + '_' + safeStore + '.xlsx');
  }catch(err){
    alert('Could not build the calculation workbook: ' + (err && err.message ? err.message : err));
  }
}

function initCalc(){
  loadOptions();
}

window.CalcView = { init: initCalc };
})();
