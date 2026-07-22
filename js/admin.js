(function(){
"use strict";

const $ = (id) => document.getElementById(id);
const cardInward = $('cardInward'), cardIssuance = $('cardIssuance'), cardS2s = $('cardS2s');
const dropzone = $('dropzone'), fileInput = $('fileInput'), browseBtn = $('browseBtn');
const dzTitle = $('dzTitle'), dzSub = $('dzSub');
const fileMeta = $('fileMeta'), progressWrap = $('progressWrap'), progressFill = $('progressFill'), progressLabel = $('progressLabel');
const errBox = $('errBox');
const previewPanel = $('previewPanel');

const state = { mode:'inward', fileName:'', parsed:null, buffer:null };

function setMode(mode){
  state.mode = mode;
  document.getElementById('view-admin').setAttribute('data-mode', mode);
  cardInward.classList.toggle('active', mode==='inward');
  cardIssuance.classList.toggle('active', mode==='issuance');
  cardS2s.classList.toggle('active', mode==='s2s');
  dzTitle.textContent = mode==='inward' ? 'Drop your MRS Inward workbook here'
    : mode==='issuance' ? 'Drop your Issuance workbook here'
    : 'Drop your S2S Transfer workbook here';
  dzSub.textContent = mode==='s2s'
    ? '.xlsx, one sheet per transfer direction · large files (100MB+) are parsed in the background'
    : '.xlsx, one sheet per month · large files (100MB+) are parsed in the background';
}
cardInward.addEventListener('click', ()=> setMode('inward'));
cardIssuance.addEventListener('click', ()=> setMode('issuance'));
cardS2s.addEventListener('click', ()=> setMode('s2s'));
setMode('inward');

browseBtn.addEventListener('click', ()=> fileInput.click());
dropzone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e)=>{
  e.preventDefault(); dropzone.classList.remove('dragover');
  if(e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e)=>{
  if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
});

let openingPulse = null;
function onParseProgress(data){
  if(data.phase === 'opening'){
    progressLabel.textContent = 'Opening workbook — large files (100MB+) can take a minute or two here…';
    let p = 8;
    clearInterval(openingPulse);
    openingPulse = setInterval(()=>{ p = p < 45 ? p+1 : p; progressFill.style.width = p + '%'; }, 700);
    return;
  }
  clearInterval(openingPulse);
  const pct = 48 + Math.round(((data.sheetIndex + (data.phase==='done-sheet'?1:0.5)) / data.sheetTotal) * 50);
  progressFill.style.width = Math.min(pct,99) + '%';
  progressLabel.textContent = data.phase === 'reading'
    ? 'Summarising sheet "' + data.sheet + '"…'
    : 'Summarised "' + data.sheet + '" — ' + data.rows.toLocaleString() + ' rows';
}

async function handleFile(file){
  errBox.classList.add('hidden');
  previewPanel.classList.add('hidden');
  $('successNote').style.display = 'none';
  state.fileName = file.name;
  fileMeta.classList.remove('hidden');
  fileMeta.textContent = file.name + '  ·  ' + fmtBytes(file.size);
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '2%';
  progressLabel.textContent = 'Reading file into memory…';
  browseBtn.disabled = true;

  try{
    const buffer = await new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=> reject(new Error('Could not read the file from disk. Try again, or use a smaller export.'));
      reader.onload = (ev)=> resolve(ev.target.result);
      reader.readAsArrayBuffer(file);
    });
    progressFill.style.width = '5%';
    const result = state.mode === 's2s'
      ? await parseS2S(buffer, onParseProgress)
      : await parseWorkbook(buffer, state.mode, onParseProgress);
    clearInterval(openingPulse);
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Parsed. Review below, then save.';
    browseBtn.disabled = false;
    onParsed(result);
  }catch(err){
    clearInterval(openingPulse);
    errBox.textContent = err.message || String(err);
    errBox.classList.remove('hidden');
    progressWrap.classList.add('hidden');
    browseBtn.disabled = false;
  }
}

function onParsed(data){
  state.parsed = data;
  $('pvRows').textContent = data.records.length.toLocaleString();
  $('pvSourceRows').textContent = data.totalRows.toLocaleString();
  $('pvMonths').textContent = data.months.length.toLocaleString();
  $('pvItems').textContent = new Set(data.records.map(r=>r[2])).size.toLocaleString();
  $('pvStores').textContent = new Set(data.records.map(r=>r[3])).size.toLocaleString();
  $('pvMonthList').textContent = 'Months: ' + data.months.map(m=>m.label).join(', ');
  $('pvSkipped').textContent = (data.sheetsSkipped && data.sheetsSkipped.length)
    ? 'Skipped non-data sheet(s): ' + data.sheetsSkipped.join(', ')
    : '';
  previewPanel.classList.remove('hidden');
}

