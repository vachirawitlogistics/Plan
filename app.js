const supabaseUrl = 'https://xvixiswhktxqstvtzzyo.supabase.co';
const supabaseKey = 'sb_publishable_PVxyqLLGpVwZa7uyadgZzg_7FslNKvk';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

const SESSION_DURATION = 6 * 60 * 60 * 1000;
const RUNNING_STATUSES = ['จัดรถแล้ว', 'กำลังไปรับตู้', 'ดรอปตู้ (รอบรรจุ)', 'กำลังบรรจุ/เปิดตู้', 'ดรอปตู้ (รอคืน)', 'กำลังไปคืนตู้', 'คืนตู้แล้ว'];

let currentUser = '';
let filterTimeout; 
let realtimeChannel; 
let allData = [];
let filteredData = []; 
let currentSortCol = 0; 
let sortAsc = false; 
let currentPage = 1; 
let fuelHistory = [];
let customerMapGlobal = {}; 
let rawCustomers = [];

function showGlobalLoader(text = 'กำลังประมวลผลข้อมูล...') {
    const loader = document.getElementById('global-full-loader');
    const loaderText = document.getElementById('global-loader-text');
    if (loader && loaderText) {
        loaderText.innerText = text;
        loader.style.display = 'flex';
    }
}

function hideGlobalLoader() {
    const loader = document.getElementById('global-full-loader');
    if (loader) loader.style.display = 'none';
}

async function writeLog(action, details) {
    try {
        await supabaseClient.from('logs').insert({ username: currentUser, action: action, details: details });
    } catch(e) { console.error("Log Error:", e); }
}

window.onload = function() {
    flatpickr(".datetime-24h", { enableTime: true, time_24hr: true, dateFormat: "Y-m-d H:i", allowInput: true });
    
    let yearSelect = document.getElementById('fuelYearFilter');
    if(yearSelect && yearSelect.options.length === 1) {
        let currentYear = new Date().getFullYear();
        for(let y = currentYear + 1; y >= currentYear - 3; y--) { yearSelect.innerHTML += `<option value="${y}">${y}</option>`; }
    }

    const modeSelect = document.getElementById('mode');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            document.getElementById('defCyPlace').value = ''; 
            document.getElementById('loadPlace').value = ''; 
            document.getElementById('defRtnPlace').value = '';
            handleCustomerSelect(); 
        });
    }

    let currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    if (document.getElementById('filterMonth')) document.getElementById('filterMonth').value = currentMonth;
    if (document.getElementById('hFilterMonth')) document.getElementById('hFilterMonth').value = currentMonth;

    const storedUser = localStorage.getItem('sysUser'); 
    const loginTime = localStorage.getItem('loginTimestamp');
    
    if (storedUser && loginTime && (new Date().getTime() - parseInt(loginTime) < SESSION_DURATION)) {
        currentUser = storedUser; 
        document.getElementById('displayUser').innerText = currentUser;
        document.getElementById('loginSection').style.display = 'none'; 
        document.getElementById('mainApp').style.display = 'block';
        switchModule('plan'); 
    } else {
        logout();
    }
};

async function doLogin() {
    const pwd = document.getElementById('loginPassword').value; 
    const btn = document.getElementById('btnLogin');
    if (!pwd) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกรหัสผ่าน' }); 
    
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span><span class="fw-bold fs-6 tracking-wide">AUTHENTICATING...</span>'; 
    btn.disabled = true;

    try {
        const { data, error } = await supabaseClient.from('login').select('username').eq('Password', parseInt(pwd)).maybeSingle();
        if (error) throw error;
        if (data) { 
            currentUser = data.username; 
            localStorage.setItem('sysUser', currentUser); 
            localStorage.setItem('loginTimestamp', new Date().getTime().toString()); 
            document.getElementById('displayUser').innerText = currentUser;
            document.getElementById('loginSection').style.display = 'none'; 
            document.getElementById('mainApp').style.display = 'block';
            await writeLog("เข้าสู่ระบบ", "เข้าสู่ระบบสำเร็จ");
            switchModule('plan'); 
        } else { 
            Swal.fire({ icon: 'error', title: 'Access Denied', text: 'รหัสผ่านไม่ถูกต้อง' }); 
        }
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message });
    }
    btn.innerHTML = '<span class="fw-bold fs-6 tracking-wide">AUTHENTICATE</span> <i class="bi bi-rocket-takeoff-fill ms-2 animate-fly"></i>'; 
    btn.disabled = false;
}

function logout() { 
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    localStorage.removeItem('sysUser'); 
    localStorage.removeItem('loginTimestamp'); 
    localStorage.removeItem('invToken');
    localStorage.removeItem('bookingDataCache'); 
    sessionStorage.clear(); 
    currentUser = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginSection').style.display = 'flex';
}

function switchModule(moduleName) {
    document.getElementById('module-plan').style.display = 'none';
    document.getElementById('module-invoice').style.display = 'none';
    document.getElementById('nav-plan').classList.remove('active');
    document.getElementById('nav-invoice').classList.remove('active');

    if (moduleName === 'plan') {
        document.getElementById('module-plan').style.display = 'block';
        document.getElementById('nav-plan').classList.add('active');
        if (allData.length === 0) loadPlanDataInitial();
    } else if (moduleName === 'invoice') {
        document.getElementById('module-invoice').style.display = 'block';
        document.getElementById('nav-invoice').classList.add('active');
        if (typeof loadBillingData === 'function') loadBillingData(true);
    }
}

function forceSyncAll() {
    sessionStorage.clear();
    localStorage.removeItem('bookingDataCache');
    if (document.getElementById('nav-plan').classList.contains('active')) {
        loadPlanDataInitial();
    } else {
        if (typeof forceSyncBillingData === 'function') forceSyncBillingData();
    }
}

function startBackgroundSync() {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient
        .channel('public:plan_data')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_data' }, async (payload) => {
            if (document.getElementById('module-plan').style.display !== 'none') {
                await loadPlanData(true); 
            } else if (document.getElementById('module-invoice').style.display !== 'none') {
                if (typeof loadBillingData === 'function') {
                    await loadBillingData(false, true); 
                    if (document.getElementById('tab-history').classList.contains('active-history')) {
                        if (typeof loadHistory === 'function') loadHistory(true);
                    }
                }
            }
        }).subscribe();
}

async function loadPlanDataInitial() {
    showGlobalLoader('กำลังดึงฐานข้อมูลจาก Supabase...');
    try {
        let allPlanData = [];
        let from = 0;
        const step = 1000;
        
        while (true) {
            const { data: chunk, error: bResError } = await supabaseClient.from('plan_data')
                .select('*')
                .order('booking_date', { ascending: false })
                .order('id', { ascending: true }) 
                .range(from, from + step - 1);
            
            if (bResError) throw bResError;
            allPlanData = allPlanData.concat(chunk);
            if (chunk.length < step) break;
            from += step;
        }

        const [cRes, sRes, fRes] = await Promise.all([
            supabaseClient.from('customer').select('*'),
            supabaseClient.from('agent').select('agent'),
            supabaseClient.from('fuel').select('*').order('price_date', { ascending: false })
        ]);

        const headerRow = ['Date','CS','Type','Mode','Customer','Load Place','Booking No','CY Place','CY Date','VGM','RTN Place','RTN Date','Closing Time','Agent','Remark','Status','Plate','Price','Exp1','Exp2','Exp3','Exp4','Exp5','Container No','Exp6','Exp7','Exp8','Exp9','Exp10Name','Exp10Val','Exp11Name','Exp11Val','InvoiceNo','EditLog','BillTo','ReceiptName','ID'];
        
        let dataRows = allPlanData.map(row => [
            row.booking_date, row.cs, row.container_type, row.mode, row.customer, row.load_place, row.booking,
            row.cy_place, row.cy_date, row.vgm, row.rtn_place, row.rtn_date, row.closing_time,
            row.agent, row.comment, row.status, row.vehicle_plate, row.price,
            row.receive, row.retrun, row.extender, row.tail_drop, row.lose_time, row.container_no,
            row.terminal_charge, row.repair, row.cleaning, row.shore, row.other_exp_name_1, row.other_exp_amt_1,
            row.other_exp_name_2, row.other_exp_amt_2, row.invoice_no, row.history_edit, row.bill_to_name, row['ชื่อออกใบเสร็จ'],
            row.id
        ]);
        
        allData = [headerRow, ...dataRows];
        localStorage.setItem('bookingDataCache', JSON.stringify(allData));
        
        let uniqueCS = [...new Set(allData.slice(1).map(r => r[1]).filter(String))];
        if (document.getElementById('csDataList')) document.getElementById('csDataList').innerHTML = uniqueCS.map(cs => `<option value="${cs}">`).join('');
        
        customerMapGlobal = {};
        let shortNames = []; let fullNames = [];
        (cRes.data || []).forEach(c => {
            if (c.short_name) shortNames.push(c.short_name);
            if (c.full_name) fullNames.push(c.full_name);
            if (c.short_name && c.full_name) customerMapGlobal[c.short_name] = c.full_name;
        });
        
        if (document.getElementById('customerList')) document.getElementById('customerList').innerHTML = [...new Set(shortNames)].sort().map(c => `<option value="${c}">`).join('');
        if (document.getElementById('companyList')) document.getElementById('companyList').innerHTML = [...new Set([...shortNames, ...fullNames])].sort().map(c => `<option value="${c}">`).join('');
        
        let agentHtml = (sRes.data || []).filter(s => s.agent).map(s => `<option value="${s.agent}">`).join('');
        if (document.getElementById('agentDataList')) document.getElementById('agentDataList').innerHTML = agentHtml;

        fuelHistory = (fRes.data || []).map(f => ({ row: f.id, date: f.price_date, price: f.current_date }));

        applyFilters();
        startBackgroundSync(); 
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลล้มเหลว', text: err.message });
    } finally { hideGlobalLoader(); }
}

