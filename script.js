// นำ URL ใหม่ล่าสุดมาใส่ตรงนี้ครับ
const API_URL = 'https://script.google.com/macros/s/AKfycbz_Cl1rnOZhuLh-Rzfw0EiIKB3cxLelvQmKsDiAW4zvrcmbsJnf7UTxRQJCsvY-YCxiDA/exec';

async function callAPI(action, payload = {}, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        try {
            // ระบบเข้าคิวอัตโนมัติ: หากโดน Google บล็อก จะรอ 1-3 วินาทีแล้วยิงใหม่เงียบๆ
            if (i > 0) await new Promise(res => setTimeout(res, 1000 * i + Math.random() * 1000));
            
            const response = await fetch(API_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: action, payload: payload })
            });
            
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            
            const text = await response.text();
            let result;
            try { 
                result = JSON.parse(text); 
            } catch (e) { 
                throw new Error("Server Error"); 
            }
            
            if (result && result.success === false && result.message) {
                if (result.message.includes("ประมวลผล")) throw new Error("BUSY");
                throw new Error(result.message);
            }
            
            return result;
        } catch (error) {
            // ถ้าระบบพยายามซ่อมตัวเองครบ 3 รอบแล้วยังไม่ได้ ค่อยแจ้ง Error
            if (i === retries) {
                console.error('API Error:', error);
                return { success: false, message: error.message === "BUSY" ? "ระบบหนาแน่น กรุณาลองใหม่" : "การเชื่อมต่อขัดข้อง" };
            }
        }
    }
}

document.addEventListener('focusin', function (e) {
  if (e.target.closest && e.target.closest('.swal2-container')) {
      e.stopImmediatePropagation();
  }
}, true);

let currentUser = ''; 
let allData = [];
let filteredData = []; 
let currentSortCol = 0; 
let sortAsc = false; 
let currentPage = 1; 

let fuelHistory = [];
let pricingRules = [];
let zoneMapping = {}; 
let mappedPlacesGlobal = []; 
let customerMapGlobal = {}; 
const SESSION_DURATION = 4 * 60 * 60 * 1000;
const RUNNING_STATUSES = ['จัดรถแล้ว', 'กำลังไปรับตู้', 'ดรอปตู้ (รอบรรจุ)', 'กำลังบรรจุ/เปิดตู้', 'ดรอปตู้ (รอคืน)', 'กำลังไปคืนตู้', 'คืนตู้แล้ว'];

let filterTimeout; 
let backgroundSyncInterval; 

window.onload = function() {
  const storedUser = localStorage.getItem('csName'); 
  const loginTime = localStorage.getItem('loginTimestamp');
  if (storedUser && loginTime && (new Date().getTime() - parseInt(loginTime) < SESSION_DURATION)) {
    currentUser = storedUser; 
    showMainApp();
  } else {
    localStorage.removeItem('csName'); 
    localStorage.removeItem('loginTimestamp');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginSection').style.display = 'flex';
  }
};

async function showMainApp() {
  document.getElementById('displayUser').innerText = currentUser;
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('date').valueAsDate = new Date(); 
  document.getElementById('newFuelDate').valueAsDate = new Date(); 
  
  flatpickr(".datetime-24h", { enableTime: true, time_24hr: true, dateFormat: "Y-m-d H:i", allowInput: true });
  
  let yearSelect = document.getElementById('fuelYearFilter');
  if(yearSelect && yearSelect.options.length === 1) {
      let currentYear = new Date().getFullYear();
      for(let y = currentYear + 1; y >= currentYear - 3; y--) {
          yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
      }
  }

  const modeSelect = document.getElementById('mode');
  if (modeSelect) {
      modeSelect.addEventListener('change', () => {
          document.getElementById('defCyPlace').value = '';
          document.getElementById('loadPlace').value = '';
          document.getElementById('defRtnPlace').value = '';
          handleCustomerSelect();
          updateAllRowPrices();
      });
  }
  
  // 🚀 โหลดข้อมูลแบบรวบยอดครั้งเดียว (เร็วขึ้นมหาศาล)
  showGlobalLoading('กำลังดึงฐานข้อมูลระบบ (ครั้งเดียวจบ)...');
  
  const res = await callAPI('getInitialData');
  if (res && res.success) {
      // 1. จัดการข้อมูล Booking
      let bData = res.bookings;
      if (!Array.isArray(bData) || bData.length <= 1) {
          allData = Array.isArray(bData) ? bData : [];
          renderTable([]);
          updateDashboard([]);
      } else {
          const headerRow = bData[0];
          let dataRows = bData.slice(1);
          dataRows.sort((a, b) => new Date(b[0]) - new Date(a[0]));
          allData = [headerRow, ...dataRows];
          localStorage.setItem('bookingDataCache', JSON.stringify(allData));
          let uniqueCS = [...new Set(allData.slice(1).map(row => row[1]).filter(String))];
          let csOptions = '';
          uniqueCS.forEach(cs => { csOptions += `<option value="${cs}">`; });
          document.getElementById('csDataList').innerHTML = csOptions;
          applyFilters();
      }

      // 2. จัดการข้อมูลลูกค้า
      let cust = res.customerData;
      customerMapGlobal = cust.customerMap || {};
      let shortHtml = '';
      (cust.shortNames || []).forEach(c => { shortHtml += `<option value="${c}">`; });
      let cList = document.getElementById('customerList');
      if (cList) cList.innerHTML = shortHtml;
      
      let fullHtml = '';
      let allNames = [...new Set([...(cust.shortNames||[]), ...(cust.fullNames||[])])].sort();
      allNames.forEach(c => { fullHtml += `<option value="${c}">`; });
      let compList = document.getElementById('companyList');
      if (compList) compList.innerHTML = fullHtml;

      // 3. จัดการตั้งค่า Dropdown
      let set = res.settings;
      let agentHtml = '';
      (set.agentList || []).forEach(item => { agentHtml += `<option value="${item}">`; });
      let aList = document.getElementById('agentDataList');
      if (aList) aList.innerHTML = agentHtml;

      // 4. จัดการราคาน้ำมัน
      let pri = res.pricingData;
      fuelHistory = pri.fuelHistory || [];
      pricingRules = pri.rules || [];
      zoneMapping = pri.zoneMapping || {};
      mappedPlacesGlobal = pri.mappedPlaces || [];

      Swal.close();
      startBackgroundSync(); 
  } else {
      Swal.fire({ icon: 'error', title: 'โหลดข้อมูลล้มเหลว', text: res ? res.message : 'Unknown Error' });
  }
}

async function doLogin() {
  const pwd = document.getElementById('loginPassword').value; 
  const btn = document.getElementById('btnLogin');
  if (!pwd) { Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกรหัสผ่าน' }); return; }
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> CONNECTING...'; 
  btn.disabled = true;

  const res = await callAPI('verifyLogin', { password: pwd });
  if (res.success) { 
    currentUser = res.csName; 
    localStorage.setItem('csName', currentUser); 
    localStorage.setItem('loginTimestamp', new Date().getTime().toString()); 
    await showMainApp(); 
  } else { 
    Swal.fire({ icon: 'error', title: 'Access Denied', text: res.message }); 
  }
  btn.innerHTML = '<span><i class="bi bi-box-arrow-in-right me-2"></i> INITIALIZE</span>'; 
  btn.disabled = false;
}

function logout() { 
    clearInterval(backgroundSyncInterval); 
    localStorage.removeItem('csName'); 
    localStorage.removeItem('loginTimestamp'); 
    localStorage.removeItem('bookingDataCache'); 
    currentUser = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginSection').style.display = 'flex';
}

function showGlobalLoading(title = 'กำลังดำเนินการ...') { 
    Swal.fire({ title: title, allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } }); 
}

function startBackgroundSync() {
    clearInterval(backgroundSyncInterval);
    backgroundSyncInterval = setInterval(async () => {
        if (currentUser && document.getElementById('mainApp').style.display !== 'none') {
            await loadData(true); 
        }
    }, 45000); 
}

async function loadData(silent = false) {
  if (!silent) {
      let cached = localStorage.getItem('bookingDataCache');
      if (cached) {
          allData = JSON.parse(cached);
          applyFilters(); 
      } else {
          document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังดึงข้อมูล...</td></tr>';
      }
  }

  const data = await callAPI('getBookings');
  if (data && data.success === false) {
      if (!silent) {
          document.getElementById('tableBody').innerHTML = `<tr><td colspan="30" class="text-center py-5 text-danger"><i class="bi bi-x-circle fs-1 d-block mb-2"></i> โหลดข้อมูลไม่สำเร็จ: ${data.message}</td></tr>`;
      }
      return;
  }

  if (!Array.isArray(data) || data.length <= 1) {
      allData = Array.isArray(data) ? data : [];
      renderTable([]); 
      updateDashboard([]);
      return;
  }

  const headerRow = data[0];
  let dataRows = data.slice(1);
  
  dataRows.sort((a, b) => {
      let d1 = new Date(a[0]);
      let d2 = new Date(b[0]);
      return d2 - d1;
  });

  let newData = [headerRow, ...dataRows]; 
  
  if (silent) {
      let oldHash = JSON.stringify(allData);
      let newHash = JSON.stringify(newData);
      if (oldHash === newHash) return; 
      
      const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });
      Toast.fire({ icon: 'info', title: '🔄 มีการอัปเดตข้อมูลใหม่จากระบบ' });
  }

  allData = newData;
  localStorage.setItem('bookingDataCache', JSON.stringify(allData)); 
  
  let uniqueCS = [...new Set(allData.slice(1).map(row => row[1]).filter(String))];
  let csOptions = '';
  uniqueCS.forEach(cs => { csOptions += `<option value="${cs}">`; });
  document.getElementById('csDataList').innerHTML = csOptions;
  
  applyFilters(); 
}

async function loadCustomerData() {
  const res = await callAPI('getCustomerData');
  if (res && res.success === false) return;
  
  customerMapGlobal = res.customerMap || {};
  let shortHtml = '';
  (res.shortNames || []).forEach(c => { shortHtml += `<option value="${c}">`; });
  let cList = document.getElementById('customerList');
  if(cList) cList.innerHTML = shortHtml;

  let fullHtml = '';
  let allNames = [...new Set([...(res.shortNames||[]), ...(res.fullNames||[])])].sort();
  allNames.forEach(c => { fullHtml += `<option value="${c}">`; });
  let compList = document.getElementById('companyList');
  if(compList) compList.innerHTML = fullHtml;
}

function mapToFullName(inputElem) {
    let val = inputElem.value.trim();
    if(val && customerMapGlobal[val]) {
        inputElem.value = customerMapGlobal[val];
    }
}

function autoFillBillingNamesAdd() {
    let custShort = document.getElementById('customer').value.trim();
    if(!custShort) return;
    
    let mappedFullName = customerMapGlobal[custShort] || custShort; 
    let billTo = document.getElementById('billTo');
    if (!billTo.value || billTo.value === custShort) billTo.value = mappedFullName;
    let rec = document.getElementById('receiptName');
    if (!rec.value || rec.value === custShort) rec.value = mappedFullName;
}

