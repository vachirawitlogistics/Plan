const INV_API_URL = 'https://script.google.com/macros/s/AKfycbxeIxE_bitLEr193oQxgMy6FjMQJGZV2B8gznP3jl1SN7ubVvifRXJMQKDBIUfbwVSn/exec';

let rawBillingData = [], auditData = [], readyData = [], bkgTotalsGlobal = {};
let filteredAudit = [], filteredReady = [], groupedReadyGlobal = {};
let rawHistoryData = [], filteredHistoryData = [];
let histSortCol = 'invoiceNo', histSortAsc = false;
let tempPayloadForPDF = [], currentReceiptInvNo = "", currentDocType = "";

async function callInvAPI(action, params = {}, retries = 3, showLoader = true) {
    if (showLoader && typeof showGlobalLoader === 'function') showGlobalLoader('กำลังเชื่อมต่อเซิร์ฟเวอร์เอกสาร...');
    for (let i = 0; i <= retries; i++) {
        try {
            if (i > 0) await new Promise(res => setTimeout(res, 1000 * i + Math.random() * 1000));
            const response = await fetch(INV_API_URL, {
                method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: action, params: params })
            });
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            const text = await response.text();
            let result;
            try { result = JSON.parse(text); } catch (e) { throw new Error("Server Error"); }
            if (result && result.success === false && result.message) throw new Error(result.message);
            if (showLoader && typeof hideGlobalLoader === 'function') hideGlobalLoader();
            return result;
        } catch (error) {
            if (i === retries) {
                if (showLoader && typeof hideGlobalLoader === 'function') hideGlobalLoader();
                return { success: false, message: error.message };
            }
        }
    }
}

document.addEventListener('focusin', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (e.target.value === '0') e.target.value = ''; else e.target.select();
    }
});

document.addEventListener('focusout', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number' && e.target.value === '') {
        e.target.value = '0'; e.target.dispatchEvent(new Event('input'));
    }
});

document.querySelectorAll('#pills-tab button').forEach(btn => {
    btn.addEventListener('click', function(event) {
        document.querySelectorAll('#pills-tab button').forEach(b => b.classList.remove('active-audit', 'active-invoice', 'active-history'));
        if (event.target.id === 'tab-audit') event.target.classList.add('active-audit');
        if (event.target.id === 'tab-invoice') event.target.classList.add('active-invoice');
        if (event.target.id === 'tab-history') event.target.classList.add('active-history');
        document.querySelectorAll('#module-invoice .tab-pane').forEach(pane => { pane.classList.remove('show', 'active'); pane.style.display = 'none'; });
        const targetPane = document.querySelector(event.target.getAttribute('data-bs-target'));
        if (targetPane) { targetPane.classList.add('show', 'active'); targetPane.style.display = 'flex'; }
    });
});

async function loadBillingData(isLogin = false, forceSync = false) {
    if (!forceSync && rawBillingData.length > 0) { applyFilterAudit(); applyFilterReady(); return; }
    if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังโหลดข้อมูลวางบิลจาก Supabase...');
    try {
        let fetchedBilling = [];
        let from = 0;
        const step = 1000;
        
        while (true) {
            const { data: chunk, error } = await supabaseClient.from('plan_data')
                .select('*')
                .in('status', ['จบงานรอวางบิล', 'พร้อมวางบิล'])
                .order('booking_date', { ascending: false })
                .order('id', { ascending: true })
                .range(from, from + step - 1);
            if (error) throw error;
            fetchedBilling = fetchedBilling.concat(chunk);
            if (chunk.length < step) break;
            from += step;
        }

        let allBkgDataList = [];
        let bkgFrom = 0;
        while (true) {
            const { data: bkgChunk, error: bkgErr } = await supabaseClient.from('plan_data')
                .select('booking')
                .range(bkgFrom, bkgFrom + step - 1);
            if (bkgErr) throw bkgErr;
            allBkgDataList = allBkgDataList.concat(bkgChunk);
            if (bkgChunk.length < step) break;
            bkgFrom += step;
        }

        bkgTotalsGlobal = {};
        if (allBkgDataList) {
            allBkgDataList.forEach(r => { if (r.booking) bkgTotalsGlobal[r.booking] = (bkgTotalsGlobal[r.booking] || 0) + 1; });
        }

        rawBillingData = [[]]; auditData = []; readyData = [];
        
        fetchedBilling.forEach(row => {
            let r = [
                row.booking_date, row.cs, row.container_type, row.mode, row.customer, row.load_place, row.booking,
                row.cy_place, row.cy_date, row.vgm, row.rtn_place, row.rtn_date, row.closing_time,
                row.agent, row.comment, row.status, row.vehicle_plate, row.price,
                row.receive, row.retrun, row.extender, row.tail_drop, row.lose_time, row.container_no,
                row.terminal_charge, row.repair, row.cleaning, row.shore, row.other_exp_name_1, row.other_exp_amt_1,
                row.other_exp_name_2, row.other_exp_amt_2, row.invoice_no, row.history_edit, row.bill_to_name, row['ชื่อออกใบเสร็จ'], row.id 
            ];
            rawBillingData.push(r);
            
            let price = parseFloat(r[17]) || 0;
            let ext1 = parseFloat(r[20]) || 0, ext2 = parseFloat(r[21]) || 0, ext3 = parseFloat(r[22]) || 0;
            let adv1 = parseFloat(r[18]) || 0, adv2 = parseFloat(r[19]) || 0;
            let adv3 = parseFloat(r[24]) || 0, adv4 = parseFloat(r[25]) || 0, adv5 = parseFloat(r[26]) || 0, adv6 = parseFloat(r[27]) || 0;
            let ext_v1 = parseFloat(r[29]) || 0, ext_v2 = parseFloat(r[31]) || 0;
            let incTot = price + ext1 + ext2 + ext3;
            let advTot = adv1 + adv2 + adv3 + adv4 + adv5 + adv6 + ext_v1 + ext_v2;
            let rowObj = { rowData: r, rowIdx: r[36], incTot: incTot, advTot: advTot, grandTot: incTot + advTot };

            if (row.status === 'จบงานรอวางบิล') auditData.push(rowObj);
            else if (row.status === 'พร้อมวางบิล') readyData.push(rowObj);
        });

        updateInvDropdowns(rawBillingData); applyFilterAudit(); applyFilterReady();
        const { data: compList } = await supabaseClient.from('customer').select('full_name, short_name');
        if (compList) {
            let cHtml = ''; let names = [...new Set(compList.flatMap(c => [c.full_name, c.short_name]).filter(String))];
            names.forEach(c => cHtml += `<option value="${c}">`);
            if (document.getElementById('modalCompanyList')) document.getElementById('modalCompanyList').innerHTML = cHtml;
        }
        if (isLogin) {
            let defaultTab = document.getElementById('tab-audit'); if (defaultTab) defaultTab.click();
        } else if (document.getElementById('tab-history') && document.getElementById('tab-history').classList.contains('active-history')) {
            loadHistory();
        }
    } catch (err) { Swal.fire('ซิงค์ข้อมูลไม่สำเร็จ', err.message, 'error'); } 
    finally { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); }
}

function forceSyncBillingData() {
    rawBillingData = []; rawHistoryData = []; loadBillingData(false, true);
    if (document.getElementById('tab-history').classList.contains('active-history')) loadHistory(true);
}

function updateInvDropdowns(sourceData) {
    let allCust = [...new Set(sourceData.slice(1).map(r => r[4]).filter(v => v))];
    let ddlCust = '<option value="">- ลูกค้าทั้งหมด -</option>'; allCust.forEach(c => ddlCust += `<option value="${c}">${c}</option>`);
    if (document.getElementById('filterCustomerA')) document.getElementById('filterCustomerA').innerHTML = ddlCust;
    if (document.getElementById('filterCustomerR')) document.getElementById('filterCustomerR').innerHTML = ddlCust;

    let allCS = [...new Set(sourceData.slice(1).map(r => r[1]).filter(v => v))];
    let ddlCS = '<option value="">- CS ทั้งหมด -</option>'; allCS.forEach(c => ddlCS += `<option value="${c}">${c}</option>`);
    if (document.getElementById('filterCSA')) document.getElementById('filterCSA').innerHTML = ddlCS;
}

function applyFilterAudit() {
    let fSearch = document.getElementById('filterSearchA') ? document.getElementById('filterSearchA').value.toLowerCase() : '';
    let fCS = document.getElementById('filterCSA') ? document.getElementById('filterCSA').value.toLowerCase() : '';
    let fCust = document.getElementById('filterCustomerA') ? document.getElementById('filterCustomerA').value.toLowerCase() : '';
    filteredAudit = auditData.filter(obj => {
        let r = obj.rowData;
        let matchCust = fCust === '' || (r[4] && r[4].toString().toLowerCase().includes(fCust));
        let matchCS = fCS === '' || (r[1] && r[1].toString().toLowerCase().includes(fCS));
        let matchSearch = fSearch === '' || (r[6] || '').toString().toLowerCase().includes(fSearch) || (r[23] || '').toString().toLowerCase().includes(fSearch) || (r[16] || '').toString().toLowerCase().includes(fSearch);
        return matchCust && matchCS && matchSearch;
    });
    renderAuditTab();
}