async function loadPlanData(silent = false) {
    try {
        let fetchedData = [];
        let from = 0;
        const step = 1000;
        
        while (true) {
            const { data: chunk, error } = await supabaseClient.from('plan_data')
                .select('*')
                .order('booking_date', { ascending: false })
                .order('id', { ascending: true }) 
                .range(from, from + step - 1);
            if (error) throw error;
            fetchedData = fetchedData.concat(chunk);
            if (chunk.length < step) break;
            from += step;
        }

        const headerRow = ['Date','CS','Type','Mode','Customer','Load Place','Booking No','CY Place','CY Date','VGM','RTN Place','RTN Date','Closing Time','Agent','Remark','Status','Plate','Price','Exp1','Exp2','Exp3','Exp4','Exp5','Container No','Exp6','Exp7','Exp8','Exp9','Exp10Name','Exp10Val','Exp11Name','Exp11Val','InvoiceNo','EditLog','BillTo','ReceiptName','ID'];
        let dataRows = fetchedData.map(row => [
            row.booking_date, row.cs, row.container_type, row.mode, row.customer, row.load_place, row.booking,
            row.cy_place, row.cy_date, row.vgm, row.rtn_place, row.rtn_date, row.closing_time,
            row.agent, row.comment, row.status, row.vehicle_plate, row.price,
            row.receive, row.retrun, row.extender, row.tail_drop, row.lose_time, row.container_no,
            row.terminal_charge, row.repair, row.cleaning, row.shore, row.other_exp_name_1, row.other_exp_amt_1,
            row.other_exp_name_2, row.other_exp_amt_2, row.invoice_no, row.history_edit, row.bill_to_name, row['ชื่อออกใบเสร็จ'],
            row.id
        ]);

        let newData = [headerRow, ...dataRows]; 
        if (silent) {
            let oldHash = JSON.stringify(allData); let newHash = JSON.stringify(newData);
            if (oldHash === newHash) return; 
            const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });
            Toast.fire({ icon: 'info', title: '🔄 มีการอัปเดตข้อมูลใหม่จากระบบ' });
        }

        allData = newData; localStorage.setItem('bookingDataCache', JSON.stringify(allData)); 
        let uniqueCS = [...new Set(allData.slice(1).map(row => row[1]).filter(String))];
        if (document.getElementById('csDataList')) document.getElementById('csDataList').innerHTML = uniqueCS.map(cs => `<option value="${cs}">`).join('');
        applyFilters(); 
    } catch(err) { console.error('Background Sync Error:', err.message); }
}

function updateDashboard(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length <= 1) {
        document.getElementById('sumTotal').innerText = 0; document.getElementById('sumPending').innerText = 0; 
        document.getElementById('sumDone').innerText = 0; document.getElementById('sumFinished').innerText = 0; return;
    }
    let total = dataArray.length - 1; let pendingCount = 0; let doneCount = 0; let finishedCount = 0;
    for (let i = 1; i < dataArray.length; i++) { 
        let status = dataArray[i][15];
        if (status === 'รอจัดรถ') pendingCount++;
        else if (RUNNING_STATUSES.includes(status)) doneCount++;
        else if (status === 'จบงานรอวางบิล' || status === 'พร้อมวางบิล' || status === 'วางบิลแล้ว') finishedCount++;
    }
    document.getElementById('sumTotal').innerText = total; document.getElementById('sumPending').innerText = pendingCount;
    document.getElementById('sumDone').innerText = doneCount; document.getElementById('sumFinished').innerText = finishedCount;
}

function applyFilters() {
    if (!Array.isArray(allData) || allData.length <= 1) { renderTable([]); updateDashboard([]); return; }
    const getVal = (id) => { let el = document.getElementById(id); return el ? el.value.toLowerCase() : ''; };
    const getValExact = (id) => { let el = document.getElementById(id); return el ? el.value : ''; };

    const sText = getVal('filterText'); const fStatus = getValExact('filterStatus'); 
    const fMonth = getValExact('filterMonth'); 
    
    filteredData = allData.filter((row, index) => {
        if (index === 0) return true; 
        const matchText = row.join(' ').toLowerCase().includes(sText);
        const matchStatus = fStatus === '' || (row[15] && row[15] === fStatus);
        let matchDate = true;
        if (fMonth) {
            let d = new Date(row[0]);
            if (!isNaN(d.getTime())) { if (fMonth !== (d.getMonth() + 1).toString().padStart(2, '0')) matchDate = false; } 
            else { matchDate = false; }
        }
        return matchText && matchDate && matchStatus;
    });
    currentPage = 1; renderTable(filteredData); updateDashboard(filteredData); 
}

function debouncedApplyFilters() {
    clearTimeout(filterTimeout);
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังประมวลผลข้อมูล...</td></tr>';
    filterTimeout = setTimeout(() => { applyFilters(); }, 400);
}

function clearFilters() { 
    const resetVal = (id) => { let el = document.getElementById(id); if(el) el.value = ''; };
    resetVal('filterText'); resetVal('filterStatus'); resetVal('filterMonth'); 
    filteredData = [...allData]; currentPage = 1; renderTable(filteredData); updateDashboard(filteredData); 
}

