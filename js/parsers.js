/* =======================================================================
   Flow Console — shared parsing logic.
   Copied verbatim from the original single-file console so uploads keep
   producing the exact same record shape the dashboard already expects.
   Requires XLSX (SheetJS) to be loaded on the page before this file.
   ======================================================================= */

function normHeader(h){ return String(h==null?'':h).trim().toLowerCase().replace(/\s+/g,'_'); }
function normLoose(h){ return String(h==null?'':h).trim().toLowerCase().replace(/[^a-z0-9]/g,''); }
function buildLooseHeaders(rawHeaders){ return rawHeaders.map(normLoose); }
function findLooseAny(looseHeaders, targets){
  for(const t of targets){ const i = looseHeaders.indexOf(t); if(i>-1) return i; }
  return -1;
}
function findLooseContains(looseHeaders, tokens){
  for(let i=0;i<looseHeaders.length;i++){
    if(tokens.every(t=>looseHeaders[i].includes(t))) return i;
  }
  return -1;
}
function findMoIrIdx(looseHeaders){
  let i = findLooseAny(looseHeaders, [
    'moirnumber','moirno','moirnum','irmonumber','irmono',
    'monumber','mono','irnumber','irno','monoirno',
    'moordernumber','ironumber'
  ]);
  if(i>-1) return i;
  return findLooseContains(looseHeaders, ['mo','ir']);
}
function findOrderedQtyIdx(looseHeaders){
  return findLooseAny(looseHeaders, [
    'orderedqty','orderedqnty','orderedquantity','orderqty','orderqnty',
    'orderquantity','moqty','moqnty','moorderqty','irorderqty'
  ]);
}
function findNonSerialIdx(looseHeaders){
  return findLooseAny(looseHeaders, [
    'nonserialisedinwardqnty','nonserialisedinwardqty','nonserializedinwardqnty',
    'nonserializedinwardqty','nonserialqty','nonserialqnty','nonserialisedqty',
    'nonserialisedqnty','nonserializedqty','nonserializedqnty'
  ]);
}
function findSerialColIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['serialno','serialnumber','serialnos','serialnumbers']);
}
function findSerialisedInwardFlagIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['serialisedinward','serializedinward']);
}
function findSerialControlledIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['serialcontrolled','isserialcontrolled','serialcontrol']);
}
function findMoStatusIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['mostatus','irstatus','moirstatus','orderstatus']);
}
function findOrderDateIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['i360orderdate','orderdate','podate']);
}
function findTxnNumberIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['transactionnumber','txnnumber','transactionno','txnno']);
}
function findTxnDateIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['transactiondate','txndate','issuedate','issuancedate','issueddate']);
}
function findEngineerNameIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['engineername','feengineername','fename','fieldengineername']);
}
function findMaterialTypeIdx(looseHeaders){
  return findLooseAny(looseHeaders, ['orderedquality','materialtype','materialcondition','itemcondition','conditiontype']);
}
function parseBoolLike(v){
  if(v === true) return true;
  if(v === false) return false;
  if(typeof v === 'number') return v === 1;
  if(typeof v === 'string'){
    const t = v.trim().toLowerCase();
    if(t === 'true' || t === 'yes' || t === 'y' || t === '1') return true;
    if(t === 'false' || t === 'no' || t === 'n' || t === '0') return false;
  }
  return null;
}
const MONTH_INFO = {
  jan:[0,'Jan'],feb:[1,'Feb'],mar:[2,'Mar'],march:[2,'Mar'],apr:[3,'Apr'],april:[3,'Apr'],
  may:[4,'May'],jun:[5,'Jun'],june:[5,'Jun'],jul:[6,'Jul'],july:[6,'Jul'],aug:[7,'Aug'],
  sep:[8,'Sep'],sept:[8,'Sep'],oct:[9,'Oct'],nov:[10,'Nov'],dec:[11,'Dec']
};
function monthInfo(name){
  const key = String(name).trim().toLowerCase();
  if(MONTH_INFO[key]) return {order:MONTH_INFO[key][0], label:MONTH_INFO[key][1]};
  return {order:99, label:String(name).trim()};
}
function numOrZero(v){
  if(v==null || v==='') return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function yieldToUI(){ return new Promise(r=> setTimeout(r, 0)); }
function classifyS2SFlow(name){
  const s = String(name==null?'':name).trim().toLowerCase();
  const idxSdfx = s.indexOf('sdfx');
  const idxTo = s.indexOf(' to ');
  if(idxSdfx === -1 || idxTo === -1) return 'unknown';
  return idxSdfx > idxTo ? 'inward' : 'outward';
}
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function findCol(headers, includeAll, excludeAny){
  excludeAny = excludeAny || [];
  for(let i=0;i<headers.length;i++){
    const h = headers[i];
    if(includeAll.every(tok=>h.includes(tok)) && !excludeAny.some(tok=>h.includes(tok))) return i;
  }
  return -1;
}
function excelToMonthInfo(val){
  if(val==null || val==='') return null;
  if(typeof val === 'number'){
    const dc = XLSX.SSF ? XLSX.SSF.parse_date_code(val) : null;
    if(!dc || !dc.m) return null;
    return { order: dc.m-1, label: MONTH_SHORT[dc.m-1] };
  }
  const parsed = new Date(val);
  if(isNaN(parsed.getTime())) return null;
  return { order: parsed.getMonth(), label: MONTH_SHORT[parsed.getMonth()] };
}

/* ---------- MRS Inward / Issuance parser (one sheet per month) ---------- */
async function parseWorkbook(buffer, mode, onProgress){
  if(typeof XLSX === 'undefined'){
    throw new Error('Could not load the spreadsheet engine (need internet access to cdnjs.cloudflare.com).');
  }
  onProgress({phase:'opening'});
  await yieldToUI();

  let workbook;
  try{
    workbook = XLSX.read(buffer, {
      type:'array', raw:true, cellDates:false, dense:true,
      cellFormula:false, cellHTML:false, cellStyles:false, cellText:false,
      sheetStubs:false, bookVBA:false
    });
  }catch(err){
    throw new Error('Failed to read the workbook — is it a valid .xlsx file? (' + err.message + ')');
  }

  const sheetNames = workbook.SheetNames;
  const agg = new Map();
  const itemMap = new Map();
  const storeSet = new Set();
  const circleSet = new Set();
  const monthSeen = new Map();
  let totalRows = 0;
  let sheetsSkipped = [];

  for(let s=0; s<sheetNames.length; s++){
    const sheetName = sheetNames[s];
    onProgress({phase:'reading', sheet:sheetName, sheetIndex:s, sheetTotal:sheetNames.length});
    await yieldToUI();

    const ws = workbook.Sheets[sheetName];
    if(!ws || !ws['!ref']){ continue; }

    let aoa;
    try{
      aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:false});
    }catch(err){
      sheetsSkipped.push(sheetName); delete workbook.Sheets[sheetName]; continue;
    }
    if(!aoa || aoa.length < 2){ delete workbook.Sheets[sheetName]; continue; }

    const headers = aoa[0].map(normHeader);
    const col = (name) => headers.indexOf(name);
    const itemIdx = col('item_code');
    const ssIdx = col('ss');
    if(itemIdx === -1 || ssIdx === -1){
      sheetsSkipped.push(sheetName);
      delete workbook.Sheets[sheetName];
      continue;
    }
    const descIdx = col('item_description');
    const circleIdx = col('circle');
    let qtyIdx = -1, serialIdx = -1, txnIdx = -1;
    if(mode === 'inward'){
      qtyIdx = col('nonserialised_inward_qnty');
      serialIdx = col('serial_no');
    } else {
      qtyIdx = col('issued_qty');
      txnIdx = col('txn_type');
    }

    const looseHeaders = buildLooseHeaders(aoa[0]);
    const moirIdx = findMoIrIdx(looseHeaders);
    const orderedIdx = findOrderedQtyIdx(looseHeaders);
    const nonSerExtraIdx = mode === 'inward' ? qtyIdx : findNonSerialIdx(looseHeaders);
    const serialExtraIdx = mode === 'inward' ? serialIdx : findSerialColIdx(looseHeaders);
    const serialisedInwardFlagIdx = findSerialisedInwardFlagIdx(looseHeaders);
    const moStatusIdx = findMoStatusIdx(looseHeaders);
    const txnNumberIdx = findTxnNumberIdx(looseHeaders);
    const engineerNameIdx = findEngineerNameIdx(looseHeaders);
    const materialTypeIdx = findMaterialTypeIdx(looseHeaders);
    // Month comes from a per-row date column when the sheet has one — I360
    // Order Date for inward, Transaction/Issue Date for issuance. Falls back
    // to the sheet name (e.g. a tab literally called "Jan") only when no
    // usable date column is found, so sheets named "Sheet1" etc. still work.
    const rowDateIdx = mode === 'inward' ? findOrderDateIdx(looseHeaders) : findTxnDateIdx(looseHeaders);
    const sheetFallbackMi = monthInfo(sheetName);

    const rowCount = aoa.length - 1;
    for(let r = 1; r < aoa.length; r++){
      const row = aoa[r];
      if(!row) continue;
      const item = row[itemIdx];
      let store = row[ssIdx];
      if(item == null || item === '') continue;
      if(store == null || store === ''){ store = '(No Store / Pending)'; }
      totalRows++;

      const mi = (rowDateIdx > -1 ? excelToMonthInfo(row[rowDateIdx]) : null) || sheetFallbackMi;
      monthSeen.set(mi.order + '|' + mi.label, true);

      const desc = descIdx > -1 ? row[descIdx] : null;
      if(desc && !itemMap.has(item)) itemMap.set(item, String(desc));
      storeSet.add(store);
      const circle = circleIdx > -1 ? row[circleIdx] : null;
      if(circle) circleSet.add(circle);

      const moir = mode === 'issuance'
        ? (txnNumberIdx > -1 ? row[txnNumberIdx] : (moirIdx > -1 ? row[moirIdx] : null))
        : (moirIdx > -1 ? row[moirIdx] : null);
      const orderedQn = orderedIdx > -1 ? numOrZero(row[orderedIdx]) : 0;
      const nonSerQn = nonSerExtraIdx > -1 ? numOrZero(row[nonSerExtraIdx]) : 0;
      const moStatus = moStatusIdx > -1 ? row[moStatusIdx] : null;
      const serialNoVal = serialExtraIdx > -1 ? row[serialExtraIdx] : null;
      const serialNo = serialNoVal != null ? String(serialNoVal) : '';
      const explicitFlag = serialisedInwardFlagIdx > -1 ? parseBoolLike(row[serialisedInwardFlagIdx]) : null;
      const hasSerial = explicitFlag !== null
        ? explicitFlag
        : (serialExtraIdx > -1 && row[serialExtraIdx] != null && row[serialExtraIdx] !== '');

      if(mode === 'inward'){
        let qty = qtyIdx > -1 ? row[qtyIdx] : null;
        let qn = numOrZero(qty);
        if(qn === 0 && hasSerial){ qn = 1; }
        const key = mi.order + '|' + mi.label + '|' + item + '|' + store + '|' + (circle||'') + '|' + (moir!=null?String(moir):'') + '|' + serialNo;
        const cur = agg.get(key) || {qty:0, ordered:0, nonSer:0, serial:false, moir:(moir!=null?String(moir):''), moStatus:null, serialNo};
        cur.qty += qn;
        cur.ordered += orderedQn;
        cur.nonSer += nonSerQn;
        if(hasSerial) cur.serial = true;
        if(moStatus && !cur.moStatus) cur.moStatus = String(moStatus);
        agg.set(key, cur);
      } else {
        const qn = numOrZero(qtyIdx > -1 ? row[qtyIdx] : null);
        const txnRaw = txnIdx > -1 ? String(row[txnIdx]||'').trim().toLowerCase() : 'allocate';
        const engineerName = engineerNameIdx > -1 ? row[engineerNameIdx] : null;
        const materialType = materialTypeIdx > -1 ? row[materialTypeIdx] : null;
        const key = mi.order + '|' + mi.label + '|' + item + '|' + store + '|' + (circle||'') + '|' + (moir!=null?String(moir):'') + '|' + serialNo;
        const cur = agg.get(key) || {allocate:0, recover:0, ordered:0, nonSer:0, serial:false, moir:(moir!=null?String(moir):''), moStatus:null, serialNo, engineerName:null, materialType:null, hasAllocate:false, hasRecover:false};
        if(txnRaw === 'recover'){ cur.recover += qn; cur.hasRecover = true; } else { cur.allocate += qn; cur.hasAllocate = true; }
        cur.ordered += orderedQn;
        cur.nonSer += nonSerQn;
        if(hasSerial) cur.serial = true;
        if(moStatus && !cur.moStatus) cur.moStatus = String(moStatus);
        if(engineerName && !cur.engineerName) cur.engineerName = String(engineerName);
        if(materialType && !cur.materialType) cur.materialType = String(materialType);
        agg.set(key, cur);
      }
    }

    onProgress({phase:'done-sheet', sheet:sheetName, sheetIndex:s, sheetTotal:sheetNames.length, rows: rowCount});
    delete workbook.Sheets[sheetName];
    await yieldToUI();
  }

  const records = [];
  for(const [key, val] of agg.entries()){
    const parts = key.split('|');
    const order = parseInt(parts[0],10);
    const label = parts[1];
    const item = parts[2];
    const store = parts[3];
    const circle = parts[4];
    const moir = val.moir || '';
    const moStatus = val.moStatus || '';
    const serialNo = val.serialNo || '';
    if(mode === 'inward'){
      records.push([order, label, item, store, circle, val.qty, null, moir, val.ordered, val.nonSer, val.serial, moStatus, serialNo]);
    } else {
      const txnType = (val.hasAllocate && val.hasRecover) ? 'Mixed' : (val.hasRecover ? 'Recover' : 'Allocate');
      records.push([order, label, item, store, circle, val.allocate, val.recover, moir, val.ordered, val.nonSer, val.serial, moStatus, serialNo, val.engineerName||'', val.materialType||'', txnType]);
    }
  }

  const months = Array.from(monthSeen.keys()).map(k=>{
    const [order,label] = k.split('|');
    return {order:parseInt(order,10), label};
  }).sort((a,b)=>a.order-b.order);

  return {
    mode, months, records,
    itemMap: Array.from(itemMap.entries()),
    stores: Array.from(storeSet.values()),
    circles: Array.from(circleSet.values()),
    totalRows, sheetsSkipped
  };
}