function autoFillBillingNamesEdit() {
    let custShort = document.getElementById('eCustomer').value.trim();
    if(!custShort) return;
    
    let mappedFullName = customerMapGlobal[custShort] || custShort; 
    let billTo = document.getElementById('eBillTo');
    if (!billTo.value || billTo.value === custShort) billTo.value = mappedFullName;
    let rec = document.getElementById('eReceiptName');
    if (!rec.value || rec.value === custShort) rec.value = mappedFullName;
}

async function loadDropdownSettings() {
  const res = await callAPI('getDropdownSettings');
  if (res && res.success === false) return;
  let agentHtml = '';
  (res.agentList || []).forEach(item => { agentHtml += `<option value="${item}">`; });
  let aList = document.getElementById('agentDataList');
  if(aList) aList.innerHTML = agentHtml;
}

async function loadPricingData() {
  const res = await callAPI('getFuelAndPricing');
  if (res && res.success === false) return;
  fuelHistory = res.fuelHistory || [];
  pricingRules = res.rules || [];
  zoneMapping = res.zoneMapping || {}; 
  mappedPlacesGlobal = res.mappedPlaces || []; 
}

function openPricingMasterModal() {
    document.getElementById('fuelMonthFilter').value = '';
    document.getElementById('fuelYearFilter').value = '';
    document.getElementById('newFuelPrice').value = '';
    renderFuelHistory();
    renderPricingRulesTable();
    new bootstrap.Modal(document.getElementById('pricingMasterModal')).show();
}