function sortTable(colIndex) {
    if (!Array.isArray(filteredData) || filteredData.length <= 1) return;
    const headerRow = filteredData[0]; let dataRows = filteredData.slice(1);
    if (currentSortCol === colIndex) { sortAsc = !sortAsc; } else { currentSortCol = colIndex; sortAsc = true; }
    
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังจัดเรียงข้อมูล...</td></tr>';
    setTimeout(() => {
        dataRows.sort((a, b) => {
            let valA = a[colIndex] ? a[colIndex].toString().toLowerCase() : ''; let valB = b[colIndex] ? b[colIndex].toString().toLowerCase() : '';
            if (!isNaN(Date.parse(valA)) && !isNaN(Date.parse(valB))) { valA = new Date(valA); valB = new Date(valB); } 
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
        filteredData = [headerRow, ...dataRows]; currentPage = 1; renderTable(filteredData); 
    }, 50);
}

function changePage(step) {
    let pageSizeVal = document.getElementById('pageSize').value;
    if (pageSizeVal === 'all') return;
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><div class="spinner-border text-primary"></div><br>กำลังโหลดข้อมูล...</td></tr>';
    setTimeout(() => {
        let limit = parseInt(pageSizeVal);
        let totalRows = filteredData.length - 1; let totalPages = Math.ceil(totalRows / limit) || 1;
        currentPage += step;
        if (currentPage < 1) currentPage = 1; if (currentPage > totalPages) currentPage = totalPages;
        renderTable(filteredData);
    }, 10);
}

function renderTable(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length <= 1) {
        document.getElementById('tableBody').innerHTML = '<tr><td colspan="30" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-1 d-block mb-2 opacity-25"></i> ไม่มีข้อมูลในระบบ</td></tr>';
        document.getElementById('tableHead').innerHTML = '';
        document.getElementById('paginationControls').style.setProperty('display', 'none', 'important');
        return;
    }
    
    let displayCols = [0, 1, 2, 3, 4, 6, 23, 16, 15, 5, 7, 10, 9, 12, 14, 17];
    let thead = '<tr>'; 
    for (let colIdx of displayCols) { 
        let icon = ''; let headerText = dataArray[0][colIdx] ? dataArray[0][colIdx].toString() : '';
        let thClass = headerText.includes('ราคา') || headerText.includes('ค่า') || headerText.includes('ยอด') ? 'sticky-col-right' : ''; 
        if (currentSortCol === colIdx) icon = sortAsc ? '<i class="bi bi-caret-up-fill sort-icon"></i>' : '<i class="bi bi-caret-down-fill sort-icon"></i>';
        else icon = '<i class="bi bi-arrow-down-up sort-icon opacity-50"></i>';
        thead += `<th class="${thClass}" onclick="sortTable(${colIdx})">${headerText} ${icon}</th>`; 
    }
    thead += '</tr>'; document.getElementById('tableHead').innerHTML = thead;

    let pageSizeVal = document.getElementById('pageSize').value;
    let totalRows = dataArray.length - 1; let limit = pageSizeVal === 'all' ? totalRows : parseInt(pageSizeVal);
    let totalPages = Math.ceil(totalRows / limit) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    let startIdx = 1 + ((currentPage - 1) * limit); let endIdx = Math.min(startIdx + limit, dataArray.length);

    let tbody = '';
    let rowCount = 0;
    
    for (let i = startIdx; i < endIdx; i++) {
        let row = dataArray[i]; let rowNum = row[row.length - 1]; let status = row[15] || '';
        
        rowCount++;
        let rowClass = (rowCount % 2 !== 0) ? 'bg-light' : 'bg-white';
        
        tbody += `<tr class="${rowClass} table-row-animate" onclick="openEditModal('${rowNum}')" style="cursor: pointer;">`;
        for (let colIdx of displayCols) { 
            let cellText = row[colIdx] || ''; let headerText = dataArray[0][colIdx] ? dataArray[0][colIdx].toString() : '';
            if (colIdx === 3) { 
                let modeColor = cellText.includes('Export') ? 'bg-primary' : (cellText.includes('Import') ? 'bg-info text-dark' : 'bg-secondary');
                tbody += `<td><span class="badge ${modeColor}">${cellText}</span></td>`;
            } 
            else if (colIdx === 14 && cellText) { tbody += `<td class="text-danger fw-bold"><i class="bi bi-chat-dots"></i> ${cellText}</td>`; } 
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
            else if (colIdx === 23 && cellText) { tbody += `<td class="fw-bold text-primary">${cellText}</td>`; }
            else if (colIdx === 16 && cellText) { tbody += `<td class="fw-bold text-success">${cellText}</td>`; }
            else if (headerText.includes('ราคา') || headerText.includes('ค่า') || headerText.includes('ยอด')) { 
                let priceNum = parseFloat(cellText) || 0;
                let alignClass = headerText.includes('ราคา') ? 'sticky-col-right text-danger' : 'text-secondary';
                if(priceNum === 0) tbody += `<td class="text-end ${alignClass}">-</td>`;
                else tbody += `<td class="text-end fw-bold ${alignClass}">${priceNum.toLocaleString()}</td>`;
            } 
            else if (colIdx === 0 || colIdx === 8 || colIdx === 11) { tbody += `<td>${formatDateHTML(cellText)}</td>`; } 
            else { tbody += `<td>${cellText}</td>`; }
        }
        tbody += '</tr>';
    }
    document.getElementById('tableBody').innerHTML = tbody;
    let pagCtrl = document.getElementById('paginationControls');
    if (pageSizeVal === 'all' || totalRows <= limit) { pagCtrl.style.setProperty('display', 'none', 'important'); } 
    else { pagCtrl.style.setProperty('display', 'flex', 'important'); document.getElementById('pageInfo').innerText = `แสดงหน้า ${currentPage} จาก ${totalPages} (รวม ${totalRows} รายการ)`; }
}

function formatDateHTML(dateStr) {
    if (!dateStr) return '';
    let d = new Date(dateStr); 
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
}

function exportToExcel() {
    const table = document.getElementById("dataTable"); 
    if (!table) return;
    const wb = XLSX.utils.table_to_book(table, {sheet: "Booking Data"});
    let today = new Date(); 
    let dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `Booking_Data_${dateStr}.xlsx`);
}

function clearForm() { 
    let fields = ['booking', 'closing', 'defCyPlace', 'defCyDate', 'defRtnPlace', 'defRtnDate', 'customer', 'billTo', 'receiptName', 'loadPlace', 'vgm', 'manualPrice20', 'manualPrice40'];
    fields.forEach(id => { document.getElementById(id).value = ''; }); 
    let csInput = document.getElementById('cs'); if(csInput) csInput.value = currentUser; 
    let agentInput = document.getElementById('agent'); if(agentInput) agentInput.value = '';
    document.getElementById('qty20').value = 0; document.getElementById('qty40').value = 0; 
    document.getElementById('container-rows').innerHTML = '<div class="text-center py-4 text-muted h-100 d-flex flex-column justify-content-center align-items-center"><i class="bi bi-inbox fs-2 mb-1 opacity-25"></i><span class="small fw-medium">กรุณาระบุจำนวนตู้และกด "สร้างรายการตู้"</span></div>'; 
}

function handleCustomerSelect() { autoFillBillingNamesAdd(); }
function mapToFullName(inputElem) { let val = inputElem.value.trim(); if(val && customerMapGlobal[val]) inputElem.value = customerMapGlobal[val]; }

function autoFillBillingNamesAdd() {
    let custShort = document.getElementById('customer').value.trim();
    if(!custShort) return;
    let mappedFullName = customerMapGlobal[custShort] || custShort; 
    let billTo = document.getElementById('billTo'); if (!billTo.value || billTo.value === custShort) billTo.value = mappedFullName;
    let rec = document.getElementById('receiptName'); if (!rec.value || rec.value === custShort) rec.value = mappedFullName;
}

function autoFillBillingNamesEdit() {
    let custShort = document.getElementById('eCustomer').value.trim();
    if(!custShort) return;
    let mappedFullName = customerMapGlobal[custShort] || custShort; 
    let billTo = document.getElementById('eBillTo'); if (!billTo.value || billTo.value === custShort) billTo.value = mappedFullName;
    let rec = document.getElementById('eReceiptName'); if (!rec.value || rec.value === custShort) rec.value = mappedFullName;
}

function generateRows() {
    const q20 = parseInt(document.getElementById('qty20').value) || 0; 
    const q40 = parseInt(document.getElementById('qty40').value) || 0;
    const mPrice20 = parseFloat(document.getElementById('manualPrice20').value) || 0; 
    const mPrice40 = parseFloat(document.getElementById('manualPrice40').value) || 0;
    
    if ((q20 + q40) === 0) { Swal.fire({ icon: 'warning', text: "ระบุจำนวนตู้อย่างน้อย 1 ใบ" }); return; }
    
    const defCyPlace = document.getElementById('defCyPlace').value.trim(); 
    const defRtnPlace = document.getElementById('defRtnPlace').value.trim();
    let html = ''; let count = 1;
    
    const createRow = (idx, type, col, mPrice) => {
        return `
        <div class="card mb-2 border-${col} shadow-sm container-row p-0">
            <div class="card-header d-flex justify-content-between align-items-center py-1 bg-light">
                <div class="fw-bold text-primary mb-0 fs-6"><i class="bi bi-box-seam"></i> ตู้ใบที่ ${idx}</div>
                <div><input type="text" class="form-control form-control-sm cType text-center fw-bold text-${col} border-${col} py-0" value="${type}" readonly style="width: 70px; background-color: #fff;"></div>
            </div>
            <div class="card-body p-2">
                <div class="row g-2 align-items-end mb-2">
                    <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-0">CY Place</label><input type="text" list="cyPlaceList" class="form-control form-control-sm cyPlace" value="${defCyPlace}"></div>
                    <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-0">CY Date</label><input type="date" class="form-control form-control-sm cyDate" value="${document.getElementById('defCyDate').value}"></div>
                    <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-0">RTN Place</label><input type="text" list="rtnPlaceList" class="form-control form-control-sm rtnPlace" value="${defRtnPlace}"></div>
                    <div class="col-6 col-md-3"><label class="fw-bold small text-muted mb-0">RTN Date</label><input type="date" class="form-control form-control-sm rtnDate" value="${document.getElementById('defRtnDate').value}"></div>
                </div>
                <div class="row g-2 align-items-center pt-2 border-top">
                    <div class="col-6 col-md-2"><label class="fw-bold text-danger small mb-0">ราคา/ตู้</label><input type="number" class="form-control form-control-sm border-danger fw-bold text-success cPrice" value="${mPrice}"></div>
                    <div class="col-6 col-md-3"><label class="fw-bold text-primary small mb-0">เบอร์ตู้</label><input type="text" class="form-control form-control-sm border-primary cContainerNo" placeholder="ระบุเบอร์ตู้..."></div>
                    <div class="col-12 col-md-4">
                        <label class="fw-bold text-success small mb-0"><i class="bi bi-truck"></i> จัดรถ + ทะเบียน</label>
                        <div class="d-flex align-items-center gap-2">
                            <div class="form-check form-switch mb-0"><input class="form-check-input cTruckStatus border-success" type="checkbox"></div>
                            <input type="text" class="form-control form-control-sm border-success cTruckPlate" placeholder="ระบุทะเบียน..." oninput="if(this.value) this.previousElementSibling.querySelector('.cTruckStatus').checked = true;">
                        </div>
                    </div>
                    <div class="col-12 col-md-3"><label class="fw-bold small text-muted mb-0">หมายเหตุ</label><input type="text" class="form-control form-control-sm cComment" placeholder="หมายเหตุ..."></div>
                </div>
                <div class="row g-2 align-items-end pt-2 border-top mt-1">
                    <div class="col-12 mb-0"><span class="small fw-bold text-secondary">ค่าใช้จ่ายเพิ่มเติม:</span></div>
                    <div class="col-4 col-md-2"><label class="small text-muted mb-0">ค่ารับตู้</label><input type="number" class="form-control form-control-sm cExp1" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-muted mb-0">ค่าคืนตู้</label><input type="number" class="form-control form-control-sm cExp2" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-muted mb-0">ต่อระยะ</label><input type="number" class="form-control form-control-sm cExp3" placeholder="0"></div>
                    <div class="col-6 col-md-2"><label class="small text-muted mb-0">ค้างหาง</label><input type="number" class="form-control form-control-sm cExp4" placeholder="0"></div>
                    <div class="col-6 col-md-2"><label class="small text-muted mb-0">เสียเวลา</label><input type="number" class="form-control form-control-sm cExp5" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-0">ผ่านท่า/ลาน</label><input type="number" class="form-control form-control-sm border-info cExp6" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-0">ซ่อมตู้</label><input type="number" class="form-control form-control-sm border-info cExp7" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-info fw-bold mb-0">ล้างตู้</label><input type="number" class="form-control form-control-sm border-info cExp8" placeholder="0"></div>
                    <div class="col-4 col-md-2"><label class="small text-primary fw-bold mb-0">ค่าชอ</label><input type="number" class="form-control form-control-sm border-primary cExp9" placeholder="0"></div>
                    <div class="col-6 col-md-3"><label class="small text-muted mb-0">ยอดอื่น 1 (ชื่อ)</label><input type="text" class="form-control form-control-sm cExp10Name" placeholder="ระบุชื่อ..."></div>
                    <div class="col-6 col-md-2"><label class="small text-muted mb-0">ยอดเงิน 1</label><input type="number" class="form-control form-control-sm cExp10Val" placeholder="0"></div>
                </div>
            </div>
        </div>`;
    }
    
    for (let i = 1; i <= q20; i++) { html += createRow(count++, "20'", "info", mPrice20); }
    for (let i = 1; i <= q40; i++) { html += createRow(count++, "40'", "warning", mPrice40); }
    document.getElementById('container-rows').innerHTML = html;
}