/* ---------- S2S Transfer parser (one sheet per direction, date-driven month) ---------- */
async function parseS2S(buffer, onProgress){
  if(typeof XLSX === 'undefined'){
    throw new Error('Could not load the spreadsheet engine (need internet access to cdnjs.cloudflare.com).');
  }
  onProgress({phase:'opening'});
  await yieldToUI();

  let workbook;
  try{
    workbook = XLSX.read(buffer, {
      type:'array', raw:true, cellDates:false, dense:true,
      cellFormula:false, cellHTML:false, cellStyles:false, cellText:false,
      sheetStubs:false, bookVBA:false
    });
  }catch(err){
    throw new Error('Failed to read the workbook — is it a valid .xlsx file? (' + err.message + ')');
  }

  const sheetNames = workbook.SheetNames;
  const agg = new Map();
  const itemMap = new Map();
  const storeSet = new Set();
  const circleSet = new Set();
  const monthSeen = new Map();
  const flows = [];
  let totalRows = 0;
  let sheetsSkipped = [];
  let diagnostics = [];

  for(let s=0; s<sheetNames.length; s++){
    const sheetName = sheetNames[s];
    onProgress({phase:'reading', sheet:sheetName, sheetIndex:s, sheetTotal:sheetNames.length});
    await yieldToUI();

    const ws = workbook.Sheets[sheetName];
    if(!ws || !ws['!ref']){ continue; }

    let aoa;
    try{
      aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:false});
    }catch(err){
      sheetsSkipped.push(sheetName); delete workbook.Sheets[sheetName]; continue;
    }
    if(!aoa || aoa.length < 2){ delete workbook.Sheets[sheetName]; continue; }

    const rawHeaders = aoa[0];
    const headers = rawHeaders.map(normHeader);
    const col = (name) => headers.indexOf(name);

    let itemIdx = col('item_code'); if(itemIdx===-1) itemIdx = findCol(headers,['item','code']);
    let ssIdx = col('ss');
    if(ssIdx===-1) ssIdx = findCol(headers,['store'],['other']);
    if(ssIdx===-1) ssIdx = findCol(headers,['substore']);
    let descIdx = col('item_description'); if(descIdx===-1) descIdx = findCol(headers,['description']);
    let circleIdx = col('circle'); if(circleIdx===-1) circleIdx = findCol(headers,['circle']);
    let qtyIdx = -1;
    ['transfer_qty','transferred_qty','transfer_qnty','received_qty','inward_qty','issued_qty','qty','qnty','quantity'].some(name=>{
      const i = col(name); if(i>-1){ qtyIdx = i; return true; } return false;
    });
    if(qtyIdx===-1) qtyIdx = findCol(headers,['qty']);
    if(qtyIdx===-1) qtyIdx = findCol(headers,['qnty']);
    if(qtyIdx===-1) qtyIdx = findCol(headers,['quantity']);
    let dateIdx = -1;
    ['transfer_date','txn_date','inward_date','date'].some(name=>{
      const i = col(name); if(i>-1){ dateIdx = i; return true; } return false;
    });
    if(dateIdx===-1) dateIdx = findCol(headers,['date']);

    const looseHeaders = buildLooseHeaders(rawHeaders);
    const moirIdx = findMoIrIdx(looseHeaders);
    const orderedIdx = findOrderedQtyIdx(looseHeaders);
    const nonSerIdx = findNonSerialIdx(looseHeaders);
    const serialColIdx = findSerialColIdx(looseHeaders);
    const serialisedInwardFlagIdx = findSerialisedInwardFlagIdx(looseHeaders);
    const serialControlledIdx = findSerialControlledIdx(looseHeaders);
    const moStatusIdx = findMoStatusIdx(looseHeaders);
    const orderDateIdx = findOrderDateIdx(looseHeaders);

    const hasQtySignal = qtyIdx > -1 || nonSerIdx > -1 || serialisedInwardFlagIdx > -1;
    const hasDateSignal = dateIdx > -1 || orderDateIdx > -1;

    if(itemIdx===-1 || ssIdx===-1 || !hasQtySignal || !hasDateSignal){
      sheetsSkipped.push(sheetName);
      diagnostics.push({ sheet:sheetName, headers: rawHeaders.map(h=>String(h==null?'':h).trim()).filter(Boolean) });
      delete workbook.Sheets[sheetName];
      continue;
    }

    flows.push(sheetName);
    const rowCount = aoa.length - 1;
    for(let r = 1; r < aoa.length; r++){
      const row = aoa[r];
      if(!row) continue;
      const item = row[itemIdx];
      let store = row[ssIdx];
      if(item == null || item === '') continue;
      if(store == null || store === ''){ store = '(No Store / Pending)'; }
      const mi = (dateIdx > -1 ? excelToMonthInfo(row[dateIdx]) : null)
        || (orderDateIdx > -1 ? excelToMonthInfo(row[orderDateIdx]) : null);
      if(!mi) continue;
      totalRows++;

      const desc = descIdx > -1 ? row[descIdx] : null;
      if(desc && !itemMap.has(item)) itemMap.set(item, String(desc));
      storeSet.add(store);
      const circle = circleIdx > -1 ? row[circleIdx] : null;
      if(circle) circleSet.add(circle);
      monthSeen.set(mi.order + '|' + mi.label, true);

      const moir = moirIdx > -1 ? row[moirIdx] : null;
      const orderedQn = orderedIdx > -1 ? numOrZero(row[orderedIdx]) : 0;
      const nonSerQn = nonSerIdx > -1 ? numOrZero(row[nonSerIdx]) : 0;
      const moStatus = moStatusIdx > -1 ? row[moStatusIdx] : null;

      const explicitFlag = serialisedInwardFlagIdx > -1 ? parseBoolLike(row[serialisedInwardFlagIdx]) : null;
      const hasSerial = explicitFlag !== null
        ? explicitFlag
        : (serialColIdx > -1 && row[serialColIdx] != null && row[serialColIdx] !== '');

      const isSerialItem = (serialControlledIdx > -1 && parseBoolLike(row[serialControlledIdx]) === true)
        || (serialColIdx > -1 && row[serialColIdx] != null && row[serialColIdx] !== '');
      let qn;
      if(isSerialItem){
        qn = hasSerial ? 1 : 0;
      } else if(nonSerIdx > -1){
        qn = nonSerQn;
      } else {
        qn = qtyIdx > -1 ? numOrZero(row[qtyIdx]) : 0;
      }
      const serialNoVal = serialColIdx > -1 ? row[serialColIdx] : null;
      const serialNo = serialNoVal != null ? String(serialNoVal) : '';

      const key = mi.order + '|' + mi.label + '|' + item + '|' + store + '|' + (circle||'') + '|' + sheetName + '|' + (moir!=null?String(moir):'') + '|' + serialNo;
      const cur = agg.get(key) || {qty:0, ordered:0, nonSer:0, serial:false, moir:(moir!=null?String(moir):''), moStatus:null, serialNo};
      cur.qty += qn;
      cur.ordered += orderedQn;
      cur.nonSer += nonSerQn;
      if(hasSerial) cur.serial = true;
      if(moStatus && !cur.moStatus) cur.moStatus = String(moStatus);
      agg.set(key, cur);
    }

    onProgress({phase:'done-sheet', sheet:sheetName, sheetIndex:s, sheetTotal:sheetNames.length, rows: rowCount});
    delete workbook.Sheets[sheetName];
    await yieldToUI();
  }

  if(agg.size === 0){
    let msg = 'Could not find item code / store / quantity / date columns in this S2S workbook.';
    if(diagnostics.length){
      msg += ' Headers found in "' + diagnostics[0].sheet + '": ' + diagnostics[0].headers.join(', ') + '.';
    }
    throw new Error(msg);
  }

  const records = [];
  for(const [key, val] of agg.entries()){
    const parts = key.split('|');
    records.push([parseInt(parts[0],10), parts[1], parts[2], parts[3], parts[4], val.qty, parts[5], val.moir||'', val.ordered, val.nonSer, val.serial, val.moStatus||'', val.serialNo||'']);
  }

  const months = Array.from(monthSeen.keys()).map(k=>{
    const [order,label] = k.split('|');
    return {order:parseInt(order,10), label};
  }).sort((a,b)=>a.order-b.order);

  return {
    mode:'s2s', months, records,
    itemMap: Array.from(itemMap.entries()),
    stores: Array.from(storeSet.values()),
    circles: Array.from(circleSet.values()),
    flows,
    totalRows, sheetsSkipped
  };
}