function renderFuelHistory() {
    let fMonth = document.getElementById('fuelMonthFilter').value;
    let fYear = document.getElementById('fuelYearFilter').value;
    let tbody = '';
    let filteredFuel = fuelHistory.filter(f => {
        let fd = new Date(f.date);
        let matchMonth = fMonth === '' || fd.getMonth().toString() === fMonth;
        let matchYear = fYear === '' || fd.getFullYear().toString() === fYear;
        return matchMonth && matchYear;
    });

    if (filteredFuel.length === 0) {
        tbody = '<tr><td colspan="3" class="text-center py-4 text-muted">ไม่พบประวัติราคาน้ำมัน</td></tr>';
    } else {
        filteredFuel.forEach(f => {
            let showDate = formatDateHTML(f.date);
            tbody += `<tr>
                <td class="align-middle fw-bold text-secondary">${showDate}</td>
                <td class="align-middle fw-bold text-danger fs-6">฿${f.price.toFixed(2)}</td>
                <td class="align-middle text-center">
                    <div class="d-flex justify-content-center gap-2">
                        <button class="btn btn-sm btn-outline-primary rounded-circle px-2" title="แก้ไข" onclick="editFuelRecord(${f.row}, '${showDate}', ${f.price})"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-circle px-2" title="ลบ" onclick="deleteFuelRecord(${f.row})"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        });
    }
    document.getElementById('fuelHistoryBody').innerHTML = tbody;
}

async function autoUpdatePricesAfterFuelChange() {
    if(!allData || allData.length <= 1) {
        Swal.fire({ icon: 'success', title: 'บันทึกราคาน้ำมันสำเร็จ', timer: 1500, showConfirmButton: false });
        return;
    }
    
    let updates = [];
    for(let i = 1; i < allData.length; i++) {
        let r = allData[i];
        let status = r[15] || '';
        
        if(status === 'รอจัดรถ' || RUNNING_STATUSES.includes(status)) {
            let bDateStr = r[0] || '';
            let type = r[2] || '';
            let currentMode = r[3] || '';
            let customer = r[4] || '';
            let loadPlace = r[5] || '';
            let cyPlace = r[7] || '';
            let rtnPlace = r[10] || '';
            let oldPrice = parseFloat(r[17]) || 0;

            let newPrice = getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, currentMode);
            
            if(newPrice > 0 && newPrice !== oldPrice) {
                updates.push({ row: r[r.length - 1], newPrice: newPrice });
            }
        }
    }

    if(updates.length > 0) {
        Swal.fire({
            title: 'กำลังอัปเดตราคาตู้ย้อนหลัง...',
            text: `พบ ${updates.length} ตู้ที่เข้าเงื่อนไขราคาน้ำมันใหม่`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        const res = await callAPI('updateBatchPrices', { payload: updates, user: currentUser });
        if(res.success) {
            await loadData(true); 
            Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จและอัปเดตราคาตู้เรียบร้อย!', timer: 2000, showConfirmButton: false });
        } else {
            Swal.fire({ icon: 'error', text: res.message });
        }
    } else {
        Swal.fire({ icon: 'success', title: 'บันทึกราคาน้ำมันสำเร็จ', text: 'ไม่มีตู้ค้างที่ต้องปรับราคา', timer: 1500, showConfirmButton: false });
    }
}

async function saveFuelLog() {
  let dateStr = document.getElementById('newFuelDate').value;
  let priceVal = document.getElementById('newFuelPrice').value;
  if(!dateStr || !priceVal) { Swal.fire({ icon: 'warning', text: 'กรุณาระบุวันที่และราคาน้ำมันให้ถูกต้อง' }); return; }
  
  showGlobalLoading('กำลังบันทึกราคาน้ำมัน...');
  const res = await callAPI('addFuelPrice', { dateStr: dateStr, priceVal: priceVal, user: currentUser });
  if(res.success) {
      document.getElementById('newFuelPrice').value = '';
      await loadPricingData();
      renderFuelHistory();
      await autoUpdatePricesAfterFuelChange(); 
  } else { 
      Swal.fire({ icon: 'error', text: res.message }); 
  }
}

function editFuelRecord(row, oldDate, oldPrice) {
    Swal.fire({
        title: 'แก้ไขราคาน้ำมัน',
        html: `<div class="text-start">
                  <label class="small fw-bold">วันที่มีผล</label>
                  <input type="date" id="editFDate" class="form-control mb-2" value="${oldDate}">
                  <label class="small fw-bold">ราคา (บาท)</label>
                  <input type="number" id="editFPrice" class="form-control" step="0.01" value="${oldPrice}">
               </div>`,
        showCancelButton: true, confirmButtonText: 'บันทึกแก้ไข', cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            let d = document.getElementById('editFDate').value; let p = document.getElementById('editFPrice').value;
            if(!d || !p) { Swal.showValidationMessage('กรุณากรอกข้อมูลให้ครบ!'); return false; }
            return { date: d, price: p };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            showGlobalLoading('กำลังบันทึกการแก้ไข...');
            const res = await callAPI('updateFuelPriceRecord', { row: row, dateStr: result.value.date, priceVal: result.value.price, user: currentUser });
            if(res.success) {
                await loadPricingData();
                renderFuelHistory(); 
                await autoUpdatePricesAfterFuelChange(); 
            } else { 
                Swal.fire({ icon: 'error', text: res.message }); 
            }
        }
    });
}

function deleteFuelRecord(row) {
    Swal.fire({ title: 'ลบราคาน้ำมัน?', text: 'รายการนี้จะถูกลบออกจากระบบถาวร', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ใช่, ลบเลย'
    }).then(async (result) => {
        if(result.isConfirmed) {
            showGlobalLoading('กำลังลบข้อมูล...');
            const res = await callAPI('deleteFuelPriceRecord', { row: row, user: currentUser });
            if(res.success) {
                await loadPricingData();
                renderFuelHistory(); 
                await autoUpdatePricesAfterFuelChange(); 
            } else { 
                Swal.fire({ icon: 'error', text: res.message }); 
            }
        }
    });
}

function debouncedFilterPricingTable() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => { renderPricingRulesTable(); }, 400);
}

function renderPricingRulesTable() {
    let filterText = (document.getElementById('searchRule') ? document.getElementById('searchRule').value.toLowerCase() : '');
    let tbody = '';
    let filteredRules = pricingRules.filter(r => r.customer.toLowerCase().includes(filterText) || r.cyPlace.toLowerCase().includes(filterText) || r.loadPlace.toLowerCase().includes(filterText));
    if (filteredRules.length === 0) {
        tbody = '<tr><td colspan="8" class="text-center py-4 text-muted">ไม่พบข้อมูลในระบบ หรือเกิดข้อผิดพลาดในการโหลด</td></tr>';
    } else {
        filteredRules.forEach(r => {
            tbody += `<tr>
                <td class="fw-bold text-primary">${r.customer || '-'}</td>
                <td>${r.type || 'ทุกแบบ'}</td>
                <td>${r.cyPlace || 'ทุกที่'}</td>
                <td>${r.loadPlace || 'ทุกที่'}</td>
                <td>${r.rtnPlace || 'ทุกที่'}</td>
                <td><span class="badge bg-info text-dark">${r.fuelRule || 'ล่าสุด'}</span></td>
                <td>${r.rangeLabel}</td>
                <td class="fw-bold text-success">฿${r.price.toLocaleString()}</td>
            </tr>`;
        });
    }
    document.getElementById('pricingRulesBody').innerHTML = tbody;
}

function addNewSetting(type) {
  Swal.fire({
      title: `เพิ่ม ${type} ใหม่`, input: 'text', inputPlaceholder: `พิมพ์ชื่อ ${type} ที่ต้องการเพิ่ม...`,
      showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
      inputValidator: (value) => { if (!value) return 'กรุณากรอกข้อมูล!'; }
  }).then(async (result) => {
      if (result.isConfirmed) {
          showGlobalLoading(`กำลังเพิ่ม ${type}...`);
          const res = await callAPI('addSetting', { type: type, value: result.value.trim() });
          if (res.success) { 
              await loadDropdownSettings(); 
              Swal.fire({ icon: 'success', title: 'เพิ่มสำเร็จ', timer: 1500, showConfirmButton: false }); 
          } 
          else { Swal.fire({ icon: 'error', text: res.message }); }
      }
  });
}

async function openLogModal() {
  new bootstrap.Modal(document.getElementById('logModal')).show();
  document.getElementById('logTableBody').innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border spinner-border-sm text-info"></div> กำลังโหลดประวัติ...</td></tr>';
  const logs = await callAPI('getLogs');
  if (logs && logs.success === false) { 
      document.getElementById('logTableBody').innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${logs.message}</td></tr>`; return; 
  }
  if (!Array.isArray(logs) || logs.length <= 1) { document.getElementById('logTableBody').innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">ยังไม่มีประวัติการทำงาน</td></tr>'; return; }
  
  let html = '';
  logs.forEach(row => {
      if (row[0] === 'วันที่เวลา' || row[0] === 'Timestamp' || row[0] === '') return;
      let dateFormatted = formatDateHTML(row[0]) + " " + (new Date(row[0]).toLocaleTimeString('th-TH'));
      if (dateFormatted.includes('Invalid')) dateFormatted = row[0]; 
      html += `<tr><td class="text-muted small">${dateFormatted}</td><td class="fw-bold text-primary">${row[1] || '-'}</td><td><span class="badge bg-info text-dark">${row[2] || '-'}</span></td><td class="small text-wrap">${row[3] || '-'}</td></tr>`;
  });
  document.getElementById('logTableBody').innerHTML = html;
}

function updateDashboard(dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length <= 1) {
      document.getElementById('sumTotal').innerText = 0; 
      document.getElementById('sumPending').innerText = 0; 
      document.getElementById('sumDone').innerText = 0; 
      document.getElementById('sumFinished').innerText = 0; 
      return;
  }
  let total = dataArray.length - 1; 
  let pendingCount = 0;
  let doneCount = 0;
  let finishedCount = 0;

  for (let i = 1; i < dataArray.length; i++) { 
      let status = dataArray[i][15];
      if (status === 'รอจัดรถ') pendingCount++;
      else if (RUNNING_STATUSES.includes(status)) doneCount++;
      else if (status === 'จบงานรอวางบิล' || status === 'พร้อมวางบิล' || status === 'วางบิลแล้ว') finishedCount++;
  }
  document.getElementById('sumTotal').innerText = total; 
  document.getElementById('sumPending').innerText = pendingCount;
  document.getElementById('sumDone').innerText = doneCount; 
  document.getElementById('sumFinished').innerText = finishedCount;
}

function sortTable(colIndex) {
  if (!Array.isArray(filteredData) || filteredData.length <= 1) return;
  const headerRow = filteredData[0];
  let dataRows = filteredData.slice(1);
  if (currentSortCol === colIndex) { sortAsc = !sortAsc; } else { currentSortCol = colIndex; sortAsc = true; }
  
  document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังจัดเรียงข้อมูล...</td></tr>';
  
  setTimeout(() => {
      dataRows.sort((a, b) => {
        let valA = a[colIndex] ? a[colIndex].toString().toLowerCase() : '';
        let valB = b[colIndex] ? b[colIndex].toString().toLowerCase() : '';
        if (!isNaN(Date.parse(valA)) && !isNaN(Date.parse(valB))) { valA = new Date(valA); valB = new Date(valB); } 
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
      filteredData = [headerRow, ...dataRows];
      currentPage = 1;
      renderTable(filteredData); 
  }, 50);
}

function changePage(step) {
  let pageSizeVal = document.getElementById('pageSize').value;
  if (pageSizeVal === 'all') return;
  
  document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังโหลดข้อมูล...</td></tr>';
  
  setTimeout(() => {
      let limit = parseInt(pageSizeVal);
      let totalRows = filteredData.length - 1;
      let totalPages = Math.ceil(totalRows / limit) || 1;
      currentPage += step;
      if (currentPage < 1) currentPage = 1;
      if (currentPage > totalPages) currentPage = totalPages;
      renderTable(filteredData);
  }, 10);
}

function renderTable(dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length <= 1) {
      document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-1 d-block mb-2"></i> ไม่มีข้อมูลในระบบ</td></tr>';
      document.getElementById('tableHead').innerHTML = '';
      document.getElementById('paginationControls').style.setProperty('display', 'none', 'important');
      return;
  }
  
  let displayCols = [0, 1, 2, 3, 4, 6, 23, 16, 15, 5, 7, 10, 9, 12, 14, 17];
  
  let thead = '<tr>'; 
  for (let colIdx of displayCols) { 
      let icon = '';
      let headerText = dataArray[0][colIdx] ? dataArray[0][colIdx].toString() : '';
      let thClass = headerText.includes('ราคา') || headerText.includes('ค่า') || headerText.includes('ยอด') ? 'sticky-col-right' : ''; 
      if (currentSortCol === colIdx) icon = sortAsc ? '<i class="bi bi-caret-up-fill sort-icon"></i>' : '<i class="bi bi-caret-down-fill sort-icon"></i>';
      else icon = '<i class="bi bi-arrow-down-up sort-icon"></i>';
      thead += `<th class="${thClass}" onclick="sortTable(${colIdx})" title="คลิกเพื่อเรียงข้อมูล">${headerText} ${icon}</th>`; 
  }
  thead += '</tr>'; 
  document.getElementById('tableHead').innerHTML = thead;

  let pageSizeVal = document.getElementById('pageSize').value;
  let totalRows = dataArray.length - 1;
  let limit = pageSizeVal === 'all' ? totalRows : parseInt(pageSizeVal);
  let totalPages = Math.ceil(totalRows / limit) || 1;
  
  if (currentPage > totalPages) currentPage = totalPages;
  let startIdx = 1 + ((currentPage - 1) * limit);
  let endIdx = Math.min(startIdx + limit, dataArray.length);

  let tbody = '';
  for (let i = startIdx; i < endIdx; i++) {
    let row = dataArray[i]; 
    let rowNum = row[row.length - 1]; 
    let status = row[15] || '';
    
    let rowClass = '';
    if (RUNNING_STATUSES.includes(status)) rowClass = 'row-assigned';
    else if (status === 'จบงานรอวางบิล' || status === 'พร้อมวางบิล') rowClass = 'row-finished';
    else if (status === 'วางบิลแล้ว') rowClass = 'row-billed';
    
    tbody += `<tr class="${rowClass} table-row-animate" onclick="openEditModal(${rowNum})">`;
    for (let colIdx of displayCols) { 
      let cellText = row[colIdx] || ''; 
      let headerText = dataArray[0][colIdx] ? dataArray[0][colIdx].toString() : '';

      if (colIdx === 3) { 
          let modeColor = cellText.includes('Export') ? 'bg-primary' : (cellText.includes('Import') ? 'bg-info' : 'bg-secondary');
          tbody += `<td><span class="badge ${modeColor}">${cellText}</span></td>`;
      } 
      else if (colIdx === 14 && cellText) { 
          tbody += `<td class="text-danger fw-bold"><i class="bi bi-chat-dots"></i> ${cellText}</td>`;
      } 
      else if (colIdx === 15) { 
          let badgeClass = 'bg-warning text-dark'; let icon = '<i class="bi bi-clock"></i> '; let styleStr = '';
          
          if (status === 'รอจัดรถ') { badgeClass = 'bg-warning text-dark'; icon = '<i class="bi bi-clock"></i> '; }
          else if (status === 'กำลังไปรับตู้' || status === 'กำลังไปคืนตู้' || status === 'จัดรถแล้ว') { badgeClass = 'bg-info text-dark'; icon = '<i class="bi bi-truck"></i> '; }
          else if (status.includes('ดรอปตู้')) { badgeClass = 'bg-danger text-white'; icon = '<i class="bi bi-geo-alt-fill"></i> '; styleStr = 'style="background-color: #f97316 !important;"'; } 
          else if (status === 'กำลังบรรจุ/เปิดตู้') { badgeClass = 'bg-primary'; icon = '<i class="bi bi-box-seam"></i> '; }
          else if (status === 'คืนตู้แล้ว') { badgeClass = 'bg-success'; icon = '<i class="bi bi-check-circle-fill"></i> '; }
          else if (status === 'จบงานรอวางบิล') { badgeClass = 'bg-purple'; icon = '<i class="bi bi-check2-all"></i> '; styleStr = 'style="background-color: #8b5cf6; color: white;"'; }
          else if (status === 'พร้อมวางบิล') { badgeClass = 'bg-primary'; icon = '<i class="bi bi-clipboard-check"></i> '; }
          else if (status === 'วางบิลแล้ว') { badgeClass = 'bg-secondary'; icon = '<i class="bi bi-receipt"></i> '; }
          
          tbody += `<td><span class="badge ${badgeClass} rounded-pill px-2 py-1 shadow-sm" ${styleStr}>${icon}${cellText || 'รอจัดรถ'}</span></td>`;
      } 
      else if (colIdx === 23 && cellText) { 
          tbody += `<td class="fw-bold text-primary">${cellText}</td>`;
      }
      else if (colIdx === 16 && cellText) { 
          tbody += `<td class="fw-bold text-success">${cellText}</td>`;
      }
      else if (headerText.includes('ราคา') || headerText.includes('ค่า') || headerText.includes('ยอด')) { 
          let priceNum = parseFloat(cellText) || 0;
          let alignClass = headerText.includes('ราคา') ? 'sticky-col-right text-danger' : 'text-secondary';
          if(priceNum === 0) tbody += `<td class="text-end ${alignClass}">-</td>`;
          else tbody += `<td class="text-end fw-bold ${alignClass}">${priceNum.toLocaleString()}</td>`;
      } 
      else if (colIdx === 0 || colIdx === 8 || colIdx === 11) { 
          tbody += `<td>${formatDateHTML(cellText)}</td>`;
      } 
      else {
          tbody += `<td>${cellText}</td>`; 
      }
    }
    tbody += '</tr>';
  }
  document.getElementById('tableBody').innerHTML = tbody;

  let pagCtrl = document.getElementById('paginationControls');
  if (pageSizeVal === 'all' || totalRows <= limit) { pagCtrl.style.setProperty('display', 'none', 'important'); } 
  else { pagCtrl.style.setProperty('display', 'flex', 'important'); document.getElementById('pageInfo').innerText = `แสดงหน้า ${currentPage} จาก ${totalPages} (รวม ${totalRows} รายการ)`; }
}

function exportToExcel() {
  const table = document.getElementById("dataTable"); 
  if (!table) return;
  const wb = XLSX.utils.table_to_book(table, {sheet: "Booking Data"});
  let today = new Date(); 
  let dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, `Booking_Data_${dateStr}.xlsx`);
}

function openBatchTruckModal() {
  document.getElementById('batchDateFilter').value = ''; 
  let pendingCS = [...new Set(allData.slice(1).filter(r => r[15] === 'รอจัดรถ').map(r => r[1]).filter(String))];
  let csOptions = '<option value="">- ทุก CS -</option>';
  pendingCS.forEach(cs => { csOptions += `<option value="${cs}">${cs}</option>`; });
  let csFilterElem = document.getElementById('batchCsFilter');
  csFilterElem.innerHTML = csOptions;
  csFilterElem.value = ''; 
  renderBatchTruckTable(); 
  new bootstrap.Modal(document.getElementById('batchTruckModal')).show();
}

function renderBatchTruckTable() {
  let filterDate = document.getElementById('batchDateFilter').value;
  let filterCS = document.getElementById('batchCsFilter').value.toLowerCase();
  let unassignedRows = [];
  for (let i = 1; i < allData.length; i++) { 
      if (allData[i][15] === 'รอจัดรถ') {
          let matchDate = true; let matchCS = true;
          if (filterDate) { let rowDate = formatDateHTML(allData[i][0]); if (rowDate !== filterDate) matchDate = false; }
          if (filterCS) { let rowCS = (allData[i][1] || '').toString().toLowerCase(); if (rowCS !== filterCS) matchCS = false; }
          if (matchDate && matchCS) { unassignedRows.push(allData[i]); }
      } 
  }
  document.getElementById('batchCount').innerText = unassignedRows.length;
  let html = '';
  if (unassignedRows.length === 0) {
      html = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่พบตู้ที่รอจัดรถ</td></tr>`;
  } else {
      unassignedRows.forEach(r => {
        let currentPlate = r[16] || '';
        let currentContainer = r[23] || ''; 
        let showDate = formatDateHTML(r[0]); 
        html += `
          <tr class="batch-truck-row" data-row="${r[r.length - 1]}">
            <td class="align-middle fw-bold text-secondary">${showDate}</td>
            <td class="align-middle"><span class="fw-bold text-primary">${r[6]}</span><br><span class="badge bg-info text-dark shadow-sm mb-1"><i class="bi bi-person-badge"></i> CS: ${r[1]}</span></td>
            <td class="text-center align-middle"><span class="badge bg-${r[2] === "20'" ? 'info' : 'warning'} text-dark shadow-sm">${r[2]}</span></td>
            <td class="align-middle"><small class="text-muted d-block"><b>รับ:</b> ${r[7]}</small><small class="text-muted d-block"><b>คืน:</b> ${r[10]}</small></td>
            <td class="text-center align-middle"><div class="form-check form-switch d-flex justify-content-center fs-5"><input class="form-check-input bStatus border-success" type="checkbox" style="cursor:pointer;"></div></td>
            <td class="align-middle"><input type="text" class="form-control form-control-sm border-success bPlate" value="${currentPlate}" placeholder="ระบุทะเบียน..." oninput="this.closest('tr').querySelector('.bStatus').checked = this.value.trim().length > 0;"></td>
            <td class="align-middle"><input type="text" class="form-control form-control-sm border-info bContainer" value="${currentContainer}" placeholder="ระบุเบอร์ตู้..."></td>
          </tr>`;
      });
  }
  document.getElementById('batchTruckBody').innerHTML = html;
}

async function saveBatchTruckMulti() {
  const rows = document.querySelectorAll('.batch-truck-row'); 
  if (rows.length === 0) return;
  let payload = [];
  let hasError = false;

  rows.forEach(r => {
    let checkbox = r.querySelector('.bStatus');
    if (checkbox && checkbox.checked) { 
      let plate = r.querySelector('.bPlate').value.trim();
      let container = r.querySelector('.bContainer').value.trim();
      
      if(!plate || !container) hasError = true;
      payload.push({ row: parseInt(r.getAttribute('data-row')), status: 'กำลังไปรับตู้', plate: plate, containerNo: container }); 
    }
  });

  if (payload.length === 0) { Swal.fire({ icon: 'warning', text: 'คุณยังไม่ได้เปิดสวิตช์จัดรถ' }); return; }
  if (hasError) { Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ!', text: 'กรุณาระบุ ทะเบียนรถ และ เบอร์ตู้ ให้ครบถ้วนสำหรับงานที่ต้องการจัดรถ' }); return; }

  showGlobalLoading('กำลังบันทึก...');
  const res = await callAPI('updateBatchTruckMulti', { truckDataArray: payload, user: currentUser });
  if (res.success) { 
      bootstrap.Modal.getInstance(document.getElementById('batchTruckModal')).hide(); 
      await loadData(true); 
      Swal.fire({ icon: 'success', title: 'สำเร็จ!', timer: 1500, showConfirmButton: false }); 
  } 
  else { Swal.fire({ icon: 'error', text: res.message }); }
}

function debouncedApplyFilters() {
    clearTimeout(filterTimeout);
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังประมวลผลข้อมูล...</td></tr>';
    filterTimeout = setTimeout(() => { applyFilters(); }, 400);
}

function applyFilters() {
  if (!Array.isArray(allData) || allData.length <= 1) {
      renderTable([]);
      updateDashboard([]);
      return;
  }

  const getVal = (id) => { let el = document.getElementById(id); return el ? el.value.toLowerCase() : ''; };
  const getValExact = (id) => { let el = document.getElementById(id); return el ? el.value : ''; };

  const sText = getVal('filterText');
  const fCS = getVal('filterCS');
  const fAgent = getVal('filterAgent'); 
  const fMode = getVal('filterMode');
  const fStatus = getValExact('filterStatus');
  const fYear = getValExact('filterYear');
  const fMonth = getValExact('filterMonth');
  const fDay = getValExact('filterDay');
  
  filteredData = allData.filter((row, index) => {
    if (index === 0) return true; 
    const matchText = row.join(' ').toLowerCase().includes(sText);
    const matchCS = fCS === '' || (row[1] && row[1].toString().toLowerCase().includes(fCS));
    const matchAgent = fAgent === '' || (row[13] && row[13].toString().toLowerCase().includes(fAgent));
    const matchMode = fMode === '' || (row[3] && row[3].toString().toLowerCase() === fMode);
    const matchStatus = fStatus === '' || (row[15] && row[15] === fStatus);
    let matchDate = true;
    if (fYear || fMonth || fDay) {
      let d = new Date(row[0]);
      if (!isNaN(d.getTime())) {
          if (fYear && fYear !== d.getFullYear().toString()) matchDate = false;
          if (fMonth && fMonth !== (d.getMonth() + 1).toString().padStart(2, '0')) matchDate = false;
          if (fDay && fDay !== d.getDate().toString().padStart(2, '0')) matchDate = false;
      } else { matchDate = false; }
    }
    return matchText && matchDate && matchCS && matchAgent && matchMode && matchStatus;
  });
  currentPage = 1; 
  renderTable(filteredData);
  updateDashboard(filteredData); 
}

function clearFilters() { 
    const resetVal = (id) => { let el = document.getElementById(id); if(el) el.value = ''; };
    resetVal('filterText'); resetVal('filterCS'); resetVal('filterAgent');
    resetVal('filterMode'); resetVal('filterStatus'); resetVal('filterYear'); 
    resetVal('filterMonth'); resetVal('filterDay'); 
    filteredData = [...allData]; currentPage = 1; renderTable(filteredData); updateDashboard(filteredData); 
}

function clearForm() { 
    let fields = ['booking', 'closing', 'defCyPlace', 'defCyDate', 'defRtnPlace', 'defRtnDate', 'customer', 'billTo', 'receiptName', 'loadPlace', 'vgm', 'manualPrice20', 'manualPrice40'];
    fields.forEach(id => { document.getElementById(id).value = ''; }); 
    let csInput = document.getElementById('cs'); if(csInput) csInput.value = currentUser; 
    let agentInput = document.getElementById('agent'); if(agentInput) agentInput.value = '';
    document.getElementById('qty20').value = 0; document.getElementById('qty40').value = 0; 
    document.getElementById('container-rows').innerHTML = '<div class="alert alert-secondary text-center border-0 border-start border-4 border-secondary shadow-sm"><i class="bi bi-info-circle"></i> กรุณากรอกข้อมูลด้านบน และกดปุ่ม "สร้างรายการตู้"</div>'; 
}

function getMappedZone(placeName) {
    if(!placeName) return '';
    let p = placeName.trim().toLowerCase();
    return zoneMapping[p] || p; 
}

function isModeMatch(sheetName, modeVal) {
    let s = (sheetName || '').toLowerCase();
    let m = (modeVal || '').toLowerCase();
    
    if (s.includes('รวม') || s.includes('all') || s.includes('both')) return true;
    let isSheetImport = s.includes('นำเข้า') || s.includes('import');
    let isSheetExport = s.includes('ส่งออก') || s.includes('export');
    
    if (!isSheetImport && !isSheetExport) return true;
    if (m.includes('import') || m.includes('นำเข้า')) {
        if (isSheetExport && !isSheetImport) return false;
    } 
    else if (m.includes('export') || m.includes('ส่งออก')) {
        if (isSheetImport && !isSheetExport) return false;
    }
    return true; 
}

function handleCustomerSelect() {
    const customerInput = document.getElementById('customer').value.trim().toLowerCase();
    const modeInput = document.getElementById('mode').value; 
    if (!customerInput) return;

    const matchedRules = pricingRules.filter(r => {
        let ruleCustShort = (r.customer || '').trim();
        let ruleCustFull = (customerMapGlobal[ruleCustShort] || ruleCustShort).trim();
        let isCust = (ruleCustShort.toLowerCase() === customerInput || ruleCustFull.toLowerCase() === customerInput || ruleCustShort === '');
        let isMode = isModeMatch(r.sheetName, modeInput);
        return isCust && isMode; 
    });

    if (matchedRules.length > 0) {
        let ruleLoads = matchedRules.map(r => r.loadPlace).filter(String);
        let ruleCys = matchedRules.map(r => r.cyPlace).filter(String);
        let ruleRtns = matchedRules.map(r => r.rtnPlace).filter(String);

        let loads = [...new Set(ruleLoads)]; 
        let cys = [...new Set([...ruleCys, ...mappedPlacesGlobal])]; 
        let rtns = [...new Set([...ruleRtns, ...mappedPlacesGlobal])];

        let loadDatalist = document.getElementById('loadPlaceList');
        if(loadDatalist) loadDatalist.innerHTML = loads.map(v => `<option value="${v}">`).join('');
        
        let cyDatalist = document.getElementById('cyPlaceList');
        if(cyDatalist) cyDatalist.innerHTML = cys.map(v => `<option value="${v}">`).join('');
        
        let rtnDatalist = document.getElementById('rtnPlaceList');
        if(rtnDatalist) rtnDatalist.innerHTML = rtns.map(v => `<option value="${v}">`).join('');

        const loadEl = document.getElementById('loadPlace');
        const cyEl = document.getElementById('defCyPlace');
        const rtnEl = document.getElementById('defRtnPlace');

        if (ruleLoads.length === 1 && loadEl && !loadEl.value) loadEl.value = ruleLoads[0];
        if (ruleCys.length === 1 && cyEl && !cyEl.value) cyEl.value = ruleCys[0];
        if (ruleRtns.length === 1 && rtnEl && !rtnEl.value) rtnEl.value = ruleRtns[0];
    }
}

function getActiveFuel(ruleStr, bDateStr) {
    if(!fuelHistory || fuelHistory.length === 0) return 0; 
    let bDate = bDateStr ? new Date(bDateStr) : new Date();
    if(isNaN(bDate.getTime())) bDate = new Date();
    bDate.setHours(0,0,0,0);
    let targetDate = new Date(bDate);
    let r = (ruleStr || '').toString().toLowerCase();

    const getPriceOnDay = (dateToCheck) => {
        let latestPrice = fuelHistory[fuelHistory.length - 1].price; 
        for (let f of fuelHistory) {
            let fDate = new Date(f.date); fDate.setHours(0,0,0,0);
            if (fDate <= dateToCheck) {
                latestPrice = f.price;
                break; 
            }
        }
        return latestPrice;
    };

    if (r === '1') { targetDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1); } 
    else if (r === '15') {
        if (bDate.getDate() >= 15) { targetDate = new Date(bDate.getFullYear(), bDate.getMonth(), 15); } 
        else { targetDate = new Date(bDate.getFullYear(), bDate.getMonth() - 1, 15); }
    } 
    else if (r.includes('half') || r.includes('ครึ่ง')) {
        let startDate;
        if (bDate.getDate() <= 15) { startDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1); } 
        else { startDate = new Date(bDate.getFullYear(), bDate.getMonth(), 16); }
        
        let sum = 0; let count = 0;
        for (let d = new Date(startDate); d <= bDate; d.setDate(d.getDate() + 1)) { sum += getPriceOnDay(d); count++; }
        if(count > 0) return sum / count;
    }
    else if (r.includes('average') || r.includes('เฉลี่ย')) {
        let startDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1);
        let sum = 0; let count = 0;
        for (let d = new Date(startDate); d <= bDate; d.setDate(d.getDate() + 1)) { sum += getPriceOnDay(d); count++; }
        if(count > 0) return sum / count;
    }
    return getPriceOnDay(targetDate); 
}

function getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, currentMode) {
    let matchedPrice = 0;
    let safeType = type.toLowerCase().replace(/'/g, ''); 
    let mappedCy = getMappedZone(cyPlace);
    let mappedLoad = getMappedZone(loadPlace);
    let mappedRtn = getMappedZone(rtnPlace);
    let inputCustomer = customer.toLowerCase().trim();

    for(let r of pricingRules) {
        if (!isModeMatch(r.sheetName, currentMode)) continue;
        let rTypeSafe = (r.type || '').toLowerCase().replace(/'/g, ''); 
        let ruleCustShort = (r.customer || '').trim();
        let ruleCustFull = (customerMapGlobal[ruleCustShort] || ruleCustShort).trim();
        let isCustomerMatch = (ruleCustShort.toLowerCase() === inputCustomer || ruleCustFull.toLowerCase() === inputCustomer || ruleCustShort === '');
        let isTypeMatch = (rTypeSafe === safeType || rTypeSafe === '');
        let ruleCy = (r.cyPlace || '').toLowerCase();
        let ruleLoad = (r.loadPlace || '').toLowerCase();
        let ruleRtn = (r.rtnPlace || '').toLowerCase();

        let isCyMatch = (ruleCy === '' || mappedCy.includes(ruleCy) || cyPlace.toLowerCase().includes(ruleCy));
        let isLoadMatch = (ruleLoad === '' || mappedLoad.includes(ruleLoad) || loadPlace.toLowerCase().includes(ruleLoad));
        let isRtnMatch = (ruleRtn === '' || mappedRtn.includes(ruleRtn) || rtnPlace.toLowerCase().includes(ruleRtn));

        if(isCustomerMatch && isTypeMatch && isCyMatch && isLoadMatch && isRtnMatch) {
            let activeFuel = getActiveFuel(r.fuelRule, bDateStr);
            if(activeFuel >= r.fuelMin && activeFuel <= r.fuelMax) { 
                matchedPrice = r.price; 
                break; 
            }
        }
    }
    return matchedPrice;
}

function updateAllRowPrices() {
    const customer = document.getElementById('customer').value.trim();
    const loadPlace = document.getElementById('loadPlace').value.trim();
    const bDateStr = document.getElementById('date').value;
    const modeVal = document.getElementById('mode').value; 
    
    const rows = document.querySelectorAll('.container-row');
    rows.forEach(r => {
        const type = r.querySelector('.cType').value.trim();
        const cyPlace = r.querySelector('.cyPlace').value.trim();
        const rtnPlace = r.querySelector('.rtnPlace').value.trim();
        const price = getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, modeVal);
        if(price > 0) r.querySelector('.cPrice').value = price;
    });
}

function updateRowPrice(elem) {
    const row = elem.closest('.container-row');
    const customer = document.getElementById('customer').value.trim();
    const loadPlace = document.getElementById('loadPlace').value.trim();
    const bDateStr = document.getElementById('date').value;
    const modeVal = document.getElementById('mode').value; 

    const type = row.querySelector('.cType').value.trim();
    const cyPlace = row.querySelector('.cyPlace').value.trim();
    const rtnPlace = row.querySelector('.rtnPlace').value.trim();
    const price = getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, modeVal);
    if(price > 0) row.querySelector('.cPrice').value = price;
}

function autoCalcEditPrice() {
    const customer = document.getElementById('eCustomer').value.trim();
    const type = document.getElementById('eType').value.trim();
    const cyPlace = document.getElementById('eCyP').value.trim();
    const loadPlace = document.getElementById('eLoad').value.trim();
    const rtnPlace = document.getElementById('eRtnP').value.trim();
    const bDateStr = document.getElementById('eDate').value;
    const modeVal = document.getElementById('eMode').value; 

    const price = getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, modeVal);
    if(price > 0) document.getElementById('ePrice').value = price;
}

async function updatePriceEntireBooking() {
    let bkgNo = document.getElementById('eBooking').value.trim();
    if(!bkgNo) return;

    let bDateStr = document.getElementById('eDate').value;
    let customer = document.getElementById('eCustomer').value.trim();
    let modeVal = document.getElementById('eMode').value;
    let loadPlace = document.getElementById('eLoad').value.trim();
    let updates = [];
    
    for (let i = 1; i < allData.length; i++) {
        let r = allData[i];
        let currentBkg = r[6] != null ? r[6].toString().trim() : "";
        let status = r[15] || '';
        
        if (currentBkg === bkgNo && (status === 'รอจัดรถ' || RUNNING_STATUSES.includes(status))) {
            let type = r[2] || '';
            let cyPlace = r[7] || '';
            let rtnPlace = r[10] || '';
            let newPrice = getMatchedPrice(customer, type, cyPlace, loadPlace, rtnPlace, bDateStr, modeVal);
            let rowNum = r[r.length - 1]; 
            
            if(newPrice > 0) { updates.push({ row: rowNum, newPrice: newPrice }); }
        }
    }

    if(updates.length > 0) {
        Swal.fire({
            title: 'อัปเดตราคาทั้ง Booking?',
            html: `ระบบจะคำนวณและปรับราคาใหม่ให้กับตู้ <b>${updates.length} ใบ</b><br>ใน Booking: <b class="text-primary">${bkgNo}</b>`,
            icon: 'question',
            showCancelButton: true, confirmButtonColor: '#10b981', confirmButtonText: 'ใช่, อัปเดตเลย', cancelButtonText: 'ยกเลิก'
        }).then(async res => {
            if(res.isConfirmed) {
                showGlobalLoading('กำลังอัปเดตราคาทั้ง Booking...');
                const resApi = await callAPI('updateBatchPrices', { payload: updates, user: currentUser });
                if(resApi.success) {
                    autoCalcEditPrice(); 
                    await loadData(true); 
                    Swal.fire({ icon: 'success', title: 'อัปเดตราคาสำเร็จ!', timer: 1500, showConfirmButton: false });
                } else { Swal.fire('Error', resApi.message, 'error'); }
            }
        });
    } else {
        Swal.fire('แจ้งเตือน', 'ไม่พบตู้ที่สามารถอัปเดตราคาได้ (อาจจบงานหรือวางบิลไปหมดแล้ว)', 'info');
    }
}

function generateRows() {
  const q20 = parseInt(document.getElementById('qty20').value) || 0; 
  const q40 = parseInt(document.getElementById('qty40').value) || 0;
  const mPrice20 = parseFloat(document.getElementById('manualPrice20').value) || 0;
  const mPrice40 = parseFloat(document.getElementById('manualPrice40').value) || 0;

  if ((q20 + q40) === 0) { Swal.fire({ icon: 'warning', text: "ระบุจำนวนตู้อย่างน้อย 1 ใบ" }); return; }
  
  const customer = document.getElementById('customer').value.trim();
  const loadPlace = document.getElementById('loadPlace').value.trim();
  const defCyPlace = document.getElementById('defCyPlace').value.trim();
  const defRtnPlace = document.getElementById('defRtnPlace').value.trim();
  const bDateStr = document.getElementById('date').value;
  const modeVal = document.getElementById('mode').value; 

  let html = ''; let count = 1;
  
  const createRow = (idx, type, col, mPrice) => {
    let rowPrice = mPrice > 0 ? mPrice : getMatchedPrice(customer, type, defCyPlace, loadPlace, defRtnPlace, bDateStr, modeVal);
    
    return `
    <div class="card mb-3 border-${col} shadow-sm container-row fade-in">
        <div class="card-header d-flex justify-content-between align-items-center py-2" style="background-color: #f8fafc;">
            <div class="fw-bold text-primary mb-0"><i class="bi bi-box-seam"></i> ตู้ใบที่ ${idx}</div>
            <div><input type="text" class="form-control form-control-sm cType text-center fw-bold text-${col} border-${col} py-0" value="${type}" readonly style="width: 80px; background-color: #fff;"></div>
        </div>
        <div class="card-body p-3 compact-form">
            <div class="row g-2 align-items-end mb-2">
                <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-1">CY Place</label><input type="text" list="cyPlaceList" class="form-control form-control-sm cyPlace" value="${defCyPlace}" onchange="updateRowPrice(this)"></div>
                <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-1">CY Date</label><input type="date" class="form-control form-control-sm cyDate" value="${document.getElementById('defCyDate').value}"></div>
                <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-1">RTN Place</label><input type="text" list="rtnPlaceList" class="form-control form-control-sm rtnPlace" value="${defRtnPlace}" onchange="updateRowPrice(this)"></div>
                <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-1">RTN Date</label><input type="date" class="form-control form-control-sm rtnDate" value="${document.getElementById('defRtnDate').value}"></div>
            </div>
            
            <div class="row g-2 align-items-center pt-2 border-top mt-2">
                <div class="col-6 col-md-2"><label class="fw-bold text-danger small mb-1">ราคา/ตู้</label><input type="number" class="form-control form-control-sm border-danger fw-bold text-success cPrice" value="${rowPrice}"></div>
                <div class="col-6 col-md-3"><label class="fw-bold text-primary small mb-1">เบอร์ตู้ (Container No.)</label><input type="text" class="form-control form-control-sm border-primary cContainerNo" placeholder="ระบุเบอร์ตู้..."></div>
                <div class="col-12 col-md-4">
                    <label class="fw-bold text-success small mb-1"><i class="bi bi-truck"></i> สถานะจัดรถ + ทะเบียน</label>
                    <div class="d-flex align-items-center gap-2">
                        <div class="form-check form-switch mb-0"><input class="form-check-input cTruckStatus border-success" type="checkbox" style="cursor: pointer; transform: scale(1.1);"></div>
                        <input type="text" class="form-control form-control-sm border-success cTruckPlate" placeholder="ระบุทะเบียนรถ..." oninput="if(this.value) this.previousElementSibling.querySelector('.cTruckStatus').checked = true;">
                    </div>
                </div>
                <div class="col-12 col-md-3"><label class="fw-bold small text-muted mb-1">หมายเหตุ</label><input type="text" class="form-control form-control-sm cComment border-secondary" placeholder="หมายเหตุ..."></div>
            </div>

            <div class="row g-2 align-items-end pt-2 border-top mt-1">
                <div class="col-12 mb-0"><span class="small fw-bold text-secondary">ค่าใช้จ่ายเพิ่มเติม (สำรองจ่าย/หักเพิ่ม):</span></div>
                <div class="col-4 col-md-2"><label class="small text-muted mb-1">ค่ารับตู้</label><input type="number" class="form-control form-control-sm cExp1" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-muted mb-1">ค่าคืนตู้</label><input type="number" class="form-control form-control-sm cExp2" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-muted mb-1">ต่อระยะ</label><input type="number" class="form-control form-control-sm cExp3" placeholder="0"></div>
                <div class="col-6 col-md-2"><label class="small text-muted mb-1">ค้างหาง</label><input type="number" class="form-control form-control-sm cExp4" placeholder="0"></div>
                <div class="col-6 col-md-2"><label class="small text-muted mb-1">เสียเวลา</label><input type="number" class="form-control form-control-sm cExp5" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-1">ผ่านท่า/ลาน</label><input type="number" class="form-control form-control-sm border-info cExp6" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-1">ซ่อมตู้</label><input type="number" class="form-control form-control-sm border-info cExp7" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-1">ล้างตู้</label><input type="number" class="form-control form-control-sm border-info cExp8" placeholder="0"></div>
                <div class="col-4 col-md-2"><label class="small text-primary fw-bold mb-1">ค่าชอ (Shore)</label><input type="number" class="form-control form-control-sm border-primary cExp9" placeholder="0"></div>
                
                <div class="col-6 col-md-3"><label class="small text-muted mb-1">ชื่อค่าใช้จ่ายอื่น 1</label><input type="text" class="form-control form-control-sm cExp10Name" placeholder="ระบุชื่อ..."></div>
                <div class="col-6 col-md-2"><label class="small text-muted mb-1">ยอดเงิน 1</label><input type="number" class="form-control form-control-sm cExp10Val" placeholder="0"></div>
                <div class="col-6 col-md-3"><label class="small text-muted mb-1">ชื่อค่าใช้จ่ายอื่น 2</label><input type="text" class="form-control form-control-sm cExp11Name" placeholder="ระบุชื่อ..."></div>
                <div class="col-6 col-md-2"><label class="small text-muted mb-1">ยอดเงิน 2</label><input type="number" class="form-control form-control-sm cExp11Val" placeholder="0"></div>
            </div>
        </div>
    </div>`;
  }
    
  for (let i = 1; i <= q20; i++) { html += createRow(count++, "20'", "info", mPrice20); }
  for (let i = 1; i <= q40; i++) { html += createRow(count++, "40'", "warning", mPrice40); }
  document.getElementById('container-rows').innerHTML = html;
}

async function saveData() {
  const bkg = document.getElementById('booking').value.trim(); 
  const customer = document.getElementById('customer').value.trim(); 
  const loadPlace = document.getElementById('loadPlace').value.trim();
  if (!bkg || !customer || !loadPlace) { Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณากรอก Customer, Load Place และ Booking No.' }); return; }
  const isDuplicate = allData.slice(1).some(r => r[6] === bkg);
  if (isDuplicate) { Swal.fire({ icon: 'error', title: 'Booking ซ้ำ!', text: `มีเลข Booking No: ${bkg} ในระบบแล้ว` }); return; }

  const rows = document.querySelectorAll('.container-row'); 
  if (rows.length === 0) { Swal.fire({ icon: 'warning', text: 'กรุณาสร้างรายการตู้ก่อนบันทึก' }); return; }

  let dataArray = [];
  let hasError = false;

  let mappedName = customerMapGlobal[customer] || customer;
  let billToVal = document.getElementById('billTo').value.trim() || mappedName;
  let receiptVal = document.getElementById('receiptName').value.trim() || mappedName;

  rows.forEach(r => {
    let isChecked = r.querySelector('.cTruckStatus').checked;
    let plate = r.querySelector('.cTruckPlate').value.trim();
    let container = r.querySelector('.cContainerNo').value.trim();
    
    if(isChecked && (!plate || !container)) { hasError = true; }

    dataArray.push([ 
        document.getElementById('date').value, currentUser, r.querySelector('.cType').value, document.getElementById('mode').value, customer, loadPlace, bkg, 
        r.querySelector('.cyPlace').value, r.querySelector('.cyDate').value, document.getElementById('vgm').value, 
        r.querySelector('.rtnPlace').value, r.querySelector('.rtnDate').value, document.getElementById('closing').value, document.getElementById('agent').value, 
        r.querySelector('.cComment').value, isChecked ? 'กำลังไปรับตู้' : 'รอจัดรถ', plate, r.querySelector('.cPrice').value || 0,
        r.querySelector('.cExp1').value || 0, r.querySelector('.cExp2').value || 0, r.querySelector('.cExp3').value || 0, r.querySelector('.cExp4').value || 0, r.querySelector('.cExp5').value || 0,
        container, r.querySelector('.cExp6').value || 0, r.querySelector('.cExp7').value || 0, r.querySelector('.cExp8').value || 0,
        r.querySelector('.cExp9').value || 0, r.querySelector('.cExp10Name').value.trim(), r.querySelector('.cExp10Val').value || 0, r.querySelector('.cExp11Name').value.trim(), r.querySelector('.cExp11Val').value || 0,
        "", "", billToVal, receiptVal
    ]);
  });

  if(hasError) {
      Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณาระบุ "เบอร์ตู้" และ "ทะเบียนรถ" ให้ครบถ้วนสำหรับตู้ที่ติ๊กจัดรถแล้ว' });
      return;
  }

  showGlobalLoading('กำลังบันทึกข้อมูล...');
  const res = await callAPI('saveMultipleBookings', { dataArray: dataArray });
  if (res.success) { 
      bootstrap.Modal.getInstance(document.getElementById('addModal')).hide(); 
      clearForm(); 
      await loadData(true); 
      await loadCustomerData(); 
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', timer: 1500, showConfirmButton: false }); 
  } else { 
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res.message }); 
  }
}

function formatDateHTML(dateStr) {
  if (!dateStr) return '';
  let d = new Date(dateStr); 
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
}

function openEditModal(rowNum) {
  let r = allData.find(row => row[row.length - 1] === rowNum); 
  if (!r) return;
  document.getElementById('eRowIndex').value = rowNum; 
  document.getElementById('eTitleBkg').innerText = `(${r[6]})`; 
  
  let fieldIds = ['eDate','eCS','eType','eMode','eCustomer','eLoad','eBooking','eCyP','eCyD','eVGM','eRtnP','eRtnD','eClosing','eAgent','eComment'];
  fieldIds.forEach((id, i) => {
      if (id.includes('Date') || id.includes('eCyD') || id.includes('eRtnD') || id === 'eDate') {
          document.getElementById(id).value = formatDateHTML(r[i]);
      } else {
          let element = document.getElementById(id);
          if (element) element.value = r[i] || '';
      }
  });

  let currentStatus = r[15] || 'รอจัดรถ';
  
  let eTruckStatus = document.getElementById('eTruckStatus');
  let optionExists = Array.from(eTruckStatus.options).some(opt => opt.value === currentStatus);
  if (!optionExists && currentStatus !== '') {
      eTruckStatus.innerHTML += `<option value="${currentStatus}">${currentStatus}</option>`;
  }
  eTruckStatus.value = currentStatus;
  
  document.getElementById('eTruckPlate').value = r[16] || '';
  document.getElementById('ePrice').value = r[17] || 0;
  
  document.getElementById('eExp1').value = r[18] || ''; document.getElementById('eExp2').value = r[19] || '';
  document.getElementById('eExp3').value = r[20] || ''; document.getElementById('eExp4').value = r[21] || ''; document.getElementById('eExp5').value = r[22] || '';
  document.getElementById('eContainerNo').value = r[23] || '';
  document.getElementById('eExp6').value = r[24] || '';
  document.getElementById('eExp7').value = r[25] || '';
  document.getElementById('eExp8').value = r[26] || '';
  document.getElementById('eExp9').value = r[27] || '';
  document.getElementById('eExp10Name').value = r[28] || '';
  document.getElementById('eExp10Val').value = r[29] || '';
  document.getElementById('eExp11Name').value = r[30] || '';
  document.getElementById('eExp11Val').value = r[31] || '';
  
  document.getElementById('eInvoiceNo').value = r[32] || '';

  let mappedName = customerMapGlobal[r[4]] || r[4];
  document.getElementById('eBillTo').value = r[34] || mappedName || '';
  document.getElementById('eReceiptName').value = r[35] || mappedName || '';

  let logElem = document.getElementById('eEditLog');
  let logSection = document.getElementById('editLogSection');
  if(r[33]) {
      logElem.value = r[33];
      logSection.style.display = 'block';
  } else {
      logElem.value = '';
      logSection.style.display = 'none';
  }

  let btnSave = document.getElementById('btnSaveEdit');
  let btnFinishBooking = document.getElementById('btnFinishBooking');
  let btnDeleteSingle = document.getElementById('btnDeleteSingle');
  let inputs = document.querySelectorAll('#editModal input, #editModal select');

  if(currentStatus === 'พร้อมวางบิล' || currentStatus === 'วางบิลแล้ว') {
      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="bi bi-lock-fill"></i> ${currentStatus} (แก้ไขไม่ได้)`;
      btnSave.classList.replace('btn-success', 'btn-secondary');
      
      btnFinishBooking.disabled = true;
      btnDeleteSingle.disabled = true;

      inputs.forEach(inp => {
          inp.disabled = true;
          inp.classList.add('bg-light');
      });
      
  } else {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i class="bi bi-floppy-fill"></i> บันทึกแก้ไข';
      btnSave.classList.replace('btn-secondary', 'btn-success');
      
      btnFinishBooking.disabled = false;
      btnDeleteSingle.disabled = false;

      inputs.forEach(inp => {
          if(inp.id !== 'eCS' && inp.id !== 'eInvoiceNo') {
              inp.disabled = false;
              inp.classList.remove('bg-light');
          }
      });
  }

  let eModeElem = document.getElementById('eMode');
  if(eModeElem && !eModeElem.disabled) { eModeElem.onchange = autoCalcEditPrice; }

  new bootstrap.Modal(document.getElementById('editModal')).show();
}

async function saveEdit() {
  let rowNum = parseInt(document.getElementById('eRowIndex').value); 
  let r = allData.find(row => row[row.length - 1] === rowNum); 
  const v = (id) => document.getElementById(id).value;
  
  let status = v('eTruckStatus');
  let plate = v('eTruckPlate').trim();
  let container = v('eContainerNo').trim();

  if(status !== 'รอจัดรถ' && (!plate || !container)) {
      Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'หากสถานะมีการจัดรถแล้ว ต้องระบุ เบอร์ตู้ และ ทะเบียนรถ เสมอ' });
      return;
  }
  
  let mappedName = customerMapGlobal[v('eCustomer').trim()] || v('eCustomer').trim();

  let updatedData = [ 
      v('eDate'), v('eCS'), v('eType'), v('eMode'), v('eCustomer'), v('eLoad'), v('eBooking'), 
      v('eCyP'), v('eCyD'), v('eVGM'), v('eRtnP'), v('eRtnD'), v('eClosing'), v('eAgent'), v('eComment'), 
      status, plate, v('ePrice') || 0, 
      v('eExp1') || 0, v('eExp2') || 0, v('eExp3') || 0, v('eExp4') || 0, v('eExp5') || 0,
      container, v('eExp6') || 0, v('eExp7') || 0, v('eExp8') || 0,
      v('eExp9') || 0, v('eExp10Name').trim(), v('eExp10Val') || 0, v('eExp11Name').trim(), v('eExp11Val') || 0,
      r[32] || '', r[33] || '', v('eBillTo').trim() || mappedName, v('eReceiptName').trim() || mappedName
  ];
  
  showGlobalLoading('กำลังบันทึกการแก้ไข...');
  const res = await callAPI('updateSingleRow', { rowNumber: rowNum, rowData: updatedData, user: currentUser });
  if (res.success) { 
      bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); 
      await loadData(true); 
      await loadCustomerData(); 
      Swal.fire({ icon: 'success', title: 'อัปเดตสำเร็จ!', timer: 1500, showConfirmButton: false }); 
  } else { 
      Swal.fire({ icon: 'error', text: res.message }); 
  }
}