async function saveData() {
    const bkg = document.getElementById('booking').value.trim(); const customer = document.getElementById('customer').value.trim(); const loadPlace = document.getElementById('loadPlace').value.trim();
    if (!bkg || !customer || !loadPlace) { Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณากรอก Customer, Load Place และ Booking No.' }); return; }
    const isDuplicate = allData.slice(1).some(r => r[6] === bkg);
    if (isDuplicate) { Swal.fire({ icon: 'error', title: 'Booking ซ้ำ!', text: `มีเลข Booking No: ${bkg} ในระบบแล้ว` }); return; }

    const rows = document.querySelectorAll('.container-row'); 
    if (rows.length === 0) { Swal.fire({ icon: 'warning', text: 'กรุณาสร้างรายการตู้ก่อนบันทึก' }); return; }

    let payloadData = []; let hasError = false;
    let mappedName = customerMapGlobal[customer] || customer;
    let billToVal = document.getElementById('billTo').value.trim() || mappedName;
    let receiptVal = document.getElementById('receiptName').value.trim() || mappedName;

    rows.forEach(r => {
        let isChecked = r.querySelector('.cTruckStatus').checked;
        let plate = r.querySelector('.cTruckPlate').value.trim();
        let container = r.querySelector('.cContainerNo').value.trim();
        if(isChecked && (!plate || !container)) { hasError = true; }

        payloadData.push({
            booking_date: document.getElementById('date').value || null,
            cs: currentUser, container_type: r.querySelector('.cType').value, mode: document.getElementById('mode').value,
            customer: customer, load_place: loadPlace, booking: bkg, cy_place: r.querySelector('.cyPlace').value, cy_date: r.querySelector('.cyDate').value || null,
            vgm: document.getElementById('vgm').value, rtn_place: r.querySelector('.rtnPlace').value, rtn_date: r.querySelector('.rtnDate').value || null,
            closing_time: document.getElementById('closing').value || null, agent: document.getElementById('agent').value, comment: r.querySelector('.cComment').value,
            status: isChecked ? 'กำลังไปรับตู้' : 'รอจัดรถ', vehicle_plate: plate, price: parseInt(r.querySelector('.cPrice').value) || 0,
            receive: (r.querySelector('.cExp1').value || 0).toString(), retrun: (r.querySelector('.cExp2').value || 0).toString(),
            extender: parseInt(r.querySelector('.cExp3').value) || 0, tail_drop: parseInt(r.querySelector('.cExp4').value) || 0, lose_time: parseInt(r.querySelector('.cExp5').value) || 0,
            container_no: container, terminal_charge: parseInt(r.querySelector('.cExp6').value) || 0, repair: (r.querySelector('.cExp7').value || 0).toString(),
            cleaning: parseInt(r.querySelector('.cExp8').value) || 0, shore: parseInt(r.querySelector('.cExp9').value) || 0,
            other_exp_name_1: r.querySelector('.cExp10Name').value.trim(), other_exp_amt_1: parseInt(r.querySelector('.cExp10Val').value) || 0,
            invoice_no: "", history_edit: "", bill_to_name: billToVal, ชื่อออกใบเสร็จ: receiptVal
        });
    });

    if(hasError) return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณาระบุ เบอร์ตู้ และ ทะเบียนรถ ให้ครบถ้วนสำหรับตู้ที่จัดรถแล้ว' });

    showGlobalLoader('กำลังบันทึกข้อมูล...');
    const { error } = await supabaseClient.from('plan_data').insert(payloadData);
    if (!error) { 
        await writeLog("เพิ่ม Booking ใหม่", `Booking No: ${bkg} จำนวน ${payloadData.length} ตู้`);
        bootstrap.Modal.getInstance(document.getElementById('addModal')).hide(); clearForm(); await loadPlanData(true); 
        hideGlobalLoader(); Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', timer: 1500, showConfirmButton: false }); 
    } else { 
        hideGlobalLoader(); Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: error.message }); 
    }
}

function openEditModal(rowNum) {
    let r = allData.find(row => row[row.length - 1] === rowNum); if (!r) return;
    document.getElementById('eRowIndex').value = rowNum; document.getElementById('eTitleBkg').innerText = `(${r[6]})`; 
    
    let fieldIds = ['eDate','eCS','eType','eMode','eCustomer','eLoad','eBooking','eCyP','eCyD','eVGM','eRtnP','eRtnD','eClosing','eAgent','eComment'];
    fieldIds.forEach((id, i) => {
        if (id.includes('Date') || id.includes('eCyD') || id.includes('eRtnD') || id === 'eDate') { document.getElementById(id).value = formatDateHTML(r[i]); } 
        else { let element = document.getElementById(id); if (element) element.value = r[i] || ''; }
    });

    let currentStatus = r[15] || 'รอจัดรถ';
    let eTruckStatus = document.getElementById('eTruckStatus');
    let optionExists = Array.from(eTruckStatus.options).some(opt => opt.value === currentStatus);
    if (!optionExists && currentStatus !== '') { eTruckStatus.innerHTML += `<option value="${currentStatus}">${currentStatus}</option>`; }
    eTruckStatus.value = currentStatus;
    
    document.getElementById('eTruckPlate').value = r[16] || ''; document.getElementById('ePrice').value = r[17] || 0;
    document.getElementById('eExp1').value = r[18] || ''; document.getElementById('eExp2').value = r[19] || ''; document.getElementById('eExp3').value = r[20] || ''; document.getElementById('eExp4').value = r[21] || ''; document.getElementById('eExp5').value = r[22] || '';
    document.getElementById('eContainerNo').value = r[23] || ''; document.getElementById('eExp6').value = r[24] || ''; document.getElementById('eExp7').value = r[25] || ''; document.getElementById('eExp8').value = r[26] || ''; document.getElementById('eExp9').value = r[27] || '';
    document.getElementById('eExp10Name').value = r[28] || ''; document.getElementById('eExp10Val').value = r[29] || ''; document.getElementById('eExp11Name').value = r[30] || ''; document.getElementById('eExp11Val').value = r[31] || '';
    document.getElementById('eInvoiceNo').innerText = r[32] || '-';

    let mappedName = customerMapGlobal[r[4]] || r[4];
    document.getElementById('eBillTo').value = r[34] || mappedName || ''; document.getElementById('eReceiptName').value = r[35] || mappedName || '';

    let logElem = document.getElementById('eEditLog'); let logSection = document.getElementById('editLogSection');
    if(r[33]) { logElem.value = r[33]; logSection.style.display = 'block'; } else { logElem.value = ''; logSection.style.display = 'none'; }

    let btnSave = document.getElementById('btnSaveEdit'); let btnFinishBooking = document.getElementById('btnFinishBooking'); let btnDeleteSingle = document.getElementById('btnDeleteSingle'); let inputs = document.querySelectorAll('#editModal input, #editModal select');

    if(currentStatus === 'พร้อมวางบิล' || currentStatus === 'วางบิลแล้ว') {
        btnSave.disabled = true; btnSave.innerHTML = `<i class="bi bi-lock-fill"></i> ${currentStatus} (แก้ไขไม่ได้)`; btnSave.classList.replace('btn-primary', 'btn-secondary');
        btnFinishBooking.disabled = true; btnDeleteSingle.disabled = true;
        inputs.forEach(inp => { inp.disabled = true; inp.classList.add('bg-light'); });
    } else {
        btnSave.disabled = false; btnSave.innerHTML = '<i class="bi bi-floppy-fill"></i> บันทึก'; btnSave.classList.replace('btn-secondary', 'btn-primary');
        btnFinishBooking.disabled = false; btnDeleteSingle.disabled = false;
        inputs.forEach(inp => { if(inp.id !== 'eCS' && inp.id !== 'eBooking') { inp.disabled = false; inp.classList.remove('bg-light'); } });
    }
    new bootstrap.Modal(document.getElementById('editModal')).show();
}