function clearFilterAudit() {
    if (document.getElementById('filterCustomerA')) document.getElementById('filterCustomerA').value = '';
    if (document.getElementById('filterCSA')) document.getElementById('filterCSA').value = '';
    if (document.getElementById('filterSearchA')) document.getElementById('filterSearchA').value = '';
    applyFilterAudit();
}

function renderAuditTab() {
    let html = '';
    if (filteredAudit.length === 0) {
        document.getElementById('auditBody').innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="bi bi-box-seam fs-1 d-block mb-2 opacity-25"></i>ไม่พบรายการข้อมูล</td></tr>';
        document.getElementById('selCountA').innerText = 0; return;
    }

    let grouped = {};
    filteredAudit.forEach(obj => {
        let r = obj.rowData; let bkg = r[6];
        if (!grouped[bkg]) grouped[bkg] = { cs: r[1], customer: r[4], date: r[0], items: [], sumTot: 0 };
        grouped[bkg].items.push(obj); grouped[bkg].sumTot += obj.grandTot;
    });

    let bkgKeys = Object.keys(grouped);
    let limitVal = document.getElementById('limitA') ? document.getElementById('limitA').value : 'ALL';
    if (limitVal !== 'ALL') bkgKeys = bkgKeys.slice(0, parseInt(limitVal));

    let stripeIdx = 0;
    for (let bkg of bkgKeys) {
        let group = grouped[bkg];
        let dateStr = ""; try { dateStr = new Date(group.date).toLocaleDateString('en-GB'); } catch (e) { dateStr = group.date; }
        let totalInSystem = bkgTotalsGlobal[bkg] || group.items.length;
        let badgeClass = group.items.length < totalInSystem ? 'bg-warning bg-opacity-25 text-warning border border-warning' : 'bg-secondary bg-opacity-10 text-secondary';
        let safeBkg = 'bkg_' + bkg.replace(/[^a-zA-Z0-9]/g, '_');
        let rowStripeClass = (stripeIdx % 2 !== 0) ? 'stripe-odd' : 'stripe-even';
        stripeIdx++;

        html += `<tr class="parent-row ${rowStripeClass}" onclick="toggleDetailA('${safeBkg}')">
            <td class="text-center align-middle" onclick="event.stopPropagation();"><input type="checkbox" class="bkg-check-a form-check-input shadow-sm" data-bkg="${bkg}" data-safebkg="${safeBkg}" style="width:1.2em; height:1.2em;" onclick="toggleBookingA(this, '${safeBkg}')"></td>
            <td><i class="bi bi-chevron-right ms-1 me-2 text-primary fw-bold" id="icon-a-${safeBkg}" style="font-size:0.8rem; transition:0.3s;"></i> ${dateStr}</td>
            <td class="text-secondary fw-medium">${group.cs || '-'}</td><td class="fw-bold text-dark">${group.customer || '-'}</td><td class="fw-bold text-primary">${bkg}</td>
            <td class="text-center"><span class="badge ${badgeClass} rounded-pill px-3">${group.items.length} / ${totalInSystem}</span></td>
            <td class="text-end fw-bold text-dark pe-4" id="pa-tot-${safeBkg}">฿${group.sumTot.toLocaleString(undefined, {minimumFractionDigits:2})}</td></tr>`;

        group.items.forEach((obj) => {
            let r = obj.rowData; let total = obj.grandTot;
            html += `<tr class="detail-row detail-a-${safeBkg} item-container-a" style="display: none;">
                <td class="text-center align-top pt-3"><input type="checkbox" class="row-check-a check-a-${safeBkg} form-check-input shadow-sm mt-2" value="${obj.rowIdx}" data-tot="${total}" style="width:1.1em; height:1.1em;" onclick="calcSummaryA()"></td>
                <td colspan="6">
                    <div class="detail-card border-0 shadow-sm rounded-3 mb-2" style="background:#f8fafc; padding: 10px;">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                           <div><span class="badge bg-white text-secondary border px-2 py-1 shadow-sm me-2">${r[2] || '-'}</span><span class="badge bg-white text-dark border px-2 py-1 shadow-sm me-2"><i class="bi bi-truck me-1 text-primary"></i> ${r[16]||'-'}</span><span class="text-secondary fw-bold small ms-2">ตู้คอนเทนเนอร์: <span class="text-primary fs-6">${r[23]||''}</span></span></div>
                           <div class="fw-bold text-primary bg-white border px-3 py-1 shadow-sm rounded-pill small">รวมรายการนี้: <span class="row-tot-a ms-1">฿${total.toLocaleString(undefined, {minimumFractionDigits:2})}</span></div>
                        </div>
                        <div class="row g-2">
                           <div class="col-md-5"><div class="bg-white border rounded-3 p-2 shadow-sm h-100"><div class="d-flex justify-content-between mb-2"><span class="text-success fw-bold small"><i class="bi bi-arrow-up-right-circle me-1"></i>รายได้</span><span class="text-success fw-bold small row-inc-a">฿${obj.incTot.toLocaleString(undefined, {minimumFractionDigits:2})}</span></div>
                              <div class="row g-1"><div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ราคาเที่ยว</label><input type="number" class="form-control form-control-sm text-end inp-inc-a in-p" data-name="ราคาเที่ยว" data-orig="${parseFloat(r[17])||0}" value="${parseFloat(r[17])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ต่อระยะ</label><input type="number" class="form-control form-control-sm text-end inp-inc-a in-ext1" data-name="ต่อระยะ" data-orig="${parseFloat(r[20])||0}" value="${parseFloat(r[20])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ค้างหาง</label><input type="number" class="form-control form-control-sm text-end inp-inc-a in-ext2" data-name="ค้างหาง" data-orig="${parseFloat(r[21])||0}" value="${parseFloat(r[21])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">เสียเวลา</label><input type="number" class="form-control form-control-sm text-end inp-inc-a in-ext3" data-name="เสียเวลา" data-orig="${parseFloat(r[22])||0}" value="${parseFloat(r[22])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div></div></div></div>
                           <div class="col-md-7"><div class="bg-white border rounded-3 p-2 shadow-sm h-100"><div class="d-flex justify-content-between mb-2"><span class="text-danger fw-bold small"><i class="bi bi-arrow-down-right-circle me-1"></i>สำรองจ่าย</span><span class="text-danger fw-bold small row-adv-a">฿${obj.advTot.toLocaleString(undefined, {minimumFractionDigits:2})}</span></div>
                              <div class="row g-1"><div class="col-4 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">รับตู้</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-adv1" data-name="รับตู้" data-orig="${parseFloat(r[18])||0}" value="${parseFloat(r[18])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-4 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">คืนตู้</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-adv2" data-name="คืนตู้" data-orig="${parseFloat(r[19])||0}" value="${parseFloat(r[19])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-4 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ผ่านท่า</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-adv3" data-name="ผ่านท่า" data-orig="${parseFloat(r[24])||0}" value="${parseFloat(r[24])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-4 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ซ่อมตู้</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-adv4" data-name="ซ่อมตู้" data-orig="${parseFloat(r[25])||0}" value="${parseFloat(r[25])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-4 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ล้างตู้</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-adv5" data-name="ล้างตู้" data-orig="${parseFloat(r[26])||0}" value="${parseFloat(r[26])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-4 col-sm-3"><label class="small text-primary mb-0 fw-bold" style="font-size: 0.7rem;">ค่าชอ</label><input type="number" class="form-control form-control-sm text-end border-primary bg-primary bg-opacity-10 inp-adv-a in-adv6" data-name="ค่าชอ" data-orig="${parseFloat(r[27])||0}" value="${parseFloat(r[27])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-6 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ยอดอื่น 1</label><input type="text" class="form-control form-control-sm in-extn1" data-name="ชื่อยอดอื่น 1" data-orig="${r[28]||''}" value="${r[28]||''}" oninput="updateCalcA(this, '${safeBkg}')"></div>
                              <div class="col-6 col-sm-3"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ยอดเงิน 1</label><input type="number" class="form-control form-control-sm text-end inp-adv-a in-extv1" data-name="ยอดเงิน 1" data-orig="${parseFloat(r[29])||0}" value="${parseFloat(r[29])||0}" oninput="updateCalcA(this, '${safeBkg}')"></div></div></div></div>
                        </div>
                    </div>
                </td></tr>`;
        });
    }
    document.getElementById('auditBody').innerHTML = html; document.getElementById('checkAllA').checked = false; calcSummaryA();
}