async function finishEntireBooking() {
    let rowNum = parseInt(document.getElementById('eRowIndex').value);
    let bkgNo = document.getElementById('eBooking').value.trim(); 
    if(!bkgNo) return;

    const v = (id) => document.getElementById(id).value;
    let currentPlate = v('eTruckPlate').trim();
    let currentContainer = v('eContainerNo').trim();

    if(!currentPlate || !currentContainer) {
        Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณาระบุ เบอร์ตู้ และ ทะเบียนรถ ในตู้นี้ให้ครบก่อนครับ' });
        return;
    }

    let otherRows = allData.filter(r => (r[6] != null ? r[6].toString().trim() : "") === bkgNo && r[r.length - 1] !== rowNum);
    for(let r of otherRows) {
        let status = r[15];
        if(status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล') continue;
        if(!r[16] || !r[23]) { 
            Swal.fire({icon: 'warning', title: 'ข้อมูลไม่ครบ', text: `ตู้ใบอื่นใน Booking นี้ยังไม่ได้ระบุ เบอร์ตู้ หรือ ทะเบียนรถ\nกรุณาใส่ให้ครบทุกใบก่อนกดจบงานรวดเดียวครับ`});
            return;
        }
    }

    let mappedName = customerMapGlobal[v('eCustomer').trim()] || v('eCustomer').trim();

    let updatedData = [ 
        v('eDate'), v('eCS'), v('eType'), v('eMode'), v('eCustomer'), v('eLoad'), v('eBooking'), 
        v('eCyP'), v('eCyD'), v('eVGM'), v('eRtnP'), v('eRtnD'), v('eClosing'), v('eAgent'), v('eComment'), 
        'จบงานรอวางบิล', currentPlate, v('ePrice') || 0, 
        v('eExp1') || 0, v('eExp2') || 0, v('eExp3') || 0, v('eExp4') || 0, v('eExp5') || 0,
        currentContainer, v('eExp6') || 0, v('eExp7') || 0, v('eExp8') || 0,
        v('eExp9') || 0, v('eExp10Name').trim(), v('eExp10Val') || 0, v('eExp11Name').trim(), v('eExp11Val') || 0,
        '', '', v('eBillTo').trim() || mappedName, v('eReceiptName').trim() || mappedName
    ];

    Swal.fire({
        title: 'ยืนยันจบงานรวดเดียว?',
        html: `ระบบจะเซฟข้อมูลตู้ใบนี้และเปลี่ยนสถานะตู้ทั้งหมดใน<br><b class="text-primary">${bkgNo}</b> เป็น <b class="text-success">"จบงานรอวางบิล"</b> หรือไม่?`,
        icon: 'question',
        showCancelButton: true, confirmButtonColor: '#10b981', confirmButtonText: '<i class="bi bi-check2-all"></i> ใช่, จบงานรวดเดียว!', cancelButtonText: 'ยกเลิก'
    }).then(async res => {
        if(res.isConfirmed) {
            showGlobalLoading('กำลังบันทึกและเปลี่ยนสถานะทั้ง Booking...');
            const resApi = await callAPI('saveAndFinishBookingBatch', { rowNumber: rowNum, rowData: updatedData, bookingNo: bkgNo, user: currentUser });
            if(resApi.success) {
                bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
                await loadData(true);
                Swal.fire({ icon: 'success', title: 'สำเร็จ!', text: resApi.message, timer: 2000, showConfirmButton: false });
            } else { Swal.fire('เกิดข้อผิดพลาด', resApi.message, 'error'); }
        }
    });
}

function deleteSingle() {
  let bkgNo = document.getElementById('eBooking').value;
  let status = document.getElementById('eTruckStatus').value;
  if(status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล') {
      Swal.fire({ icon: 'error', title: 'ลบไม่ได้!', text: `รายการนี้อยู่ในสถานะ "${status}" ไปแล้ว ไม่สามารถลบได้ครับ` }); return;
  }

  Swal.fire({ title: 'ยืนยันการลบตู้?', text: `ลบตู้นี้ออกจาก Booking หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ใช่, ลบเลย!' 
  }).then(async (result) => {
    if (result.isConfirmed) {
      showGlobalLoading('กำลังลบข้อมูล...');
      const res = await callAPI('deleteSingleRow', { rowNumber: parseInt(document.getElementById('eRowIndex').value), user: currentUser, bkgNo: bkgNo });
      if (res.success) { 
          bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); 
          await loadData(true); 
          Swal.fire({ icon: 'success', timer: 1500, showConfirmButton: false }); 
      }
    }
  });
}

function openDeleteBookingModal() {
  let bkgMap = new Map();
  for (let i = 1; i < allData.length; i++) {
      let row = allData[i]; let bkgNo = row[6]; let customer = row[4]; let status = row[15];
      if (!bkgMap.has(bkgNo)) { bkgMap.set(bkgNo, { bkgNo: bkgNo, customer: customer, total: 0, pending: 0, running: 0, billed: 0 }); }
      let info = bkgMap.get(bkgNo);
      info.total++;
      if (status === 'รอจัดรถ') info.pending++; 
      else if (RUNNING_STATUSES.includes(status)) info.running++;
      else if (status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล' || status === 'จบงานรอวางบิล') info.billed++; 
  }
  let html = '';
  if (bkgMap.size === 0) { html = '<tr><td colspan="5" class="text-center text-muted py-4">ไม่มีข้อมูล Booking ในระบบ</td></tr>';
  } else {
      bkgMap.forEach((info, bkgNo) => {
          let deleteBtn = `<button class="btn btn-outline-danger btn-sm rounded-pill px-3 fw-bold shadow-sm" onclick="confirmDeleteBooking('${info.bkgNo}')"><i class="bi bi-trash"></i> ลบทั้งหมด</button>`;
          if(info.billed > 0) deleteBtn = `<span class="badge bg-secondary">ลบไม่ได้ (ส่งบัญชี/จบงานแล้ว)</span>`; 
          
          html += `
          <tr class="delete-row-item">
              <td class="align-middle fw-bold text-primary fs-6">${info.bkgNo}</td>
              <td class="align-middle text-secondary">${info.customer}</td>
              <td class="align-middle text-center"><span class="badge bg-secondary rounded-pill px-3 fs-6 shadow-sm">${info.total} ใบ</span></td>
              <td class="align-middle"><div class="small fw-bold text-warning mb-1"><i class="bi bi-clock"></i> รอจัด: ${info.pending}</div><div class="small fw-bold text-success"><i class="bi bi-truck"></i> วิ่งงาน: ${info.running}</div></td>
              <td class="align-middle text-center">${deleteBtn}</td>
          </tr>`;
      });
  }
  document.getElementById('searchDeleteModal').value = ''; 
  document.getElementById('deleteBookingBody').innerHTML = html;
  new bootstrap.Modal(document.getElementById('deleteBookingModal')).show();
}

function debouncedFilterDeleteModal() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        let input = document.getElementById("searchDeleteModal").value.toLowerCase();
        let rows = document.querySelectorAll(".delete-row-item");
        rows.forEach(row => {
            let text = row.innerText.toLowerCase();
            row.style.display = text.includes(input) ? "" : "none";
        });
    }, 400);
}

function confirmDeleteBooking(bkgNo) {
  Swal.fire({ title: 'ยืนยันการลบ Booking?', html: `คุณกำลังจะลบตู้ทั้งหมดของ<br><b class="fs-5 text-danger">${bkgNo}</b><br>ใช่หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#6c757d', confirmButtonText: '<i class="bi bi-trash"></i> ใช่, ลบทั้งหมด!', cancelButtonText: 'ยกเลิก'
  }).then(async (result) => {
    if (result.isConfirmed) {
      showGlobalLoading(`กำลังลบ Booking: ${bkgNo}...`);
      const res = await callAPI('deleteByBooking', { bookingNo: bkgNo, user: currentUser });
      if (res.success) { 
          bootstrap.Modal.getInstance(document.getElementById('deleteBookingModal')).hide(); 
          await loadData(true); 
          Swal.fire({ icon: 'success', title: 'ลบสำเร็จ!', timer: 1500, showConfirmButton: false }); 
      } else { 
          Swal.fire({ icon: 'error', text: res.message }); 
      }
    }
  });
}

function showCSBreakdown(type) {
  if (filteredData.length <= 1) { Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'ไม่พบข้อมูลในช่วงเวลาหรือตัวกรองที่เลือก' }); return; }
  let csCount = {}; let totalCards = 0; let title = ''; let iconColor = '';
  for (let i = 1; i < filteredData.length; i++) {
      let row = filteredData[i]; let cs = row[1] || 'ไม่ระบุ CS'; let status = row[15];
      let shouldCount = false;
      
      if (type === 'total') { shouldCount = true; title = 'สรุปตู้ทั้งหมดแยกตาม CS'; iconColor = '#3b82f6'; } 
      else if (type === 'pending' && status === 'รอจัดรถ') { shouldCount = true; title = 'สรุปตู้รอจัดรถแยกตาม CS'; iconColor = '#f59e0b'; } 
      else if (type === 'done' && RUNNING_STATUSES.includes(status)) { shouldCount = true; title = 'สรุปตู้กำลังวิ่งงานแยกตาม CS'; iconColor = '#10b981'; }
      else if (type === 'finished' && (status === 'จบงานรอวางบิล' || status === 'พร้อมวางบิล' || status === 'วางบิลแล้ว')) { shouldCount = true; title = 'สรุปตู้จบงานแยกตาม CS'; iconColor = '#8b5cf6'; }
      
      if (shouldCount) { csCount[cs] = (csCount[cs] || 0) + 1; totalCards++; }
  }
  if (totalCards === 0) { Swal.fire({ icon: 'info', title: title, text: 'ไม่มีข้อมูลในสถานะนี้' }); return; }
  let sortedCS = Object.keys(csCount).sort((a, b) => csCount[b] - csCount[a]);
  let htmlContent = `<div class="table-responsive"><table class="table table-bordered table-hover text-start shadow-sm"><thead style="background-color: ${iconColor}; color: white;"><tr><th><i class="bi bi-person-badge"></i> ชื่อ CS</th><th class="text-center">จำนวน (ใบ)</th></tr></thead><tbody>`;
  sortedCS.forEach(cs => { htmlContent += `<tr><td class="fw-bold align-middle">${cs}</td><td class="text-center fs-5 text-primary fw-bold align-middle">${csCount[cs]}</td></tr>`; });
  htmlContent += `</tbody><tfoot class="table-light"><tr><td class="text-end fw-bold align-middle">รวมทั้งหมด</td><td class="text-center fs-5 text-danger fw-bold align-middle">${totalCards}</td></tr></tfoot></table></div>`;
  Swal.fire({ title: `<span style="color: ${iconColor};"><i class="bi bi-bar-chart-line-fill"></i> ${title}</span>`, html: htmlContent, width: 500, showConfirmButton: true, confirmButtonText: 'ปิดหน้าต่าง', confirmButtonColor: '#6c757d', customClass: { title: 'fs-4 fw-bold' } });
}