async function saveEdit() {
    let rowNum = document.getElementById('eRowIndex').value; 
    const v = (id) => document.getElementById(id).value;
    let status = v('eTruckStatus'); let plate = v('eTruckPlate').trim(); let container = v('eContainerNo').trim();

    if(status !== 'รอจัดรถ' && (!plate || !container)) return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'หากจัดรถแล้ว ต้องระบุ เบอร์ตู้ และ ทะเบียนรถ เสมอ' });
    let mappedName = customerMapGlobal[v('eCustomer').trim()] || v('eCustomer').trim();

    showGlobalLoader('กำลังอัปเดตข้อมูล...');
    const { error } = await supabaseClient.from('plan_data').update({
        booking_date: v('eDate') || null, cs: v('eCS'), container_type: v('eType'), mode: v('eMode'), 
        customer: v('eCustomer'), load_place: v('eLoad'), booking: v('eBooking'), 
        cy_place: v('eCyP'), cy_date: v('eCyD') || null, vgm: v('eVGM'), rtn_place: v('eRtnP'), rtn_date: v('eRtnD') || null, 
        closing_time: v('eClosing') || null, agent: v('eAgent'), comment: v('eComment'), 
        status: status, vehicle_plate: plate, price: parseInt(v('ePrice')) || 0, 
        receive: (v('eExp1') || 0).toString(), retrun: (v('eExp2') || 0).toString(), extender: parseInt(v('eExp3')) || 0, 
        tail_drop: parseInt(v('eExp4')) || 0, lose_time: parseInt(v('eExp5')) || 0,
        container_no: container, terminal_charge: parseInt(v('eExp6')) || 0, repair: (v('eExp7') || 0).toString(), cleaning: parseInt(v('eExp8')) || 0,
        shore: parseInt(v('eExp9')) || 0, other_exp_name_1: v('eExp10Name').trim(), other_exp_amt_1: parseInt(v('eExp10Val')) || 0, 
        other_exp_name_2: v('eExp11Name').trim(), other_exp_amt_2: parseInt(v('eExp11Val')) || 0,
        bill_to_name: v('eBillTo').trim() || mappedName, ชื่อออกใบเสร็จ: v('eReceiptName').trim() || mappedName
    }).eq('id', rowNum);
    
    if (!error) { 
        await writeLog("แก้ไขรายละเอียดตู้", `แก้ไขตู้ใน Booking No: ${v('eBooking')}`);
        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); await loadPlanData(true); 
        hideGlobalLoader(); Swal.fire({ icon: 'success', title: 'อัปเดตสำเร็จ!', timer: 1500, showConfirmButton: false }); 
    } else { 
        hideGlobalLoader(); Swal.fire({ icon: 'error', text: error.message }); 
    }
}

async function finishEntireBooking() {
    let rowNum = document.getElementById('eRowIndex').value; let bkgNo = document.getElementById('eBooking').value.trim(); if(!bkgNo) return;
    const v = (id) => document.getElementById(id).value; let currentPlate = v('eTruckPlate').trim(); let currentContainer = v('eContainerNo').trim();

    if(!currentPlate || !currentContainer) return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรุณาระบุ เบอร์ตู้ และ ทะเบียนรถ ให้ครบก่อนจบงาน' });

    let otherRows = allData.filter(r => (r[6] != null ? r[6].toString().trim() : "") === bkgNo && r[r.length - 1] !== rowNum);
    for(let r of otherRows) {
        let status = r[15]; if(status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล') continue;
        if(!r[16] || !r[23]) return Swal.fire({icon: 'warning', title: 'ข้อมูลไม่ครบ', text: `ตู้ใบอื่นใน Booking ยังไม่ได้ระบุ เบอร์ตู้ หรือ ทะเบียนรถ`});
    }

    let mappedName = customerMapGlobal[v('eCustomer').trim()] || v('eCustomer').trim();

    Swal.fire({
        title: 'ยืนยันจบงานรวดเดียว?', html: `ระบบจะเปลี่ยนสถานะตู้ทั้งหมดใน <b class="text-primary">${bkgNo}</b> เป็น <b class="text-success">"จบงานรอวางบิล"</b>`, icon: 'question',
        showCancelButton: true, confirmButtonColor: '#10b981', confirmButtonText: 'ใช่, จบงานรวดเดียว!', cancelButtonText: 'ยกเลิก'
    }).then(async res => {
        if(res.isConfirmed) {
            showGlobalLoader('กำลังบันทึกและจบงาน...');
            await supabaseClient.from('plan_data').update({
                booking_date: v('eDate') || null, cs: v('eCS'), container_type: v('eType'), mode: v('eMode'), 
                customer: v('eCustomer'), load_place: v('eLoad'), booking: v('eBooking'), cy_place: v('eCyP'), cy_date: v('eCyD') || null, vgm: v('eVGM'), rtn_place: v('eRtnP'), rtn_date: v('eRtnD') || null, 
                closing_time: v('eClosing') || null, agent: v('eAgent'), comment: v('eComment'), 
                status: 'จบงานรอวางบิล', vehicle_plate: currentPlate, price: parseInt(v('ePrice')) || 0, 
                receive: (v('eExp1') || 0).toString(), retrun: (v('eExp2') || 0).toString(), extender: parseInt(v('eExp3')) || 0, tail_drop: parseInt(v('eExp4')) || 0, lose_time: parseInt(v('eExp5')) || 0,
                container_no: currentContainer, terminal_charge: parseInt(v('eExp6')) || 0, repair: (v('eExp7') || 0).toString(), cleaning: parseInt(v('eExp8')) || 0,
                shore: parseInt(v('eExp9')) || 0, other_exp_name_1: v('eExp10Name').trim(), other_exp_amt_1: parseInt(v('eExp10Val')) || 0, 
                other_exp_name_2: v('eExp11Name').trim(), other_exp_amt_2: parseInt(v('eExp11Val')) || 0,
                bill_to_name: v('eBillTo').trim() || mappedName, ชื่อออกใบเสร็จ: v('eReceiptName').trim() || mappedName
            }).eq('id', rowNum);

            let idsToUpdate = otherRows.filter(r => !['วางบิลแล้ว', 'พร้อมวางบิล', 'จบงานรอวางบิล'].includes(r[15])).map(r => r[r.length - 1]);
            if (idsToUpdate.length > 0) await supabaseClient.from('plan_data').update({ status: 'จบงานรอวางบิล' }).in('id', idsToUpdate);

            await writeLog("จบงาน (Batch)", `บันทึกและเปลี่ยนสถานะจบงาน BKG: ${bkgNo}`);
            bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); await loadPlanData(true);
            hideGlobalLoader(); Swal.fire({ icon: 'success', title: 'สำเร็จ!', timer: 2000, showConfirmButton: false });
        }
    });
}