function updateCalcA(inputElem, safeBkg) {
    let origVal = inputElem.getAttribute('data-orig') || ''; let currentVal = inputElem.value || '';
    if (inputElem.type === 'number') { origVal = parseFloat(origVal) || 0; currentVal = parseFloat(currentVal) || 0; } 
    else { origVal = origVal.toString().trim(); currentVal = currentVal.toString().trim(); }
    if (origVal !== currentVal) inputElem.classList.add('bg-warning', 'bg-opacity-10', 'border-warning'); else inputElem.classList.remove('bg-warning', 'bg-opacity-10', 'border-warning');

    let container = inputElem.closest('.item-container-a');
    let sumInc = 0; container.querySelectorAll('.inp-inc-a').forEach(inp => sumInc += (parseFloat(inp.value) || 0));
    let sumAdv = 0; container.querySelectorAll('.inp-adv-a').forEach(inp => sumAdv += (parseFloat(inp.value) || 0));
    let sumTot = sumInc + sumAdv;
    container.querySelector('.row-inc-a').innerText = '฿' + sumInc.toLocaleString(undefined, { minimumFractionDigits: 2 });
    container.querySelector('.row-adv-a').innerText = '฿' + sumAdv.toLocaleString(undefined, { minimumFractionDigits: 2 });
    container.querySelector('.row-tot-a').innerText = '฿' + sumTot.toLocaleString(undefined, { minimumFractionDigits: 2 });
    container.querySelector('.row-check-a').setAttribute('data-tot', sumTot);

    let tTot = 0; document.querySelectorAll(`.check-a-${safeBkg}`).forEach(cb => tTot += parseFloat(cb.getAttribute('data-tot')));
    if (document.getElementById(`pa-tot-${safeBkg}`)) document.getElementById(`pa-tot-${safeBkg}`).innerText = '฿' + tTot.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function toggleDetailA(safeBkg) {
    let rows = document.querySelectorAll(`.detail-a-${safeBkg}`); let icon = document.getElementById(`icon-a-${safeBkg}`);
    if (rows.length === 0) return; let isHidden = rows[0].style.display === 'none';
    rows.forEach(r => r.style.display = isHidden ? 'table-row' : 'none');
    if (icon) icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
}

function toggleBookingA(cb, safeBkg) { document.querySelectorAll(`.check-a-${safeBkg}`).forEach(child => child.checked = cb.checked); calcSummaryA(); }
function toggleAllAudit(source) { document.querySelectorAll('.bkg-check-a, .row-check-a').forEach(cb => cb.checked = source.checked); calcSummaryA(); }

function calcSummaryA() {
    let checkboxes = document.querySelectorAll('.row-check-a:checked'); document.getElementById('selCountA').innerText = checkboxes.length;
    document.querySelectorAll('.bkg-check-a').forEach(bkgCb => {
        let safeBkg = bkgCb.getAttribute('data-safebkg');
        let tChild = document.querySelectorAll(`.check-a-${safeBkg}`).length; let cChild = document.querySelectorAll(`.check-a-${safeBkg}:checked`).length;
        if (cChild === 0) { bkgCb.checked = false; bkgCb.indeterminate = false; } else if (cChild === tChild) { bkgCb.checked = true; bkgCb.indeterminate = false; } else { bkgCb.checked = false; bkgCb.indeterminate = true; }
    });
}

async function saveAuditBulk() {
    let checkboxes = document.querySelectorAll('.row-check-a:checked');
    if (checkboxes.length === 0) return Swal.fire({ icon: 'warning', title: 'ยังไม่ได้เลือกรายการ', text: 'กรุณาเลือกตู้ที่ต้องการอนุมัติ' });

    let payloadData = [];
    checkboxes.forEach(cb => {
        let c = cb.closest('.item-container-a'); let editLogs = [];
        c.querySelectorAll('.inp-inc-a, .inp-adv-a, .in-extn1, .in-extn2').forEach(inp => {
            let orig = inp.getAttribute('data-orig') || ''; let curr = inp.value || '';
            if (inp.type === 'number') { orig = parseFloat(orig) || 0; curr = parseFloat(curr) || 0; }
            if (orig !== curr) { if (inp.type === 'number') editLogs.push(`${inp.getAttribute('data-name')} ${orig.toLocaleString()}->${curr.toLocaleString()}`); else editLogs.push(`${inp.getAttribute('data-name')} เปลี่ยนเป็น ${curr}`); }
        });
        payloadData.push({
            id: cb.value, price: parseFloat(c.querySelector('.in-p').value) || 0,
            receive: (parseFloat(c.querySelector('.in-adv1').value) || 0).toString(), retrun: (parseFloat(c.querySelector('.in-adv2').value) || 0).toString(),
            extender: parseFloat(c.querySelector('.in-ext1').value) || 0, tail_drop: parseFloat(c.querySelector('.in-ext2').value) || 0, lose_time: parseFloat(c.querySelector('.in-ext3').value) || 0,
            terminal_charge: parseFloat(c.querySelector('.in-adv3').value) || 0, repair: (parseFloat(c.querySelector('.in-adv4').value) || 0).toString(),
            cleaning: parseFloat(c.querySelector('.in-adv5').value) || 0, shore: parseFloat(c.querySelector('.in-adv6').value) || 0,
            other_exp_name_1: c.querySelector('.in-extn1').value.trim(), other_exp_amt_1: parseFloat(c.querySelector('.in-extv1').value) || 0,
            other_exp_name_2: c.querySelector('.in-extn2') ? c.querySelector('.in-extn2').value.trim() : '', other_exp_amt_2: 0,
            history_edit: editLogs.length > 0 ? `[บัญชีแก้: ${editLogs.join(', ')}]` : '', status: 'พร้อมวางบิล'
        });
    });

    Swal.fire({ title: 'ยืนยันการอนุมัติ?', text: `คุณกำลังส่ง ${payloadData.length} ตู้ไปยังหน้า "เตรียมวางบิล"`, icon: 'question', showCancelButton: true, confirmButtonColor: '#4f46e5', confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก'
    }).then(async result => {
        if (result.isConfirmed) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังบันทึกข้อมูล...');
            try {
                const promises = payloadData.map(item => supabaseClient.from('plan_data').update(item).eq('id', item.id));
                const results = await Promise.all(promises); const error = results.find(r => r.error);
                if (!error) { Swal.fire({ icon: 'success', title: 'สำเร็จ!', text: 'ย้ายไปยังหน้าเตรียมวางบิลเรียบร้อย' }); forceSyncAll(); } 
                else { throw error.error; }
            } catch (err) { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
        }
    });
}

function applyFilterReady() {
    let fCust = document.getElementById('filterCustomerR') ? document.getElementById('filterCustomerR').value.toLowerCase() : '';
    let fText = document.getElementById('filterTextR') ? document.getElementById('filterTextR').value.toLowerCase() : '';
    filteredReady = readyData.filter(obj => {
        let r = obj.rowData; let matchCust = fCust === '' || (r[4] && r[4].toString().toLowerCase() === fCust);
        let matchText = fText === '' || (r[6] || '').toString().toLowerCase().includes(fText) || (r[23] || '').toString().toLowerCase().includes(fText) || (r[16] || '').toString().toLowerCase().includes(fText);
        return matchCust && matchText;
    });
    renderReadyTab();
}

function clearFilterReady() {
    if (document.getElementById('filterCustomerR')) document.getElementById('filterCustomerR').value = '';
    if (document.getElementById('filterTextR')) document.getElementById('filterTextR').value = '';
    applyFilterReady();
}

function renderReadyTab() {
    let html = '';
    if (filteredReady.length === 0) {
        document.getElementById('readyBody').innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted"><i class="bi bi-inboxes fs-1 d-block mb-2 opacity-25"></i>กรุณาเลือกลูกค้า หรือไม่มีข้อมูลพร้อมวางบิล</td></tr>';
        document.getElementById('checkAllR').checked = false; calcSummaryR(); return;
    }

    groupedReadyGlobal = {};
    filteredReady.forEach(obj => {
        let r = obj.rowData; let bkg = r[6];
        if (!groupedReadyGlobal[bkg]) groupedReadyGlobal[bkg] = { cs: r[1], customer: r[4], date: r[0], items: [], sumInc: 0, sumAdv: 0, sumTot: 0 };
        groupedReadyGlobal[bkg].items.push(obj); groupedReadyGlobal[bkg].sumInc += obj.incTot; groupedReadyGlobal[bkg].sumAdv += obj.advTot; groupedReadyGlobal[bkg].sumTot += obj.grandTot;
    });

    let bkgKeys = Object.keys(groupedReadyGlobal);
    let limitVal = document.getElementById('limitR') ? document.getElementById('limitR').value : 'ALL';
    if (limitVal !== 'ALL') bkgKeys = bkgKeys.slice(0, parseInt(limitVal));

    let stripeIdx = 0;
    for (let bkg of bkgKeys) {
        let group = groupedReadyGlobal[bkg];
        let dateStr = ""; try { dateStr = new Date(group.date).toLocaleDateString('en-GB'); } catch (e) { dateStr = group.date; }
        let totalInSystem = bkgTotalsGlobal[bkg] || group.items.length;
        let badgeClass = group.items.length < totalInSystem ? 'bg-warning bg-opacity-25 text-warning border border-warning' : 'bg-secondary bg-opacity-10 text-secondary';
        let safeBkg = 'bkg_' + bkg.replace(/[^a-zA-Z0-9]/g, '_');
        let rowStripeClass = (stripeIdx % 2 !== 0) ? 'stripe-odd' : 'stripe-even';
        stripeIdx++;

        html += `<tr class="parent-row ${rowStripeClass}" onclick="toggleDetailR('${safeBkg}')">
            <td class="text-center align-middle" onclick="event.stopPropagation();"><input type="checkbox" class="bkg-check-r form-check-input shadow-sm" value="${bkg}" data-safebkg="${safeBkg}" onchange="calcSummaryR()" style="width:1.2em; height:1.2em;"></td>
            <td><i class="bi bi-chevron-right ms-1 me-2 text-primary fw-bold" id="icon-r-${safeBkg}" style="font-size:0.8rem; transition:0.3s;"></i> ${dateStr}</td>
            <td class="fw-bold text-dark">${group.customer || '-'}</td><td class="fw-bold text-primary">${bkg}</td>
            <td class="text-center"><span class="badge ${badgeClass} rounded-pill px-3">${group.items.length} / ${totalInSystem}</span></td>
            <td class="text-end text-success fw-medium">฿${group.sumInc.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
            <td class="text-end text-danger fw-medium">฿${group.sumAdv.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
            <td class="text-end text-primary fw-bold pe-3 fs-6">฿${group.sumTot.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
            <td class="text-center" onclick="event.stopPropagation();"><button class="btn btn-white text-warning btn-sm fw-bold border rounded-pill shadow-sm" onclick="revertBooking('${bkg}')" title="ส่งกลับหน้าตรวจสอบ"><i class="bi bi-arrow-counterclockwise"></i></button></td></tr>`;

        let childRows = '';
        group.items.forEach(obj => {
            let r = obj.rowData;
            childRows += `<tr class="border-bottom border-light"><td class="text-primary fw-semibold">${r[23]||'-'}</td><td class="text-secondary"><i class="bi bi-truck me-1"></i>${r[16]||'-'}</td><td class="text-end text-success">฿${obj.incTot.toLocaleString(undefined, {minimumFractionDigits:2})}</td><td class="text-end text-danger">฿${obj.advTot.toLocaleString(undefined, {minimumFractionDigits:2})}</td><td class="text-end fw-bold">฿${obj.grandTot.toLocaleString(undefined, {minimumFractionDigits:2})}</td></tr>`;
        });
        html += `<tr class="detail-row detail-r-${safeBkg}" style="display: none; background: transparent;"><td></td><td colspan="8" class="p-0"><div class="bg-white m-2 p-2 rounded-3 shadow-sm border"><table class="table table-borderless table-sm m-0" style="font-size: 0.8rem;"><thead class="text-muted border-bottom"><tr><th>ตู้คอนเทนเนอร์</th><th>ทะเบียนรถ</th><th class="text-end">รายได้</th><th class="text-end">สำรองจ่าย</th><th class="text-end">สุทธิ</th></tr></thead><tbody>${childRows}</tbody></table></div></td></tr>`;
    }
    document.getElementById('readyBody').innerHTML = html; document.getElementById('checkAllR').checked = false; calcSummaryR();
}

function toggleDetailR(safeBkg) {
    let rows = document.querySelectorAll(`.detail-r-${safeBkg}`); let icon = document.getElementById(`icon-r-${safeBkg}`);
    if (rows.length === 0) return; let isHidden = rows[0].style.display === 'none';
    rows.forEach(r => r.style.display = isHidden ? 'table-row' : 'none');
    if (icon) icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
}

function toggleAllReady(source) { document.querySelectorAll('.bkg-check-r').forEach(cb => cb.checked = source.checked); calcSummaryR(); }

function calcSummaryR() {
    let sInc = 0, sAdv = 0, sTot = 0, countBkg = 0;
    document.querySelectorAll('.bkg-check-r:checked').forEach(cb => { let group = groupedReadyGlobal[cb.value]; if (group) { sInc += group.sumInc; sAdv += group.sumAdv; sTot += group.sumTot; countBkg++; } });
    document.getElementById('selCountR').innerText = countBkg;
    document.getElementById('sumIncomeR').innerText = sInc.toLocaleString(undefined, { minimumFractionDigits: 2 });
    document.getElementById('sumAdvanceR').innerText = sAdv.toLocaleString(undefined, { minimumFractionDigits: 2 });
    document.getElementById('sumGrandR').innerText = sTot.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function revertBooking(bkg) {
    Swal.fire({ title: 'ส่งกลับหน้าตรวจสอบ?', html: `ต้องการส่ง Booking: <b class="text-warning">${bkg}</b> กลับไปหน้าตรวจสอบยอดใหม่หรือไม่`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#f59e0b', confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก'
    }).then(async res => {
        if (res.isConfirmed) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังดึงข้อมูลกลับ...');
            try {
                const { error } = await supabaseClient.from('plan_data').update({ status: 'จบงานรอวางบิล' }).eq('booking', bkg).eq('status', 'พร้อมวางบิล');
                if (error) throw error;
                Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'ดึงกลับไปแก้ไขสำเร็จ' }); forceSyncAll();
            } catch (err) { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
        }
    });
}