let rawCustomers = [];

function openCustomerModal() {
  let fields = ['newCustShort', 'newCustFull', 'newCustAddress', 'newCustTax', 'newCustCredit', 'newCustRemark', 'searchCustomer'];
  fields.forEach(id => document.getElementById(id).value = '');
  loadCustomerTable();
  new bootstrap.Modal(document.getElementById('customerModal')).show();
}

async function loadCustomerTable() {
  document.getElementById('customerTableBody').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary"></div> กำลังโหลดข้อมูลลูกค้า...</td></tr>';
  const data = await callAPI('getRawCustomerData');
  if(data && data.success === false) {
      document.getElementById('customerTableBody').innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">${data.message}</td></tr>`;
      return;
  }
  rawCustomers = Array.isArray(data) ? data : [];
  renderCustomerTable();
}

function debouncedRenderCustomerTable() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => { renderCustomerTable(); }, 400);
}

function renderCustomerTable() {
  let filterText = document.getElementById('searchCustomer').value.toLowerCase();
  let tbody = '';
  
  let filtered = rawCustomers.filter(c => 
      (c[0] && c[0].toLowerCase().includes(filterText)) || 
      (c[1] && c[1].toLowerCase().includes(filterText)) ||
      (c[3] && c[3].toLowerCase().includes(filterText))
  );
  
  if (filtered.length === 0) {
      tbody = '<tr><td colspan="5" class="text-center text-muted py-4">ไม่พบข้อมูลลูกค้าในระบบ</td></tr>';
  } else {
      filtered.forEach((c) => {
          let safeData = encodeURIComponent(JSON.stringify({
              oldShort: c[0] || '', oldFull: c[1] || '',
              shortName: c[0] || '', fullName: c[1] || '', address: c[2] || '',
              taxId: c[3] || '', creditDays: c[4] || '', remark: c[5] || ''
          }));
          
          let sName = c[0] || '';
          let fName = c[1] || '';
          let safeOldShort = sName.replace(/'/g, "\\'");
          let safeOldFull = fName.replace(/'/g, "\\'");

          tbody += `<tr>
              <td class="fw-bold text-primary align-middle px-3">${sName || '<span class="text-muted fst-italic">ไม่มีชื่อย่อ</span>'}</td>
              <td class="align-middle text-start text-wrap px-3" style="min-width: 250px;">
                  ${fName || '-'}<br>
                  <small class="text-muted"><i class="bi bi-geo-alt"></i> ${c[2] || 'ไม่ระบุที่อยู่'}</small>
              </td>
              <td class="align-middle px-3 text-secondary">${c[3] || '-'}</td>
              <td class="align-middle px-3 text-success">${c[4] ? c[4] + ' วัน' : '-'}</td>
              <td class="align-middle text-center">
                  <button class="btn btn-sm btn-outline-primary rounded-circle px-2 me-1 shadow-sm" title="แก้ไข" onclick="editCustomerModal('${safeData}')"><i class="bi bi-pencil"></i></button>
                  <button class="btn btn-sm btn-outline-danger rounded-circle px-2 shadow-sm" title="ลบ" onclick="deleteCustomerModal('${safeOldShort}', '${safeOldFull}')"><i class="bi bi-trash"></i></button>
              </td>
          </tr>`;
      });
  }
  document.getElementById('customerTableBody').innerHTML = tbody;
}

async function addCustomerRecordJS() {
  let payload = {
      shortName: document.getElementById('newCustShort').value.trim(),
      fullName: document.getElementById('newCustFull').value.trim(),
      address: document.getElementById('newCustAddress').value.trim(),
      taxId: document.getElementById('newCustTax').value.trim(),
      creditDays: document.getElementById('newCustCredit').value.trim(),
      remark: document.getElementById('newCustRemark').value.trim()
  };
  
  if (!payload.shortName && !payload.fullName) {
      Swal.fire({icon: 'warning', text: 'กรุณาระบุชื่อย่อ หรือ ชื่อเต็มลูกค้า อย่างน้อย 1 ช่องครับ'});
      return;
  }
  
  showGlobalLoading('กำลังเพิ่มข้อมูลลูกค้า...');
  const res = await callAPI('addCustomerRecord', { payload: payload, user: currentUser });
  if(res.success) {
      let fields = ['newCustShort', 'newCustFull', 'newCustAddress', 'newCustTax', 'newCustCredit', 'newCustRemark'];
      fields.forEach(id => document.getElementById(id).value = '');
      await loadCustomerTable(); 
      await loadCustomerData(); 
      Swal.fire({icon: 'success', title: 'เพิ่มลูกค้าสำเร็จ!', timer: 1500, showConfirmButton: false});
  } else { 
      Swal.fire({icon: 'error', text: res.message}); 
  }
}

function editCustomerModal(encodedData) {
  let data = JSON.parse(decodeURIComponent(encodedData));
  const escapeHTML = str => (str||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  Swal.fire({
      title: 'แก้ไขข้อมูลลูกค้า',
      width: '700px', 
      html: `
          <div class="row g-2 text-start compact-form">
              <div class="col-12 col-md-4">
                  <label class="small fw-bold text-muted mb-1">ชื่อย่อ (Short Name)</label>
                  <input type="text" id="editCustShort" class="form-control form-control-sm border-primary" value="${escapeHTML(data.shortName)}">
              </div>
              <div class="col-12 col-md-8">
                  <label class="small fw-bold text-muted mb-1">ชื่อเต็ม (Full Name)</label>
                  <input type="text" id="editCustFull" class="form-control form-control-sm" value="${escapeHTML(data.fullName)}">
              </div>
              <div class="col-12">
                  <label class="small fw-bold text-muted mb-1">ที่อยู่ (Address)</label>
                  <textarea id="editCustAddress" class="form-control form-control-sm" rows="2">${escapeHTML(data.address)}</textarea>
              </div>
              <div class="col-12 col-md-4">
                  <label class="small fw-bold text-muted mb-1">Tax ID</label>
                  <input type="text" id="editCustTax" class="form-control form-control-sm" value="${escapeHTML(data.taxId)}">
              </div>
              <div class="col-12 col-md-4">
                  <label class="small fw-bold text-muted mb-1">เครดิต (วัน)</label>
                  <input type="number" id="editCustCredit" class="form-control form-control-sm" value="${escapeHTML(data.creditDays)}">
              </div>
              <div class="col-12 col-md-4">
                  <label class="small fw-bold text-muted mb-1">หมายเหตุ</label>
                  <input type="text" id="editCustRemark" class="form-control form-control-sm" value="${escapeHTML(data.remark)}">
              </div>
          </div>
      `,
      showCancelButton: true, confirmButtonText: '<i class="bi bi-floppy"></i> บันทึกแก้ไข', cancelButtonText: 'ยกเลิก',
      preConfirm: () => {
          let newShort = document.getElementById('editCustShort').value.trim();
          let newFull = document.getElementById('editCustFull').value.trim();
          
          if(!newShort && !newFull) { 
              Swal.showValidationMessage('ต้องระบุชื่อย่อ หรือ ชื่อเต็ม อย่างน้อย 1 ช่องครับ!'); 
              return false; 
          }
          
          return { 
              shortName: newShort, fullName: newFull,
              address: document.getElementById('editCustAddress').value.trim(),
              taxId: document.getElementById('editCustTax').value.trim(),
              creditDays: document.getElementById('editCustCredit').value.trim(),
              remark: document.getElementById('editCustRemark').value.trim()
          };
      }
  }).then(async (res) => {
      if (res.isConfirmed) {
          showGlobalLoading('กำลังบันทึกการแก้ไข...');
          const response = await callAPI('updateCustomerRecord', { oldShort: data.oldShort, oldFull: data.oldFull, payloadData: res.value, user: currentUser });
          if(response.success) {
              await loadCustomerTable();
              await loadCustomerData(); 
              Swal.fire({icon: 'success', title: 'อัปเดตสำเร็จ!', timer: 1500, showConfirmButton: false});
          } else { Swal.fire({icon: 'error', text: response.message}); }
      }
  });
}

function deleteCustomerModal(oldShort, oldFull) {
  let showName = oldShort || oldFull;
  Swal.fire({
      title: 'ยืนยันการลบลูกค้า',
      text: `คุณต้องการลบข้อมูลลูกค้า "${showName}" หรือไม่?`,
      icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: '<i class="bi bi-trash"></i> ใช่, ลบเลย'
  }).then(async (res) => {
      if (res.isConfirmed) {
          showGlobalLoading('กำลังลบข้อมูล...');
          const response = await callAPI('deleteCustomerRecord', { oldShort: oldShort, oldFull: oldFull, user: currentUser });
          if(response.success) {
              await loadCustomerTable();
              await loadCustomerData(); 
              Swal.fire({icon: 'success', title: 'ลบสำเร็จ!', timer: 1500, showConfirmButton: false});
          } else { Swal.fire({icon: 'error', text: response.message}); }
      }
  });
}