function deleteSingle() {
    let bkgNo = document.getElementById('eBooking').value; let status = document.getElementById('eTruckStatus').value; let rowNum = document.getElementById('eRowIndex').value;
    if(status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล') return Swal.fire({ icon: 'error', title: 'ลบไม่ได้!', text: `รายการอยู่ในสถานะ "${status}" ไม่สามารถลบได้` });

    Swal.fire({ title: 'ยืนยันการลบตู้?', text: `ลบตู้นี้ออกจาก Booking หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ใช่, ลบเลย!' 
    }).then(async (result) => {
        if (result.isConfirmed) {
            showGlobalLoader('กำลังลบข้อมูล...');
            const { error } = await supabaseClient.from('plan_data').delete().eq('id', rowNum);
            if (!error) { 
                await writeLog("ลบตู้ (รายใบ)", `ลบตู้จาก Booking No: ${bkgNo}`);
                bootstrap.Modal.getInstance(document.getElementById('editModal')).hide(); await loadPlanData(true); 
                hideGlobalLoader(); Swal.fire({ icon: 'success', timer: 1500, showConfirmButton: false }); 
            } else { hideGlobalLoader(); Swal.fire({ icon: 'error', text: error.message }); }
        }
    });
}

function openBatchTruckModal() {
    document.getElementById('batchDateFilter').value = ''; 
    let pendingCS = [...new Set(allData.slice(1).filter(r => r[15] === 'รอจัดรถ').map(r => r[1]).filter(String))];
    let csOptions = '<option value="">- ทุก CS -</option>'; pendingCS.forEach(cs => { csOptions += `<option value="${cs}">${cs}</option>`; });
    let csFilterElem = document.getElementById('batchCsFilter'); csFilterElem.innerHTML = csOptions; csFilterElem.value = ''; 
    renderBatchTruckTable(); new bootstrap.Modal(document.getElementById('batchTruckModal')).show();
}

function renderBatchTruckTable() {
    let filterDate = document.getElementById('batchDateFilter').value; let filterCS = document.getElementById('batchCsFilter').value.toLowerCase(); let unassignedRows = [];
    for (let i = 1; i < allData.length; i++) { 
        if (allData[i][15] === 'รอจัดรถ') {
            let matchDate = true; let matchCS = true;
            if (filterDate) { let rowDate = formatDateHTML(allData[i][0]); if (rowDate !== filterDate) matchDate = false; }
            if (filterCS) { let rowCS = (allData[i][1] || '').toString().toLowerCase(); if (rowCS !== filterCS) matchCS = false; }
            if (matchDate && matchCS) { unassignedRows.push(allData[i]); }
        } 
    }
    document.getElementById('batchCount').innerText = unassignedRows.length; let html = '';
    if (unassignedRows.length === 0) { html = `<tr><td colspan="7" class="text-center py-4 text-muted">ไม่พบตู้รอจัดรถ</td></tr>`; } 
    else {
        unassignedRows.forEach(r => {
            let currentPlate = r[16] || ''; let currentContainer = r[23] || ''; let showDate = formatDateHTML(r[0]); 
            html += `<tr class="batch-truck-row" data-row="${r[r.length - 1]}"><td class="align-middle fw-bold text-secondary">${showDate}</td><td class="align-middle"><span class="fw-bold text-primary">${r[6]}</span><br><span class="badge bg-info text-dark shadow-sm mb-1"><i class="bi bi-person-badge"></i> CS: ${r[1]}</span></td><td class="text-center align-middle"><span class="badge bg-${r[2] === "20'" ? 'info' : 'warning'} text-dark shadow-sm">${r[2]}</span></td><td class="align-middle"><small class="text-muted d-block"><b>รับ:</b> ${r[7]}</small><small class="text-muted d-block"><b>คืน:</b> ${r[10]}</small></td><td class="text-center align-middle"><div class="form-check form-switch d-flex justify-content-center fs-5"><input class="form-check-input bStatus border-success" type="checkbox" style="cursor:pointer;"></div></td><td class="align-middle"><input type="text" class="form-control form-control-sm border-success bPlate" value="${currentPlate}" placeholder="ระบุทะเบียน..." oninput="this.closest('tr').querySelector('.bStatus').checked = this.value.trim().length > 0;"></td><td class="align-middle"><input type="text" class="form-control form-control-sm border-info bContainer" value="${currentContainer}" placeholder="ระบุเบอร์ตู้..."></td></tr>`;
        });
    }
    document.getElementById('batchTruckBody').innerHTML = html;
}

async function saveBatchTruckMulti() {
    const rows = document.querySelectorAll('.batch-truck-row'); if (rows.length === 0) return;
    let payload = []; let hasError = false;

    rows.forEach(r => {
        let checkbox = r.querySelector('.bStatus');
        if (checkbox && checkbox.checked) { 
            let plate = r.querySelector('.bPlate').value.trim(); let container = r.querySelector('.bContainer').value.trim();
            if(!plate || !container) hasError = true;
            payload.push({ id: r.getAttribute('data-row'), status: 'กำลังไปรับตู้', vehicle_plate: plate, container_no: container }); 
        }
    });

    if (payload.length === 0) return Swal.fire({ icon: 'warning', text: 'คุณยังไม่ได้เปิดสวิตช์จัดรถ' });
    if (hasError) return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ!', text: 'กรุณาระบุ ทะเบียนรถ และ เบอร์ตู้ ให้ครบถ้วน' });

    showGlobalLoader('กำลังอัปเดต...');
    const promises = payload.map(item => supabaseClient.from('plan_data').update({ status: item.status, vehicle_plate: item.vehicle_plate, container_no: item.container_no }).eq('id', item.id));
    const results = await Promise.all(promises);
    const error = results.find(res => res.error);

    if (!error) { 
        await writeLog("จัดรถ (Batch)", `อัปเดตสถานะจัดรถจำนวน ${payload.length} ตู้`);
        bootstrap.Modal.getInstance(document.getElementById('batchTruckModal')).hide(); await loadPlanData(true); 
        hideGlobalLoader(); Swal.fire({ icon: 'success', title: 'สำเร็จ!', timer: 1500, showConfirmButton: false }); 
    } else { hideGlobalLoader(); Swal.fire({ icon: 'error', text: error.error.message }); }
}

function openPricingMasterModal() {
    document.getElementById('fuelMonthFilter').value = ''; document.getElementById('fuelYearFilter').value = ''; document.getElementById('newFuelPrice').value = '';
    renderFuelHistory(); 
    new bootstrap.Modal(document.getElementById('pricingMasterModal')).show();
}

function renderFuelHistory() {
    let fMonth = document.getElementById('fuelMonthFilter').value; let fYear = document.getElementById('fuelYearFilter').value; let tbody = '';
    let filteredFuel = fuelHistory.filter(f => {
        let fd = new Date(f.date); let matchMonth = fMonth === '' || fd.getMonth().toString() === fMonth; let matchYear = fYear === '' || fd.getFullYear().toString() === fYear;
        return matchMonth && matchYear;
    });

    if (filteredFuel.length === 0) { tbody = '<tr><td colspan="3" class="text-center py-4 text-muted">ไม่พบประวัติราคาน้ำมัน</td></tr>'; } 
    else {
        filteredFuel.forEach(f => {
            let showDate = formatDateHTML(f.date);
            tbody += `<tr><td class="align-middle fw-bold text-secondary">${showDate}</td><td class="align-middle fw-bold text-danger fs-6">฿${f.price.toFixed(2)}</td><td class="align-middle text-center"><div class="d-flex justify-content-center gap-2"><button class="btn btn-sm btn-outline-primary rounded-circle px-2" title="แก้ไข" onclick="editFuelRecord('${f.row}', '${showDate}', ${f.price})"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger rounded-circle px-2" title="ลบ" onclick="deleteFuelRecord('${f.row}')"><i class="bi bi-trash"></i></button></div></td></tr>`;
        });
    }
    document.getElementById('fuelHistoryBody').innerHTML = tbody;
}

async function saveFuelLog() {
    let dateStr = document.getElementById('newFuelDate').value; let priceVal = document.getElementById('newFuelPrice').value;
    if(!dateStr || !priceVal) return Swal.fire({ icon: 'warning', text: 'กรุณาระบุวันที่และราคาน้ำมันให้ถูกต้อง' });
    const { error } = await supabaseClient.from('fuel').insert({ price_date: dateStr, current_date: parseFloat(priceVal) });
    if(!error) {
        await writeLog("เพิ่มราคาน้ำมัน", `วันที่: ${dateStr} ราคา: ${priceVal}`);
        document.getElementById('newFuelPrice').value = ''; await loadPlanDataInitial(); renderFuelHistory(); 
    } else { Swal.fire({ icon: 'error', text: error.message }); }
}

function editFuelRecord(row, oldDate, oldPrice) {
    Swal.fire({
        title: 'แก้ไขราคาน้ำมัน', html: `<div class="text-start"><label class="small fw-bold">วันที่มีผล</label><input type="date" id="editFDate" class="form-control mb-2" value="${oldDate}"><label class="small fw-bold">ราคา (บาท)</label><input type="number" id="editFPrice" class="form-control" step="0.01" value="${oldPrice}"></div>`,
        showCancelButton: true, confirmButtonText: 'บันทึกแก้ไข', cancelButtonText: 'ยกเลิก', preConfirm: () => { let d = document.getElementById('editFDate').value; let p = document.getElementById('editFPrice').value; if(!d || !p) { Swal.showValidationMessage('กรุณากรอกข้อมูลให้ครบ!'); return false; } return { date: d, price: p }; }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const { error } = await supabaseClient.from('fuel').update({ price_date: result.value.date, current_date: parseFloat(result.value.price) }).eq('id', row);
            if(!error) { 
                await writeLog("แก้ไขราคาน้ำมัน", `อัปเดตเป็น วันที่: ${result.value.date} ราคา: ${result.value.price}`);
                await loadPlanDataInitial(); renderFuelHistory(); 
            } else { Swal.fire({ icon: 'error', text: error.message }); }
        }
    });
}