$('discardBtn').addEventListener('click', ()=>{
  previewPanel.classList.add('hidden');
  fileInput.value = '';
  fileMeta.classList.add('hidden');
  progressWrap.classList.add('hidden');
  state.parsed = null;
});

/* ======================= Row mapping ======================= */
function toRowObjects(data, mode){
  const itemMap = new Map(data.itemMap);
  return data.records.map(rec=>{
    const base = {
      report_type: mode,
      month_order: rec[0],
      month_label: rec[1],
      item_code: rec[2],
      item_description: itemMap.get(rec[2]) || null,
      store: rec[3],
      circle: rec[4] || null,
      moir: rec[7] || null,
      ordered_qty: rec[8],
      non_serial_qty: rec[9],
      is_serialised: !!rec[10],
      mo_status: rec[11] || null,
      serial_no: rec[12] || null
    };
    if(mode === 'inward'){
      return Object.assign(base, { flow:null, qty: rec[5], recover_qty:0, engineer_name:null, material_type:null, txn_type:null });
    }
    if(mode === 'issuance'){
      return Object.assign(base, { flow:null, qty: rec[5], recover_qty: rec[6]||0, engineer_name: rec[13]||null, material_type: rec[14]||null, txn_type: rec[15]||null });
    }
    // s2s
    return Object.assign(base, { flow: rec[6]||null, qty: rec[5], recover_qty:0, engineer_name:null, material_type:null, txn_type:null });
  });
}

function buildSummary(rowObjects){
  const map = new Map();
  rowObjects.forEach(r=>{
    const circle = r.circle || '';
    const flow = r.flow || '';
    const key = [r.report_type, r.month_order, r.item_code, r.store, circle, flow].join('|');
    let g = map.get(key);
    if(!g){
      g = { report_type:r.report_type, month_order:r.month_order, month_label:r.month_label, item_code:r.item_code, item_description:r.item_description, store:r.store, circle, flow, qty:0, recover_qty:0, record_count:0 };
      map.set(key,g);
    }
    g.qty += Number(r.qty)||0;
    g.recover_qty += Number(r.recover_qty)||0;
    g.record_count += 1;
    if(!g.item_description && r.item_description) g.item_description = r.item_description;
  });
  return Array.from(map.values());
}

async function batchInsert(table, rows, batchSize, onProgress){
  for(let i=0;i<rows.length;i+=batchSize){
    const batch = rows.slice(i, i+batchSize);
    const { error } = await db.from(table).insert(batch);
    if(error) throw new Error('Insert into ' + table + ' failed: ' + error.message);
    onProgress(Math.min(i+batchSize, rows.length), rows.length);
  }
}

async function mergeAdditiveSummary(newSummaryRows, mode, monthLabels){
  if(!monthLabels.length) return newSummaryRows;
  const { data: existing, error } = await db.from('movements_summary')
    .select('*')
    .eq('report_type', mode)
    .in('month_label', monthLabels);
  if(error) throw new Error('Could not read existing summary rows: ' + error.message);
  const exMap = new Map();
  (existing||[]).forEach(r=>{
    const key = [r.report_type, r.month_order, r.item_code, r.store, r.circle, r.flow].join('|');
    exMap.set(key, r);
  });
  newSummaryRows.forEach(r=>{
    const key = [r.report_type, r.month_order, r.item_code, r.store, r.circle, r.flow].join('|');
    const ex = exMap.get(key);
    if(ex){
      r.qty += Number(ex.qty)||0;
      r.recover_qty += Number(ex.recover_qty)||0;
      r.record_count += Number(ex.record_count)||0;
    }
  });
  return newSummaryRows;
}

function showSaveProgress(label, pct){
  $('saveProgressWrap').classList.remove('hidden');
  $('saveProgressLabel').textContent = label;
  $('saveProgressFill').style.width = pct + '%';
}