async function generateInvoiceBulk() {
    let checkboxes = document.querySelectorAll('.bkg-check-r:checked');
    if (checkboxes.length === 0) return Swal.fire({ icon: 'warning', title: 'ยังไม่ได้เลือกรายการ', text: 'กรุณาเลือก Booking เพื่อออก Invoice' });

    let custSet = new Set(); tempPayloadForPDF = []; let sumTotal = 0;
    checkboxes.forEach(cb => {
        let group = groupedReadyGlobal[cb.value];
        if (group) {
            group.items.forEach(obj => {
                let r = obj.rowData; let billToName = r[34] || r[4]; custSet.add(billToName);
                tempPayloadForPDF.push({
                    rowIdx: obj.rowIdx, date: r[0], cs: r[1], type: r[2], mode: r[3], jobCustomer: r[4], load: r[5], booking: r[6], cy: r[7], cy_date: r[8], vgm: r[9], rtn: r[10], rtn_date: r[11], closing_time: r[12], agent: r[13], remark: r[14], plate: r[16] || '-',
                    price: parseFloat(r[17]) || 0, adv1: parseFloat(r[18]) || 0, adv2: parseFloat(r[19]) || 0, ext1: parseFloat(r[20]) || 0, ext2: parseFloat(r[21]) || 0, ext3: parseFloat(r[22]) || 0, container: r[23] || '-', adv6: parseFloat(r[24]) || 0, adv4: parseFloat(r[25]) || 0, adv5: parseFloat(r[26]) || 0, adv9: parseFloat(r[27]) || 0,
                    incTotal: obj.incTot, advTotal: obj.advTot, grandTotal: obj.grandTot, customer: billToName 
                });
                sumTotal += obj.grandTot;
            });
        }
    });

    if (custSet.size > 1) return Swal.fire({ icon: 'error', title: 'ไม่สามารถรวมบิลได้', text: 'ต้องเลือกลูกค้า (Bill To) เจ้าเดียวกันเพื่อรวมบิล 1 ใบ' });

    let rawCustomerName = Array.from(custSet)[0];
    try {
        const { data: custData } = await supabaseClient.from('customer').select('*').eq('full_name', rawCustomerName).maybeSingle();
        let finalNameToShow = custData ? custData.full_name : rawCustomerName;
        document.getElementById('modBillToName').value = finalNameToShow; document.getElementById('modCount').innerText = tempPayloadForPDF.length;
        document.getElementById('modTotal').innerText = '฿' + sumTotal.toLocaleString(undefined, { minimumFractionDigits: 2 });
        let today = new Date(); document.getElementById('modInvoiceDate').value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
        document.getElementById('modSplitInvoice').checked = false; document.getElementById('modCustomInvNo').value = '';
        new bootstrap.Modal(document.getElementById('invoiceSettingModal')).show();
    } catch (err) {
        document.getElementById('modBillToName').value = rawCustomerName; new bootstrap.Modal(document.getElementById('invoiceSettingModal')).show();
    }
}