function deleteFuelRecord(row) {
    Swal.fire({ title: 'ลบราคาน้ำมัน?', text: 'รายการนี้จะถูกลบออกจากระบบถาวร', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ใช่, ลบเลย'
    }).then(async (result) => {
        if(result.isConfirmed) {
            const { error } = await supabaseClient.from('fuel').delete().eq('id', row);
            if(!error) { 
                await writeLog("ลบราคาน้ำมัน", `ลบราคาน้ำมัน ID: ${row}`);
                await loadPlanDataInitial(); renderFuelHistory(); 
            } else { Swal.fire({ icon: 'error', text: error.message }); }
        }
    });
}

function addNewSetting(type) {
    if (type !== 'AGENT') return;
    Swal.fire({
        title: `เพิ่ม ${type} ใหม่`, input: 'text', inputPlaceholder: `พิมพ์ชื่อ ${type} ที่ต้องการเพิ่ม...`, showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก', inputValidator: (value) => { if (!value) return 'กรุณากรอกข้อมูล!'; }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const { error } = await supabaseClient.from('agent').insert({ agent: result.value.trim() });
            if (!error) { await loadPlanDataInitial(); Swal.fire({ icon: 'success', title: 'เพิ่มสำเร็จ', timer: 1500, showConfirmButton: false }); } 
            else { Swal.fire({ icon: 'error', text: error.message }); }
        }
    });
}

async function openLogModal() {
    new bootstrap.Modal(document.getElementById('logModal')).show();
    document.getElementById('logTableBody').innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border spinner-border-sm text-info"></div> กำลังโหลดประวัติ...</td></tr>';
    const { data, error } = await supabaseClient.from('logs').select('*').order('created_at', { ascending: false }).limit(200);
    
    if (error) { document.getElementById('logTableBody').innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${error.message}</td></tr>`; return; }
    if (!data || data.length === 0) { document.getElementById('logTableBody').innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">ยังไม่มีประวัติการทำงาน</td></tr>'; return; }
    
    let html = '';
    data.forEach(row => {
        let dateFormatted = formatDateHTML(row.created_at) + " " + (new Date(row.created_at).toLocaleTimeString('th-TH'));
        html += `<tr><td class="text-muted small">${dateFormatted}</td><td class="fw-bold text-primary">${row.username || '-'}</td><td><span class="badge bg-info text-dark">${row.action || '-'}</span></td><td class="small text-wrap">${row.details || '-'}</td></tr>`;
    });
    document.getElementById('logTableBody').innerHTML = html;
}

function showCSBreakdown(type) {
    if (filteredData.length <= 1) return Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'ไม่พบข้อมูลในช่วงเวลาหรือตัวกรองที่เลือก' }); 
    let csCount = {}; let totalCards = 0; let title = ''; let iconColor = '';
    for (let i = 1; i < filteredData.length; i++) {
        let row = filteredData[i]; let cs = row[1] || 'ไม่ระบุ CS'; let status = row[15]; let shouldCount = false;
        if (type === 'total') { shouldCount = true; title = 'สรุปตู้ทั้งหมดแยกตาม CS'; iconColor = '#3b82f6'; } 
        else if (type === 'pending' && status === 'รอจัดรถ') { shouldCount = true; title = 'สรุปตู้รอจัดรถแยกตาม CS'; iconColor = '#f59e0b'; } 
        else if (type === 'done' && RUNNING_STATUSES.includes(status)) { shouldCount = true; title = 'สรุปตู้กำลังวิ่งงานแยกตาม CS'; iconColor = '#10b981'; }
        else if (type === 'finished' && (status === 'จบงานรอวางบิล' || status === 'พร้อมวางบิล' || status === 'วางบิลแล้ว')) { shouldCount = true; title = 'สรุปตู้จบงานแยกตาม CS'; iconColor = '#8b5cf6'; }
        if (shouldCount) { csCount[cs] = (csCount[cs] || 0) + 1; totalCards++; }
    }
    if (totalCards === 0) return Swal.fire({ icon: 'info', title: title, text: 'ไม่มีข้อมูลในสถานะนี้' });
    let sortedCS = Object.keys(csCount).sort((a, b) => csCount[b] - csCount[a]);
    let htmlContent = `<div class="table-responsive"><table class="table table-bordered table-hover text-start shadow-sm"><thead style="background-color: ${iconColor}; color: white;"><tr><th><i class="bi bi-person-badge"></i> ชื่อ CS</th><th class="text-center">จำนวน (ใบ)</th></tr></thead><tbody>`;
    sortedCS.forEach(cs => { htmlContent += `<tr><td class="fw-bold align-middle">${cs}</td><td class="text-center fs-5 text-primary fw-bold align-middle">${csCount[cs]}</td></tr>`; });
    htmlContent += `</tbody><tfoot class="table-light"><tr><td class="text-end fw-bold align-middle">รวมทั้งหมด</td><td class="text-center fs-5 text-danger fw-bold align-middle">${totalCards}</td></tr></tfoot></table></div>`;
    Swal.fire({ title: `<span style="color: ${iconColor};"><i class="bi bi-bar-chart-line-fill"></i> ${title}</span>`, html: htmlContent, width: 500, showConfirmButton: true, confirmButtonText: 'ปิดหน้าต่าง', confirmButtonColor: '#6c757d', customClass: { title: 'fs-4 fw-bold' } });
}

function openCustomerModal() {
    let fields = ['newCustShort', 'newCustFull', 'newCustAddress', 'newCustTax', 'newCustCredit', 'newCustRemark', 'searchCustomer'];
    fields.forEach(id => document.getElementById(id).value = '');
    loadCustomerTable(); new bootstrap.Modal(document.getElementById('customerModal')).show();
}

async function loadCustomerTable() {
    document.getElementById('customerTableBody').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary"></div> กำลังโหลดข้อมูลลูกค้า...</td></tr>';
    const { data, error } = await supabaseClient.from('customer').select('*');
    if(error) { document.getElementById('customerTableBody').innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">${error.message}</td></tr>`; return; }
    rawCustomers = (data || []).map(c => [c.short_name, c.full_name, c.address, c.tax_id, c.credit_days, c.note]);
    renderCustomerTable();
}

function debouncedRenderCustomerTable() { clearTimeout(filterTimeout); filterTimeout = setTimeout(() => { renderCustomerTable(); }, 400); }