$('saveBtn').addEventListener('click', async ()=>{
  if(!state.parsed) return;
  const mode = state.mode;
  const replaceMode = document.querySelector('input[name="saveMode"]:checked').value === 'replace';
  const uploadedBy = $('uploadedByInput').value.trim() || null;
  $('saveBtn').disabled = true;
  $('discardBtn').disabled = true;

  try{
    const rowObjects = toRowObjects(state.parsed, mode);
    const monthLabels = Array.from(new Set(rowObjects.map(r=>r.month_label)));

    if(replaceMode){
      showSaveProgress('Removing existing data for ' + monthLabels.join(', ') + '…', 3);
      for(const label of monthLabels){
        const { error: e1 } = await db.from('movements_raw').delete().eq('report_type', mode).eq('month_label', label);
        if(e1) throw new Error('Could not clear old raw rows for ' + label + ': ' + e1.message);
        const { error: e2 } = await db.from('movements_summary').delete().eq('report_type', mode).eq('month_label', label);
        if(e2) throw new Error('Could not clear old summary rows for ' + label + ': ' + e2.message);
      }
    }

    showSaveProgress('Saving detail rows… 0 / ' + rowObjects.length, 5);
    await batchInsert('movements_raw', rowObjects, 1000, (done, total)=>{
      const pct = 5 + Math.round((done/total)*80);
      showSaveProgress('Saving detail rows… ' + done.toLocaleString() + ' / ' + total.toLocaleString(), pct);
    });

    showSaveProgress('Updating summary totals…', 88);
    let summaryRows = buildSummary(rowObjects);
    if(!replaceMode){
      summaryRows = await mergeAdditiveSummary(summaryRows, mode, monthLabels);
    }
    const { error: upErr } = await db.from('movements_summary').upsert(summaryRows, {
      onConflict: 'report_type,month_order,item_code,store,circle,flow'
    });
    if(upErr) throw new Error('Could not update summary table: ' + upErr.message);

    showSaveProgress('Logging upload…', 96);
    const { error: logErr } = await db.from('uploads').insert([{
      report_type: mode,
      file_name: state.fileName,
      uploaded_by: uploadedBy,
      replace_mode: replaceMode,
      months: monthLabels,
      total_rows_source: state.parsed.totalRows,
      aggregated_row_count: rowObjects.length,
      sheets_skipped: state.parsed.sheetsSkipped || []
    }]);
    if(logErr) throw new Error('Saved data, but could not write the upload log: ' + logErr.message);

    showSaveProgress('Done.', 100);
    $('successNote').style.display = 'block';
    $('successNote').innerHTML = '<b>Saved.</b> ' + rowObjects.length.toLocaleString() + ' rows written for ' + escapeHtml(monthLabels.join(', ')) + ' (' + mode + ').';
    previewPanel.classList.add('hidden');
    fileInput.value = '';
    fileMeta.classList.add('hidden');
    progressWrap.classList.add('hidden');
    state.parsed = null;
    loadUploadLog();
  }catch(err){
    errBox.textContent = err.message || String(err);
    errBox.classList.remove('hidden');
  }finally{
    $('saveBtn').disabled = false;
    $('discardBtn').disabled = false;
    $('saveProgressWrap').classList.add('hidden');
  }
});

/* ======================= Upload log ======================= */
async function loadUploadLog(){
  const wrap = $('logTableWrap');
  wrap.innerHTML = '<div class="loading-inline">Loading…</div>';
  const { data, error } = await db.from('uploads').select('*').order('created_at', { ascending:false }).limit(20);
  if(error){
    wrap.innerHTML = '<div class="loading-inline">Could not load upload log: ' + escapeHtml(error.message) + '</div>';
    return;
  }
  if(!data || !data.length){
    wrap.innerHTML = '<div class="loading-inline">No uploads yet.</div>';
    return;
  }
  let html = '<table><thead><tr><th>When</th><th>Type</th><th>File</th><th>By</th><th>Months</th><th>Rows</th><th>Mode</th></tr></thead><tbody>';
  data.forEach(u=>{
    const when = new Date(u.created_at).toLocaleString();
    html += '<tr>' +
      '<td>' + escapeHtml(when) + '</td>' +
      '<td>' + escapeHtml(u.report_type) + '</td>' +
      '<td>' + escapeHtml(u.file_name) + '</td>' +
      '<td>' + escapeHtml(u.uploaded_by || '—') + '</td>' +
      '<td>' + escapeHtml((u.months||[]).join(', ')) + '</td>' +
      '<td>' + Number(u.aggregated_row_count||0).toLocaleString() + '</td>' +
      '<td><span class="badge ' + (u.replace_mode ? 'warn' : 'ok') + '">' + (u.replace_mode ? 'replace' : 'append') + '</span></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}
$('refreshLogBtn').addEventListener('click', loadUploadLog);

function initAdmin(){
  loadUploadLog();
}

window.AdminView = { init: initAdmin };
})();