async function confirmGeneratePDF() {
    let invDate = document.getElementById('modInvoiceDate').value; let finalBillTo = document.getElementById('modBillToName').value.trim();
    let isSplit = document.getElementById('modSplitInvoice').checked; let customInvNo = document.getElementById('modCustomInvNo').value.trim();
    if (!invDate || !finalBillTo) return Swal.fire({ icon: 'warning', text: 'กรุณาระบุวันที่และชื่อลูกค้า' });
    tempPayloadForPDF.forEach(item => { item.customer = finalBillTo; });

    try {
        Swal.fire({ title: 'กำลังดึงข้อมูลและรันเลขเอกสาร...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        const { data: custData } = await supabaseClient.from('customer').select('*').eq('full_name', finalBillTo).maybeSingle();
        let custInfoToSend = { officialName: custData ? custData.full_name : finalBillTo, address: custData && custData.address ? custData.address : "", taxId: custData && custData.tax_id ? String(custData.tax_id) : "", creditDays: custData && custData.credit_days ? parseInt(custData.credit_days) : 0 };

        let yy = (new Date(invDate).getFullYear() + 543).toString().slice(-2); let mm = String(new Date(invDate).getMonth() + 1).padStart(2, '0'); let prefix = "INV" + yy + mm; let finalInvNo = customInvNo;
        if (!finalInvNo) {
            const { data: lastInv } = await supabaseClient.from('invoice_data').select('invoice_no').ilike('invoice_no', `${prefix}%`).order('invoice_no', { ascending: false }).limit(1);
            let nextSeq = 1; if (lastInv && lastInv.length > 0 && lastInv[0].invoice_no) { let lastSeqStr = lastInv[0].invoice_no.replace(prefix, '').split('-')[0]; nextSeq = (parseInt(lastSeqStr, 10) || 0) + 1; }
            finalInvNo = prefix + String(nextSeq).padStart(3, '0');
        }

        Swal.fire({ title: 'กำลังสร้างไฟล์ PDF...', text: 'รอสักครู่ (ประมาณ 3-5 วินาที)', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        const res = await callInvAPI('generateInvoicePDF', { payload: tempPayloadForPDF, invoiceDate: invDate, billingUser: currentUser, isSplit: isSplit, customInvNo: finalInvNo, custInfo: custInfoToSend }, 1, false);
        
        if (res.success) {
            const rowIdsToUpdate = tempPayloadForPDF.map(item => item.rowIdx);
            const { error: planError } = await supabaseClient.from('plan_data').update({ status: 'วางบิลแล้ว', invoice_no: res.invoiceNo }).in('id', rowIdsToUpdate);
            if (planError) throw new Error("อัปเดต plan_data ไม่สำเร็จ: " + planError.message);

            const parseDate = (d) => d && d.trim() !== '' ? d : null;
            let insertPayload = tempPayloadForPDF.map(item => ({
                create_date: parseDate(item.date), cs: item.cs || null, container_type: item.type || null, mode: item.mode || null, customer: item.jobCustomer || null, load_place: item.load || null, booking: item.booking || null, cy_place: item.cy || null, cy_date: parseDate(item.cy_date), vgm: item.vgm || null, rtn_place: item.rtn || null, rtn_date: parseDate(item.rtn_date), closing_time: item.closing_time || null, agent: item.agent || null, comment: item.remark || null,
                status: 'วางบิลแล้ว', vehicle_plate: item.plate || null, price: Math.round(item.price) || 0, receive: item.adv1 || 0, return: item.adv2 || 0, extender: Math.round(item.ext1) || 0, drop_tail: Math.round(item.ext2) || 0, lose_time: Math.round(item.ext3) || 0, container_no: item.container || null, repair: String(item.adv4 || 0), cleaning: Math.round(item.adv5) || 0, terminal_charge: Math.round(item.adv6) || 0, total_income: Math.round(item.incTotal) || 0, total_advance: String(item.advTotal || 0), grand_total: Math.round(item.grandTotal) || 0, bill_status: 'วางบิลแล้ว', invoice_no: res.invoiceNo, ref_key: `${item.booking}_${item.container}_${res.invoiceNo}`, user_action: currentUser, bill_date: invDate
            }));

            const { error: invError } = await supabaseClient.from('invoice_data').insert(insertPayload);
            if (invError) throw new Error("บันทึกประวัติ Invoice ลงฐานข้อมูลไม่สำเร็จ: " + invError.message);

            bootstrap.Modal.getInstance(document.getElementById('invoiceSettingModal')).hide();
            let htmlContent = '';
            if (res.pdfUrls && res.pdfUrls.length > 1) { htmlContent = `<p class="text-muted">บิลแยกประเภทพร้อมแล้ว</p><div class="d-flex flex-column gap-3 mt-3 px-2"><a href="${res.pdfUrls[0]}" target="_blank" class="btn btn-primary rounded-pill fw-bold shadow-sm py-2">บิลค่าขนส่ง</a><a href="${res.pdfUrls[1]}" target="_blank" class="btn btn-light text-primary border-primary rounded-pill fw-bold shadow-sm py-2">บิลสำรองจ่าย</a></div>`; } 
            else { htmlContent = `<p class="text-muted">เอกสารพร้อมใช้งาน</p><a href="${res.pdfUrl}" target="_blank" class="btn btn-primary btn-sm rounded-pill mt-2 px-5 fw-bold shadow-sm" onclick="Swal.close()"><i class="bi bi-file-earmark-pdf-fill me-1"></i> เปิดดู Invoice</a>`; }
            Swal.fire({ icon: 'success', title: 'สร้าง Invoice สำเร็จ!', html: htmlContent, showConfirmButton: false, showCloseButton: true, didClose: () => { document.getElementById('tab-history').click(); forceSyncAll(); } });
        } else { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาดจากระบบออกเอกสาร', text: res.message }); }
    } catch (err) { Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
}

async function loadHistory(forceSync = false) {
    document.getElementById('historyBody').innerHTML = '<tr><td colspan="7" class="text-center py-5 text-primary"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดประวัติ...</td></tr>';
    
    let currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    let hMonthElem = document.getElementById('hFilterMonth');
    if (hMonthElem && !hMonthElem.getAttribute('data-init')) {
        hMonthElem.value = currentMonth;
        hMonthElem.setAttribute('data-init', 'true');
    }

    try {
        let historyDataList = [];
        let hFrom = 0;
        const step = 1000;
        while (true) {
            const { data: chunk, error } = await supabaseClient.from('invoice_data')
                .select('*')
                .order('invoice_no', { ascending: false })
                .order('id', { ascending: true })
                .range(hFrom, hFrom + step - 1);
            if (error) throw error;
            historyDataList = historyDataList.concat(chunk);
            if (chunk.length < step) break;
            hFrom += step;
        }
        
        let grouped = {};
        historyDataList.forEach(r => {
            let invNo = r.invoice_no; if (!invNo) return;
            if (!grouped[invNo]) { grouped[invNo] = { invoiceNo: invNo, cs: r.cs || '-', customer: r.customer || '-', date: r.bill_date || r.create_date || r.created_at, totalAmount: 0, count: 0, billingUser: r.user_action || 'Admin', receiptNo: r.receive_no || '', voucherNo: r.voucher_no || '' }; }
            grouped[invNo].totalAmount += (parseFloat(r.grand_total) || 0); grouped[invNo].count++;
        });
        rawHistoryData = Object.values(grouped).sort((a, b) => b.invoiceNo.localeCompare(a.invoiceNo));
        populateHistoryDropdowns(rawHistoryData); applyHistoryFilter();
    } catch (err) { document.getElementById('historyBody').innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${err.message}</td></tr>`; }
}

function populateHistoryDropdowns(data) {
    let customers = [...new Set(data.map(r => r.customer).filter(v => v))];
    let ddlCust = '<option value="">- ลูกค้าทั้งหมด -</option>'; customers.forEach(c => ddlCust += `<option value="${c}">${c}</option>`);
    if (document.getElementById('hFilterCustomer')) document.getElementById('hFilterCustomer').innerHTML = ddlCust;
    let csList = [...new Set(data.map(r => r.cs).filter(v => v && v !== '-'))];
    let ddlCS = '<option value="">- CS ทั้งหมด -</option>'; csList.forEach(c => ddlCS += `<option value="${c}">${c}</option>`);
    if (document.getElementById('hFilterCS')) document.getElementById('hFilterCS').innerHTML = ddlCS;
}

function clearHistoryFilters() {
    ['hFilterText', 'hFilterCS', 'hFilterCustomer', 'hFilterYear', 'hFilterMonth'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = ''; });
    applyHistoryFilter();
}

function applyHistoryFilter() {
    let fText = document.getElementById('hFilterText') ? document.getElementById('hFilterText').value.toLowerCase() : '';
    let fCS = document.getElementById('hFilterCS') ? document.getElementById('hFilterCS').value.toLowerCase() : '';
    let fCust = document.getElementById('hFilterCustomer') ? document.getElementById('hFilterCustomer').value.toLowerCase() : '';
    let fYear = document.getElementById('hFilterYear') ? document.getElementById('hFilterYear').value : '';
    let fMonth = document.getElementById('hFilterMonth') ? document.getElementById('hFilterMonth').value : '';

    filteredHistoryData = rawHistoryData.filter(r => {
        let d = new Date(r.date); let validDate = !isNaN(d.getTime());
        let matchText = fText === '' || r.invoiceNo.toLowerCase().includes(fText);
        let matchCS = fCS === '' || (r.cs && r.cs.toLowerCase().includes(fCS));
        let matchCust = fCust === '' || (r.customer && r.customer.toLowerCase().includes(fCust));
        let mYear = fYear === '' || (validDate && d.getFullYear().toString() === fYear);
        let mMonth = fMonth === '' || (validDate && (d.getMonth() + 1).toString().padStart(2, '0') === fMonth);
        return matchText && matchCS && matchCust && mYear && mMonth;
    });
    sortHistory(histSortCol, true);
}

function sortHistory(col, keepDirection = false) {
    if (!keepDirection) { if (histSortCol === col) histSortAsc = !histSortAsc; else { histSortCol = col; histSortAsc = true; } }
    filteredHistoryData.sort((a, b) => {
        let valA = a[col]; let valB = b[col];
        if (col === 'date') { valA = new Date(valA).getTime(); valB = new Date(valB).getTime(); } 
        else if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
        if (valA < valB) return histSortAsc ? -1 : 1;
        if (valA > valB) return histSortAsc ? 1 : -1;
        return 0;
    });
    renderHistoryTable();
}

function renderHistoryTable() {
    let html = '';
    if (filteredHistoryData.length === 0) { html = '<tr><td colspan="7" class="text-center text-muted py-5"><i class="bi bi-files fs-1 d-block mb-2 opacity-25"></i> ไม่พบประวัติเอกสาร</td></tr>'; } 
    else {
        let limitVal = document.getElementById('limitH') ? document.getElementById('limitH').value : 'ALL';
        let dataToRender = limitVal !== 'ALL' ? filteredHistoryData.slice(0, parseInt(limitVal)) : filteredHistoryData;
        let stripeIdx = 0;
        
        dataToRender.forEach((r) => {
            let dateStr = ""; try { dateStr = new Date(r.date).toLocaleDateString('en-GB'); } catch (e) { dateStr = r.date; }
            let isOwnerOrAdmin = true; let docStatusStr = ''; let menuItems = '';

            menuItems += `<li><h6 class="dropdown-header py-1 small"><i class="bi bi-eye"></i> ดูเอกสาร</h6></li>`;
            menuItems += `<li><button class="dropdown-item text-primary small py-1" type="button" onclick="printPDF('${r.invoiceNo}')"><i class="bi bi-file-earmark-text me-2"></i>ใบแจ้งหนี้</button></li>`;

            if (r.receiptNo) { docStatusStr += '<span class="badge bg-success bg-opacity-10 text-success border border-success mt-1 me-1 px-2 py-1">ใบเสร็จ</span>'; menuItems += `<li><button class="dropdown-item text-success small py-1" type="button" onclick="printPDF('${r.receiptNo}')"><i class="bi bi-receipt me-2"></i>ใบเสร็จรับเงิน</button></li>`; }
            if (r.voucherNo) { docStatusStr += '<span class="badge bg-info bg-opacity-10 text-info border border-info mt-1 px-2 py-1">ใบสำคัญ</span>'; menuItems += `<li><button class="dropdown-item text-info small py-1" type="button" onclick="printPDF('${r.voucherNo}')"><i class="bi bi-cash-coin me-2"></i>ใบสำคัญรับ</button></li>`; }
            if (!r.receiptNo || !r.voucherNo) {
                menuItems += `<li><hr class="dropdown-divider my-1"></li>`;
                if (!r.receiptNo) menuItems += `<li><button class="dropdown-item text-success small py-1" type="button" onclick="openReceiptModal('${r.invoiceNo}', 'RECEIPT')"><i class="bi bi-plus-circle me-2"></i>สร้างใบเสร็จรับเงิน</button></li>`;
                if (!r.voucherNo) menuItems += `<li><button class="dropdown-item text-info small py-1" type="button" onclick="openReceiptModal('${r.invoiceNo}', 'VOUCHER')"><i class="bi bi-plus-circle me-2"></i>สร้างใบสำคัญรับ</button></li>`;
            }

            menuItems += `<li><hr class="dropdown-divider my-1"></li>`;
            if (isOwnerOrAdmin) {
                if (r.receiptNo) menuItems += `<li><button class="dropdown-item text-danger small py-1" type="button" onclick="promptRollbackReceipt('${r.invoiceNo}', '${r.receiptNo}', 'REC')"><i class="bi bi-trash me-2"></i>ลบใบเสร็จรับเงิน</button></li>`;
                if (r.voucherNo) menuItems += `<li><button class="dropdown-item text-danger small py-1" type="button" onclick="promptRollbackReceipt('${r.invoiceNo}', '${r.voucherNo}', 'VOU')"><i class="bi bi-trash me-2"></i>ลบใบสำคัญรับ</button></li>`;
                if (!r.receiptNo && !r.voucherNo) {
                    menuItems += `<li><button class="dropdown-item text-dark fw-bold small py-1" type="button" onclick="openEditInvoiceModal('${r.invoiceNo}')"><i class="bi bi-pencil-square me-2"></i>แก้ไขบิลโดยตรง</button></li>`;
                    menuItems += `<li><button class="dropdown-item text-danger small py-1" type="button" onclick="promptRollback('${r.invoiceNo}')"><i class="bi bi-arrow-counterclockwise me-2"></i>ยกเลิกบิล</button></li>`;
                } else {
                    menuItems += `<li><button class="dropdown-item text-muted small py-1" type="button" onclick="Swal.fire({icon:'warning', text:'กรุณาลบใบเสร็จ/ใบสำคัญรับ ทิ้งก่อน'})"> <i class="bi bi-pencil-square me-2"></i>แก้ไขบิลโดยตรง </button></li>`;
                    menuItems += `<li><button class="dropdown-item text-muted small py-1" type="button" onclick="Swal.fire({icon:'warning', text:'กรุณาลบใบเสร็จ/ใบสำคัญรับ ทิ้งก่อน'})"> <i class="bi bi-arrow-counterclockwise me-2"></i>ยกเลิกบิล </button></li>`;
                }
            }

            let displayStatusBadge = docStatusStr ? `<br><div class="mt-1">${docStatusStr}</div>` : '';
            let quickViewLink = `<a href="javascript:void(0);" onclick="viewInvoiceDetails('${r.invoiceNo}')" class="text-primary fw-bold text-decoration-none"><i class="bi bi-info-circle-fill me-1 opacity-50"></i>${r.invoiceNo}</a>`;
            
            let rowStripeClass = (stripeIdx % 2 !== 0) ? 'bg-light' : 'bg-white';
            stripeIdx++;

            html += `<tr class="${rowStripeClass}"><td class="px-3">${quickViewLink}${displayStatusBadge}</td><td class="text-muted fw-medium">${dateStr}</td><td class="text-secondary fw-medium">${r.cs}</td><td class="fw-bold text-dark">${r.customer}</td><td class="text-center"><span class="badge bg-light text-dark border rounded-pill px-3 shadow-sm">${r.count}</span></td><td class="text-end fw-bold text-primary fs-6">฿${r.totalAmount.toLocaleString(undefined, {minimumFractionDigits:2})}</td><td class="text-center pe-4"><div class="btn-group dropstart"><button type="button" class="btn btn-white border shadow-sm btn-sm fw-bold dropdown-toggle dropdown-toggle-split rounded-pill px-3 text-secondary" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button><ul class="dropdown-menu shadow-lg border-0 py-1">${menuItems}</ul></div></td></tr>`;
        });
    }
    document.getElementById('historyBody').innerHTML = html;
}

async function viewInvoiceDetails(invNo) {
    try {
        const { data, error } = await supabaseClient.from('invoice_data').select('*').eq('invoice_no', invNo);
        if (error) throw error;
        let html = `<div class="bg-white border rounded-3 overflow-hidden mt-2 shadow-sm"><table class="table table-borderless table-hover text-nowrap m-0" style="font-size: 0.8rem;"><thead class="bg-light text-muted border-bottom"><tr><th class="py-2 px-3">ตู้คอนเทนเนอร์</th><th>ทะเบียนรถ</th><th class="text-end">รายได้</th><th class="text-end">สำรองจ่าย</th><th class="text-end pe-3">รวมสุทธิ</th></tr></thead><tbody>`;
        data.forEach(r => { let inc = parseFloat(r.total_income) || 0; let adv = parseFloat(r.total_advance) || 0; html += `<tr><td class="text-start fw-bold text-primary py-2 px-3">${r.container_no||'-'}</td><td class="text-start text-secondary">${r.vehicle_plate||'-'}</td><td class="text-end text-success fw-medium">฿${inc.toLocaleString(undefined, {minimumFractionDigits:2})}</td><td class="text-end text-danger fw-medium">฿${adv.toLocaleString(undefined, {minimumFractionDigits:2})}</td><td class="text-end fw-bold text-dark pe-3">฿${(inc+adv).toLocaleString(undefined, {minimumFractionDigits:2})}</td></tr>`; });
        html += `</tbody></table></div>`;
        Swal.fire({ title: `<span class="fw-bold fs-5 text-dark">${invNo}</span>`, html: `<div class="table-responsive" style="max-height: 400px; padding:0;">${html}</div>`, width: '650px', showCloseButton: true, showConfirmButton: false });
    } catch (err) { Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
}

async function openEditInvoiceModal(invoiceNo) {
    try {
        if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังโหลดข้อมูลบิล...');
        const { data, error } = await supabaseClient.from('invoice_data').select('*').eq('invoice_no', invoiceNo);
        if (error) throw error;
        if (!data || data.length === 0) return Swal.fire('ไม่พบข้อมูล', 'ไม่มีข้อมูลบิลนี้ในระบบ', 'error');

        document.getElementById('editInvNo').value = invoiceNo; document.getElementById('editInvDate').value = data[0].bill_date || data[0].create_date || '';
        document.getElementById('editCustomer').value = data[0].customer || ''; document.getElementById('editIsSplit').checked = false;

        let html = '';
        data.forEach((itm) => {
            let d = new Date(itm.create_date); let factoryDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
            
            html += `<div class="card shadow-sm border border-light mb-2 edit-item-card rounded-3 overflow-hidden p-0" data-booking="${itm.booking}" data-container="${itm.container_no}" data-rowid="${itm.id}">
                <div class="card-header bg-white border-bottom py-2 d-flex justify-content-between align-items-center"><h6 class="fw-bold text-dark mb-0 fs-6"><i class="bi bi-box-seam me-2 text-primary"></i>ข้อมูลตู้เดิม: <span class="text-primary">${itm.container_no}</span> <span class="badge bg-light text-secondary border fw-medium ms-2">BKG: ${itm.booking}</span></h6></div>
                <div class="card-body bg-light p-2">
                    <div class="row g-2 mb-2 pb-2 border-bottom border-secondary border-opacity-25">
                        <div class="col-md-4"><label class="small text-muted fw-bold mb-0">วันที่เข้าโรงงาน</label><input type="date" class="form-control form-control-sm bg-white e-date border-secondary" value="${factoryDate}"></div>
                        <div class="col-md-4"><label class="small text-muted fw-bold mb-0">เบอร์ตู้</label><input type="text" class="form-control form-control-sm bg-white e-container border-secondary" value="${itm.container_no}"></div>
                        <div class="col-md-4"><label class="small text-muted fw-bold mb-0">ทะเบียนรถ</label><input type="text" class="form-control form-control-sm bg-white e-plate border-secondary" value="${itm.vehicle_plate || ''}"></div>
                    </div>
                    <div class="row g-2"><div class="col-md-6 border-end border-light"><p class="text-success fw-bold small mb-1"><i class="bi bi-arrow-up-right-circle me-1"></i>รายได้ (Income)</p><div class="row g-1"><div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ราคาเที่ยว</label><input type="number" class="form-control form-control-sm bg-white e-price" value="${itm.price || 0}"></div><div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ต่อระยะ</label><input type="number" class="form-control form-control-sm bg-white e-ext1" value="${itm.extender || 0}"></div><div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ค้างหาง</label><input type="number" class="form-control form-control-sm bg-white e-ext2" value="${itm.drop_tail || 0}"></div><div class="col-6"><label class="small text-muted mb-0" style="font-size: 0.7rem;">เสียเวลา</label><input type="number" class="form-control form-control-sm bg-white e-ext3" value="${itm.lose_time || 0}"></div></div></div>
                <div class="col-md-6"><p class="text-danger fw-bold small mb-1"><i class="bi bi-arrow-down-right-circle me-1"></i>สำรองจ่าย (Advance)</p><div class="row g-1"><div class="col-4"><label class="small text-muted mb-0" style="font-size: 0.7rem;">รับตู้</label><input type="number" class="form-control form-control-sm bg-white e-adv1" value="${itm.receive || 0}"></div><div class="col-4"><label class="small text-muted mb-0" style="font-size: 0.7rem;">คืนตู้</label><input type="number" class="form-control form-control-sm bg-white e-adv2" value="${itm.return || 0}"></div><div class="col-4"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ผ่านท่า</label><input type="number" class="form-control form-control-sm bg-white e-adv3" value="${itm.terminal_charge || 0}"></div><div class="col-4"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ซ่อมตู้</label><input type="number" class="form-control form-control-sm bg-white e-adv4" value="${itm.repair || 0}"></div><div class="col-4"><label class="small text-muted mb-0" style="font-size: 0.7rem;">ล้างตู้</label><input type="number" class="form-control form-control-sm bg-white e-adv5" value="${itm.cleaning || 0}"></div></div></div></div></div></div>`;
        });
        document.getElementById('editItemsContainer').innerHTML = html;
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        new bootstrap.Modal(document.getElementById('editInvoiceModal')).show();
    } catch (err) { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
}

async function confirmEditInvoice() {
    let invNo = document.getElementById('editInvNo').value; let invDate = document.getElementById('editInvDate').value; let customer = document.getElementById('editCustomer').value.trim(); let isSplit = document.getElementById('editIsSplit').checked;
    if (!invDate || !customer) return Swal.fire({ icon: 'warning', text: 'กรุณาระบุวันที่และชื่อลูกค้า' });

    Swal.fire({ title: 'ยืนยันการอัปเดต?', text: "ระบบจะอัปเดตข้อมูลตู้และสร้าง PDF ใบใหม่ทับของเดิม", icon: 'warning', showCancelButton: true, confirmButtonColor: '#1e293b', confirmButtonText: 'ยืนยันอัปเดต', cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังบันทึกและสร้างเอกสารใหม่...');
            try {
                const { data: oldData, error: fetchErr } = await supabaseClient.from('invoice_data').select('*').eq('invoice_no', invNo);
                if (fetchErr) throw fetchErr;

                const { data: custData } = await supabaseClient.from('customer').select('*').eq('full_name', customer).maybeSingle();
                let custInfoToSend = { officialName: custData ? custData.full_name : customer, address: custData && custData.address ? custData.address : "", taxId: custData && custData.tax_id ? String(custData.tax_id) : "", creditDays: custData && custData.credit_days ? parseInt(custData.credit_days) : 0 };

                let payload = []; let insertPayload = []; let planUpdates = []; let cards = document.querySelectorAll('.edit-item-card');
                let parseDate = (d) => d && d.trim() !== '' ? d : null;

                cards.forEach(card => {
                    let booking = card.getAttribute('data-booking'); 
                    let origContainer = card.getAttribute('data-container');
                    let oldItem = oldData.find(o => o.booking === booking && o.container_no === origContainer) || {};

                    let cDate = card.querySelector('.e-date').value;
                    let cDateParsed = parseDate(cDate);
                    let cContainer = card.querySelector('.e-container').value.trim() || origContainer;
                    let cPlate = card.querySelector('.e-plate').value.trim() || '-';

                    let p = parseFloat(card.querySelector('.e-price').value) || 0, e1 = parseFloat(card.querySelector('.e-ext1').value) || 0, e2 = parseFloat(card.querySelector('.e-ext2').value) || 0, e3 = parseFloat(card.querySelector('.e-ext3').value) || 0;
                    let a1 = parseFloat(card.querySelector('.e-adv1').value) || 0, a2 = parseFloat(card.querySelector('.e-adv2').value) || 0, a3 = parseFloat(card.querySelector('.e-adv3').value) || 0, a4 = parseFloat(card.querySelector('.e-adv4').value) || 0, a5 = parseFloat(card.querySelector('.e-adv5').value) || 0;

                    let incTot = p + e1 + e2 + e3; let advTot = a1 + a2 + a3 + a4 + a5;

                    payload.push({ 
                        rowIdx: oldItem.id, jobCustomer: oldItem.customer, customer: customer, booking: booking, 
                        date: cDateParsed || oldItem.create_date, plate: cPlate, cy: oldItem.cy_place || '-', load: oldItem.load_place || '-', 
                        rtn: oldItem.rtn_place || '-', type: oldItem.container_type || '-', container: cContainer, remark: oldItem.comment || '', 
                        price: p, adv1: a1, adv2: a2, ext1: e1, ext2: e2, ext3: e3, adv4: a4, adv5: a5, adv6: a3, 
                        incTotal: incTot, advTotal: advTot, grandTotal: incTot + advTot 
                    });

                    let newItemForDB = { ...oldItem };
                    delete newItemForDB.id;
                    
                    newItemForDB.customer = customer;
                    newItemForDB.bill_date = invDate;
                    newItemForDB.create_date = cDateParsed || oldItem.create_date;
                    newItemForDB.container_no = cContainer;
                    newItemForDB.vehicle_plate = cPlate;
                    newItemForDB.price = p;
                    newItemForDB.extender = e1;
                    newItemForDB.drop_tail = e2;
                    newItemForDB.lose_time = e3;
                    newItemForDB.receive = a1;
                    newItemForDB.return = a2;
                    newItemForDB.terminal_charge = a3;
                    newItemForDB.repair = String(a4);
                    newItemForDB.cleaning = a5;
                    newItemForDB.total_income = incTot;
                    newItemForDB.total_advance = String(advTot);
                    newItemForDB.grand_total = incTot + advTot;
                    newItemForDB.user_action = currentUser;
                    
                    insertPayload.push(newItemForDB);

                    planUpdates.push(
                        supabaseClient.from('plan_data')
                        .update({ 
                            container_no: cContainer, 
                            vehicle_plate: cPlate, 
                            booking_date: cDateParsed || oldItem.create_date,
                            price: p, extender: e1, tail_drop: e2, lose_time: e3,
                            receive: String(a1), retrun: String(a2), terminal_charge: a3,
                            repair: String(a4), cleaning: a5
                        })
                        .eq('invoice_no', invNo)
                        .eq('booking', booking)
                        .eq('container_no', origContainer)
                    );
                });

                const planResults = await Promise.all(planUpdates);
                const planError = planResults.find(r => r.error);
                if (planError) throw new Error("อัปเดต plan_data ไม่สำเร็จ: " + planError.error.message);

                await callInvAPI('rollbackInvoice', { invoiceNo: invNo }, 1, false);

                const res = await callInvAPI('generateInvoicePDF', { payload: payload, invoiceDate: invDate, billingUser: currentUser, isSplit: isSplit, customInvNo: invNo, custInfo: custInfoToSend }, 1, false);
                
                if (res.success) {
                    const { error: delErr } = await supabaseClient.from('invoice_data').delete().eq('invoice_no', invNo);
                    if (delErr) throw new Error("ลบข้อมูลเก่าไม่สำเร็จ: " + delErr.message);

                    const { error: insErr } = await supabaseClient.from('invoice_data').insert(insertPayload);
                    if (insErr) throw new Error("บันทึกข้อมูลใหม่ไม่สำเร็จ: " + insErr.message);

                    bootstrap.Modal.getInstance(document.getElementById('editInvoiceModal')).hide();
                    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

                    let htmlContent = '';
                    if (res.pdfUrls && res.pdfUrls.length > 1) { htmlContent = `<p class="text-muted">เอกสารใหม่พร้อมแล้ว</p><div class="d-flex flex-column gap-2 mt-3"><a href="${res.pdfUrls[0]}" target="_blank" class="btn btn-primary rounded-pill fw-bold btn-sm">บิลค่าขนส่ง</a><a href="${res.pdfUrls[1]}" target="_blank" class="btn btn-light text-primary border-primary rounded-pill fw-bold btn-sm">บิลสำรองจ่าย</a></div>`; } 
                    else { htmlContent = `<p class="text-muted">อัปเดตเอกสารเรียบร้อยแล้ว</p><a href="${res.pdfUrl}" target="_blank" class="btn btn-dark btn-sm rounded-pill mt-3 px-4 fw-bold shadow-sm" onclick="Swal.close()"><i class="bi bi-file-earmark-pdf me-1"></i> เปิดดูเอกสาร</a>`; }
                    Swal.fire({ icon: 'success', title: 'อัปเดตสำเร็จ!', html: htmlContent, showConfirmButton: false, showCloseButton: true, didClose: () => { forceSyncAll(); } });
                } else { 
                    if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); 
                    Swal.fire({ icon: 'error', text: res.message }); 
                }
            } catch (err) { 
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); 
                Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); 
            }
        }
    });
}

function promptRollback(invoiceNo) {
    Swal.fire({ title: 'ยกเลิกบิล?', html: `ต้องการยกเลิก Invoice <b class="text-danger">${invoiceNo}</b> และส่งกลับไปหน้าเตรียมวางบิลหรือไม่`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ยืนยันยกเลิกบิล', cancelButtonText: 'ปิด'
    }).then(async res => {
        if (res.isConfirmed) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังดึงบิลกลับ...');
            try {
                await supabaseClient.from('plan_data').update({ status: 'พร้อมวางบิล', invoice_no: null }).eq('invoice_no', invoiceNo);
                await supabaseClient.from('invoice_data').delete().eq('invoice_no', invoiceNo);
                await callInvAPI('rollbackInvoice', { invoiceNo: invoiceNo }); 
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
                Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'ยกเลิกบิลเรียบร้อย' }); forceSyncAll();
            } catch (err) { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
        }
    });
}

function promptRollbackReceipt(invoiceNo, docNoToDel, docTypeToDel) {
    let txt = docTypeToDel === 'REC' ? 'ใบเสร็จรับเงิน' : 'ใบสำคัญรับ';
    Swal.fire({ title: `ลบ${txt}?`, html: `คุณแน่ใจหรือไม่ว่าต้องการลบ <b class="text-danger">${docNoToDel}</b>`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: `ยืนยันลบ`, cancelButtonText: 'ยกเลิก'
    }).then(async res => {
        if (res.isConfirmed) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังลบเอกสาร...');
            try {
                let updatePayload = docTypeToDel === 'REC' ? { receive_no: null } : { voucher_no: null };
                await supabaseClient.from('invoice_data').update(updatePayload).eq('invoice_no', invoiceNo);
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
                Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', text: 'ยกเลิกเอกสารเรียบร้อย' }); forceSyncAll();
            } catch (err) { if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
        }
    });
}

async function printPDF(docNo) {
    try {
        const res = await callInvAPI('getPdfUrl', { docNo: docNo.split(',')[0].trim() }, 2, false);
        if (res.success) { Swal.fire({ title: `<i class="bi bi-file-earmark-pdf text-primary fs-1"></i>`, html: `<h5 class="fw-bold mb-3">${docNo}</h5><a href="${res.url}" target="_blank" class="btn btn-primary btn-sm rounded-pill px-4 fw-bold shadow" onclick="Swal.close()">เปิดเอกสาร</a>`, showConfirmButton: false, showCloseButton: true }); } 
        else { Swal.fire({ icon: 'error', text: res.message }); }
    } catch (err) { Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); }
}

function openReceiptModal(invNo, docType) {
    currentReceiptInvNo = invNo; currentDocType = docType;
    const header = document.getElementById('recModalHeader'); const icon = document.getElementById('recModalIcon');
    const titleText = document.getElementById('recModalTitleText'); const info = document.getElementById('recModalInfo');
    const btn = document.getElementById('btnConfirmReceipt'); const btnText = document.getElementById('btnConfirmReceiptText');

    if (docType === 'RECEIPT') {
        if (header) header.className = 'modal-header bg-success bg-gradient text-white border-0 py-2';
        if (icon) icon.className = 'bi bi-receipt-cutoff me-2';
        if (titleText) titleText.innerText = 'ออกใบเสร็จรับเงิน';
        if (info) info.innerHTML = `<span class="badge bg-success bg-opacity-10 text-success border border-success fw-bold">คำนวณเฉพาะยอดค่าขนส่ง (Freight Charge)</span>`;
        if (btn) btn.className = 'btn btn-success btn-sm rounded-pill px-4 fw-bold shadow-sm';
        if (btnText) btnText.innerText = 'สร้างใบเสร็จรับเงิน';
    } else {
        if (header) header.className = 'modal-header bg-info bg-gradient text-dark border-0 py-2';
        if (icon) icon.className = 'bi bi-cash-coin me-2';
        if (titleText) titleText.innerText = 'ออกใบสำคัญรับ';
        if (info) info.innerHTML = `<span class="badge bg-info bg-opacity-10 text-info border border-info fw-bold">คำนวณเฉพาะยอดสำรองจ่าย (Advance Payment)</span>`;
        if (btn) btn.className = 'btn btn-info btn-sm text-dark rounded-pill px-4 fw-bold shadow-sm';
        if (btnText) btnText.innerText = 'สร้างใบสำคัญรับ';
    }
    if (document.getElementById('recInvoiceNoLabel')) document.getElementById('recInvoiceNoLabel').innerText = invNo;
    let today = new Date(); if (document.getElementById('modReceiptDate')) document.getElementById('modReceiptDate').value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
    if (btn) btn.disabled = false;
    new bootstrap.Modal(document.getElementById('receiptSettingModal')).show();
}

async function confirmGenerateReceipt() {
    let recDate = document.getElementById('modReceiptDate').value; let layoutMode = document.getElementById('recModeDetail').checked ? 'DETAIL' : 'SUMMARY'; let showDueDate = document.getElementById('recShowDueDate').checked;
    if (!recDate) return Swal.fire({ icon: 'warning', text: 'กรุณาระบุวันที่' });
    document.getElementById('btnConfirmReceipt').disabled = true;

    try {
        if (typeof showGlobalLoader === 'function') showGlobalLoader('กำลังสร้างเอกสารใหม่...');
        const { data: bData } = await supabaseClient.from('invoice_data').select('*').eq('invoice_no', currentReceiptInvNo);
        if(!bData || bData.length === 0) throw new Error("ไม่พบข้อมูลบิลนี้ในระบบ");

        const { data: cData } = await supabaseClient.from('customer').select('*').eq('full_name', bData[0].customer).maybeSingle();
        let custInfoToSend = { officialName: cData ? cData.full_name : bData[0].customer, address: cData && cData.address ? cData.address : "", taxId: cData && cData.tax_id ? String(cData.tax_id) : "", creditDays: cData && cData.credit_days ? parseInt(cData.credit_days) : 0 };

        let itemsPayload = bData.map(r => {
            let inc = parseFloat(r.total_income) || 0; let adv = parseFloat(r.total_advance) || 0;
            return { container: r.container_no, plate: r.vehicle_plate, amountToBill: currentDocType === 'VOUCHER' ? adv : inc, advDetails: { a1: parseFloat(r.receive)||0, a2: parseFloat(r.return)||0, a_pass: parseFloat(r.terminal_charge)||0, a_repair: parseFloat(r.repair)||0, a_clean: parseFloat(r.cleaning)||0, a_cho: parseFloat(r.shore)||0, n1: r.other_exp_name_1||'', v1: parseFloat(r.other_exp_amt_1)||0 } }
        });

        const res = await callInvAPI('generateReceiptPDF', { invoiceNo: currentReceiptInvNo, docDate: recDate, layoutMode: layoutMode, billingUser: currentUser, docType: currentDocType, showDueDate: showDueDate, custInfo: custInfoToSend, itemsPayload: itemsPayload }, 1, false);

        if (res.success) {
            let updatePayload = currentDocType === 'RECEIPT' ? { receive_no: res.receiptNo } : { voucher_no: res.receiptNo };
            const { error } = await supabaseClient.from('invoice_data').update(updatePayload).eq('invoice_no', currentReceiptInvNo);
            
            if (error) {
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); document.getElementById('btnConfirmReceipt').disabled = false;
                Swal.fire('บันทึกสถานะไม่สำเร็จ', `ออกเอกสารสำเร็จแต่บันทึกไม่ได้: ${error.message}`, 'error'); return;
            }

            bootstrap.Modal.getInstance(document.getElementById('receiptSettingModal')).hide(); document.getElementById('btnConfirmReceipt').disabled = false;
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            let docName = currentDocType === 'RECEIPT' ? 'ใบเสร็จรับเงิน' : 'ใบสำคัญรับ'; let btnClass = currentDocType === 'RECEIPT' ? 'btn-success' : 'btn-info text-dark';
            Swal.fire({ icon: 'success', title: `สร้าง${docName}สำเร็จ!`, html: `<a href="${res.pdfUrl}" target="_blank" class="btn ${btnClass} btn-sm rounded-pill mt-3 px-4 fw-bold shadow-sm" onclick="Swal.close()"><i class="bi bi-file-earmark-pdf-fill me-1"></i> เปิดดูเอกสาร</a>`, showConfirmButton: false, showCloseButton: true, didClose: () => { forceSyncAll(); } });
        } else { 
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); document.getElementById('btnConfirmReceipt').disabled = false;
            Swal.fire({ icon: 'error', text: res.message }); 
        }
    } catch (err) { 
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader(); document.getElementById('btnConfirmReceipt').disabled = false; 
        Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); 
    }
}