function renderCustomerTable() {
    let filterText = document.getElementById('searchCustomer').value.toLowerCase(); let tbody = '';
    let filtered = rawCustomers.filter(c => (c[0] && c[0].toLowerCase().includes(filterText)) || (c[1] && c[1].toLowerCase().includes(filterText)) || (c[3] && c[3].toString().toLowerCase().includes(filterText)) );
    
    if (filtered.length === 0) { tbody = '<tr><td colspan="5" class="text-center text-muted py-4">ไม่พบข้อมูลลูกค้าในระบบ</td></tr>'; } 
    else {
        filtered.forEach((c) => {
            let safeData = encodeURIComponent(JSON.stringify({ oldShort: c[0] || '', oldFull: c[1] || '', shortName: c[0] || '', fullName: c[1] || '', address: c[2] || '', taxId: c[3] || '', creditDays: c[4] || '', remark: c[5] || '' }));
            let sName = c[0] || ''; let fName = c[1] || ''; let safeOldShort = sName.replace(/'/g, "\\'"); let safeOldFull = fName.replace(/'/g, "\\'");
            tbody += `<tr><td class="fw-bold text-primary align-middle px-3">${sName || '<span class="text-muted fst-italic">ไม่มีชื่อย่อ</span>'}</td><td class="align-middle text-start text-wrap px-3" style="min-width: 250px;">${fName || '-'}<br><small class="text-muted"><i class="bi bi-geo-alt"></i> ${c[2] || 'ไม่ระบุที่อยู่'}</small></td><td class="align-middle px-3 text-secondary">${c[3] || '-'}</td><td class="align-middle px-3 text-success">${c[4] ? c[4] + ' วัน' : '-'}</td><td class="align-middle text-center"><button class="btn btn-sm btn-outline-primary rounded-circle px-2 me-1 shadow-sm" title="แก้ไข" onclick="editCustomerModal('${safeData}')"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger rounded-circle px-2 shadow-sm" title="ลบ" onclick="deleteCustomerModal('${safeOldShort}', '${safeOldFull}')"><i class="bi bi-trash"></i></button></td></tr>`;
        });
    }
    document.getElementById('customerTableBody').innerHTML = tbody;
}

async function addCustomerRecordJS() {
    let payload = {
        short_name: document.getElementById('newCustShort').value.trim(), full_name: document.getElementById('newCustFull').value.trim(),
        address: document.getElementById('newCustAddress').value.trim(), tax_id: parseInt(document.getElementById('newCustTax').value.trim()) || null,
        credit_days: parseInt(document.getElementById('newCustCredit').value.trim()) || 0, note: document.getElementById('newCustRemark').value.trim()
    };
    if (!payload.short_name && !payload.full_name) return Swal.fire({icon: 'warning', text: 'กรุณาระบุชื่อย่อ หรือ ชื่อเต็มลูกค้า อย่างน้อย 1 ช่องครับ'});
    
    const { error } = await supabaseClient.from('customer').insert(payload);
    if(!error) {
        await writeLog("เพิ่มลูกค้า", `ชื่อ: ${payload.short_name || payload.full_name}`);
        let fields = ['newCustShort', 'newCustFull', 'newCustAddress', 'newCustTax', 'newCustCredit', 'newCustRemark']; fields.forEach(id => document.getElementById(id).value = '');
        await loadCustomerTable(); await loadPlanDataInitial(); 
        Swal.fire({icon: 'success', title: 'เพิ่มลูกค้าสำเร็จ!', timer: 1500, showConfirmButton: false});
    } else { Swal.fire({icon: 'error', text: error.message}); }
}

function editCustomerModal(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    const escapeHTML = str => (str||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    Swal.fire({
        title: 'แก้ไขข้อมูลลูกค้า', width: '700px', 
        html: `<div class="row g-2 text-start compact-form"><div class="col-12 col-md-4"><label class="small fw-bold text-muted mb-1">ชื่อย่อ</label><input type="text" id="editCustShort" class="form-control form-control-sm border-primary" value="${escapeHTML(data.shortName)}"></div><div class="col-12 col-md-8"><label class="small fw-bold text-muted mb-1">ชื่อเต็ม</label><input type="text" id="editCustFull" class="form-control form-control-sm" value="${escapeHTML(data.fullName)}"></div><div class="col-12"><label class="small fw-bold text-muted mb-1">ที่อยู่</label><textarea id="editCustAddress" class="form-control form-control-sm" rows="2">${escapeHTML(data.address)}</textarea></div><div class="col-12 col-md-4"><label class="small fw-bold text-muted mb-1">Tax ID</label><input type="number" id="editCustTax" class="form-control form-control-sm" value="${escapeHTML(data.taxId)}"></div><div class="col-12 col-md-4"><label class="small fw-bold text-muted mb-1">เครดิต (วัน)</label><input type="number" id="editCustCredit" class="form-control form-control-sm" value="${escapeHTML(data.creditDays)}"></div><div class="col-12 col-md-4"><label class="small fw-bold text-muted mb-1">หมายเหตุ</label><input type="text" id="editCustRemark" class="form-control form-control-sm" value="${escapeHTML(data.remark)}"></div></div>`,
        showCancelButton: true, confirmButtonText: '<i class="bi bi-floppy"></i> บันทึกแก้ไข', cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            let newShort = document.getElementById('editCustShort').value.trim(); let newFull = document.getElementById('editCustFull').value.trim();
            if(!newShort && !newFull) { Swal.showValidationMessage('ต้องระบุชื่อย่อ หรือ ชื่อเต็ม อย่างน้อย 1 ช่องครับ!'); return false; }
            return { short_name: newShort, full_name: newFull, address: document.getElementById('editCustAddress').value.trim(), tax_id: parseInt(document.getElementById('editCustTax').value.trim()) || null, credit_days: parseInt(document.getElementById('editCustCredit').value.trim()) || 0, note: document.getElementById('editCustRemark').value.trim() };
        }
    }).then(async (res) => {
        if (res.isConfirmed) {
            const { error } = await supabaseClient.from('customer').update(res.value).eq('short_name', data.oldShort).eq('full_name', data.oldFull);
            if(!error) { 
                await writeLog("แก้ไขลูกค้า", `อัปเดตข้อมูลลูกค้า: ${res.value.short_name || res.value.full_name}`);
                await loadCustomerTable(); await loadPlanDataInitial(); Swal.fire({icon: 'success', title: 'อัปเดตสำเร็จ!', timer: 1500, showConfirmButton: false}); 
            } 
            else { Swal.fire({icon: 'error', text: error.message}); }
        }
    });
}

function deleteCustomerModal(oldShort, oldFull) {
    let showName = oldShort || oldFull;
    Swal.fire({
        title: 'ยืนยันการลบลูกค้า', text: `คุณต้องการลบข้อมูลลูกค้า "${showName}" หรือไม่?`, icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: '<i class="bi bi-trash"></i> ใช่, ลบเลย'
    }).then(async (res) => {
        if (res.isConfirmed) {
            const { error } = await supabaseClient.from('customer').delete().eq('short_name', oldShort).eq('full_name', oldFull);
            if(!error) { 
                await writeLog("ลบลูกค้า", `ลบลูกค้า: ${showName}`);
                await loadCustomerTable(); await loadPlanDataInitial(); Swal.fire({icon: 'success', title: 'ลบสำเร็จ!', timer: 1500, showConfirmButton: false}); 
            } 
            else { Swal.fire({icon: 'error', text: error.message}); }
        }
    });
}

function openDeleteBookingModal() {
    let bkgMap = new Map();
    for (let i = 1; i < allData.length; i++) {
        let row = allData[i]; let bkgNo = row[6]; let customer = row[4]; let status = row[15];
        if (!bkgMap.has(bkgNo)) { bkgMap.set(bkgNo, { bkgNo: bkgNo, customer: customer, total: 0, pending: 0, running: 0, billed: 0 }); }
        let info = bkgMap.get(bkgNo); info.total++;
        if (status === 'รอจัดรถ') info.pending++; 
        else if (RUNNING_STATUSES.includes(status)) info.running++;
        else if (status === 'วางบิลแล้ว' || status === 'พร้อมวางบิล' || status === 'จบงานรอวางบิล') info.billed++; 
    }
    let html = '';
    if (bkgMap.size === 0) { html = '<tr><td colspan="5" class="text-center text-muted py-4">ไม่มีข้อมูล Booking ในระบบ</td></tr>'; } 
    else {
        bkgMap.forEach((info, bkgNo) => {
            let deleteBtn = `<button class="btn btn-outline-danger btn-sm rounded-pill px-3 fw-bold shadow-sm" onclick="confirmDeleteBooking('${info.bkgNo}')"><i class="bi bi-trash"></i> ลบทั้งหมด</button>`;
            if(info.billed > 0) deleteBtn = `<span class="badge bg-secondary">ลบไม่ได้ (ส่งบัญชี/จบงานแล้ว)</span>`; 
            html += `<tr class="delete-row-item"><td class="align-middle fw-bold text-primary fs-6">${info.bkgNo}</td><td class="align-middle text-secondary">${info.customer}</td><td class="align-middle text-center"><span class="badge bg-secondary rounded-pill px-3 fs-6 shadow-sm">${info.total} ใบ</span></td><td class="align-middle"><div class="small fw-bold text-warning mb-1"><i class="bi bi-clock"></i> รอจัด: ${info.pending}</div><div class="small fw-bold text-success"><i class="bi bi-truck"></i> วิ่งงาน: ${info.running}</div></td><td class="align-middle text-center">${deleteBtn}</td></tr>`;
        });
    }
    document.getElementById('searchDeleteModal').value = ''; document.getElementById('deleteBookingBody').innerHTML = html;
    new bootstrap.Modal(document.getElementById('deleteBookingModal')).show();
}

function debouncedFilterDeleteModal() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        let input = document.getElementById("searchDeleteModal").value.toLowerCase();
        let rows = document.querySelectorAll(".delete-row-item");
        rows.forEach(row => { let text = row.innerText.toLowerCase(); row.style.display = text.includes(input) ? "" : "none"; });
    }, 400);
}

function confirmDeleteBooking(bkgNo) {
    Swal.fire({ title: 'ยืนยันการลบ Booking?', html: `คุณกำลังจะลบตู้ทั้งหมดของ<br><b class="fs-5 text-danger">${bkgNo}</b><br>ใช่หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#6c757d', confirmButtonText: '<i class="bi bi-trash"></i> ใช่, ลบทั้งหมด!', cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            showGlobalLoader('กำลังลบข้อมูล...');
            const { error } = await supabaseClient.from('plan_data').delete().eq('booking', bkgNo);
            if (!error) { 
                await writeLog("ลบ Booking (ยกล็อต)", `ลบ Booking No: ${bkgNo}`);
                bootstrap.Modal.getInstance(document.getElementById('deleteBookingModal')).hide(); await loadPlanData(true); 
                hideGlobalLoader(); Swal.fire({ icon: 'success', title: 'ลบสำเร็จ!', timer: 1500, showConfirmButton: false }); 
            } else { 
                hideGlobalLoader(); Swal.fire({ icon: 'error', text: error.message }); 
            }
        }
    });
}