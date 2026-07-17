const SUPABASE_URL = 'https://ddjcwswzodkdzjfksmqm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkamN3c3d6b2RrZHpqZmtzbXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NzM0OTAsImV4cCI6MjA5ODA0OTQ5MH0.lLgqwVakZMJqrj-YuR7sCAlqrMp5pSA-ayUMXuvF3ro'; 
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let activeVhvSession = { name: '', role: '', vhvId: '', logo: '', moo: 0, community: '' };
let masterHealthRules = []; 
let populationDataset = [];
let displayFilteredDataset = [];
let masterVhvPerformanceList = [];
let masterTargetMgList = [];
let filteredTargetMgList = [];
let masterReportList = [];
let masterLogList = []; 
let masterUserAccountsDataset = []; 

let tableCurrentPage = 1;
let perfCurrentPage = 1;
let tgtMgCurrentPage = 1;
let reportCurrentPage = 1;
let logsCurrentPage = 1; 

const rowsPerPageLimit = 10;
let failedLoginAttemptsCount = 0;
let bootstrapUserModalInstance;

let tableSearchDebounceTimeout;
let targetMgSearchDebounceTimeout;
let dashChartInstance = null; // ตัวแปรคุมกราฟ Chart.js

/* [Audit Log System] ฟังก์ชันส่วนกลางสำหรับบันทึกประวัติการเข้าถึงและการปรับปรุงแก้ไขข้อมูลตามหลัก PDPA */
async function insertAuditLog(action, tableName, recordId, details = '') {
  try {
    const logPayload = {
      operator_name: activeVhvSession.name || 'System/Unauthenticated',
      operator_role: activeVhvSession.role || 'Unknown',
      action: action,
      table_name: tableName,
      record_id: recordId ? recordId.toString() : '-',
      details: typeof details === 'object' ? JSON.stringify(details) : details
    };
    await db.from('logs').insert([logPayload]);
  } catch (err) {
    console.error('[Log Error] ไม่สามารถบันทึก Audit Log เข้าสู่ระบบได้:', err);
  }
}

async function supabaseSelectAll(tableName, columns = '*', applyFiltersFn = null) {
  let allRecords = []; let startRange = 0; const batchSize = 1000; let keepGoing = true;
  while (keepGoing) {
    let query = db.from(tableName).select(columns).range(startRange, startRange + batchSize - 1);
    if (applyFiltersFn) { query = applyFiltersFn(query); }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) { keepGoing = false; } 
    else {
      allRecords = allRecords.concat(data);
      if (data.length < batchSize) { keepGoing = false; } 
      else { startRange += batchSize; } 
    }
  }
  return allRecords;
}

function toggleSidebarMenuForPcDevice() {
  const menu = document.getElementById('sidebarMenu');
  const frame = document.getElementById('mainContentArea');
  if (menu && frame) { menu.classList.toggle('collapsed-pc'); frame.classList.toggle('expanded-pc'); }
}

function toggleLoaderDisplay(isShowing) {
  const loader = document.getElementById('globalLoader'); if (!loader) return;
  if (isShowing) { loader.classList.remove('d-none'); } else { loader.classList.add('d-none'); }
}

function safetySetInputValue(id, val) { const el = document.getElementById(id); if (el) { el.value = val; } }
function safetySetTextContent(id, txt) { const el = document.getElementById(id); if (el) { el.innerText = txt; } }

window.addEventListener('load', function() {
  const modalEl = document.getElementById('userManagementModal');
  if (modalEl) bootstrapUserModalInstance = new bootstrap.Modal(modalEl);
  const savedLogo = localStorage.getItem('agencyLogoUrl') || 'https://cdn-icons-png.flaticon.com/512/822/822118.png';
  const img = document.getElementById('loginDisplayLogo'); if (img) img.src = savedLogo;
});

const btnToggle = document.getElementById('btnTogglePassword');
if (btnToggle) {
  btnToggle.addEventListener('click', function() {
    const pwd = document.getElementById('password'); const eye = document.getElementById('eyeIcon'); if (!pwd || !eye) return;
    if (pwd.type === 'password') { pwd.type = 'text'; eye.className = 'fa-solid fa-eye-slash fs-4'; }
    else { pwd.type = 'password'; eye.className = 'fa-solid fa-eye fs-4'; }
  });
}

function changeViewWindow(targetView) {
  document.querySelectorAll('.sub-view-panel').forEach(view => view.classList.add('d-none'));
  document.querySelectorAll('#sidebarMenu .nav-link').forEach(link => link.classList.remove('active'));
  const targetEl = document.getElementById(`view-window-${targetView}`); if (targetEl) targetEl.classList.remove('d-none');
  const menuBtn = document.getElementById(`btn-view-${targetView}`); if (menuBtn) menuBtn.classList.add('active');
  const sidebar = document.getElementById('sidebarMenu'); if (sidebar && sidebar.classList.contains('show')) { sidebar.classList.remove('show'); }
  window.scrollTo(0, 0);
  if (targetView === 'dash') { fetchDashboardCountsFromServer(); }
  else if (targetView === 'list') { fetchPopulationListFromServer(); }
  else if (targetView === 'rules') { renderHealthRulesTable(); }
  else if (targetView === 'perf') { fetchVhvPerformanceReportFromServer(); }
  else if (targetView === 'mgtgt') { fetchManagementTargetsFromServer(); }
  else if (targetView === 'mgusr') { fetchUserAccountsFromServer(); } 
  else if (targetView === 'report') { fetchScreeningReportDataFromServer(); }
  else if (targetView === 'logs') { fetchLogDataFromServer(); } 
}

async function executeLogin(e) {
  e.preventDefault();
  if (failedLoginAttemptsCount >= 5) { Swal.fire({ icon: 'error', title: 'ระบบระงับชั่วคราว', text: 'กรอกรหัสผ่านผิดเกิน 5 ครั้ง บัญชีโดนระงับความปลอดภัยอัตโนมัติ' }); return; }
  toggleLoaderDisplay(true); const u = document.getElementById('username').value.trim(); const p = document.getElementById('password').value.trim();
  try {
    const { data: users, error } = await db.from('users').select('*').eq('username', u).eq('password', p);
    if (error || !users || users.length === 0) {
      toggleLoaderDisplay(false); failedLoginAttemptsCount++;
      if (failedLoginAttemptsCount >= 5) {
        document.getElementById('username').disabled = true; document.getElementById('password').disabled = true;
        document.querySelector('#loginForm button[type="submit"]').disabled = true;
        Swal.fire({ icon: 'error', title: 'บัญชีระบบโดนล็อก', text: 'กรอกรหัสผ่านผิดกำหนด 5 ครั้ง บัญชีถูกล็อกถาวรแล้วครับ' });
      } else { Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ถูกต้อง', text: `กรุณาเช็กชื่อผู้ใช้หรือรหัสผ่านอีกครั้ง (เหลือสิทธิ์พยายามอีก ${5 - failedLoginAttemptsCount} ครั้ง)` }); }
      return;
    }
    const user = users[0]; const { data: rules } = await db.from('rules').select('*'); masterHealthRules = rules || [];
    failedLoginAttemptsCount = 0; const currentLogo = localStorage.getItem('agencyLogoUrl') || 'https://cdn-icons-png.flaticon.com/512/822/822118.png';
    
    activeVhvSession = { 
      name: user.full_name, 
      role: user.role, 
      vhvId: user.pid_vhv, 
      logo: currentLogo,
      moo: parseInt(user.moo) || 0,
      community: user.community || ''
    };
    
    safetySetTextContent('sessionUserName', `คุณ ${user.full_name}`); safetySetTextContent('sessionUserRole', `สิทธิ์บัญชี: ${user.role} (รหัส อสม: ${user.pid_vhv || '-'})`);
    const headerLogo = document.getElementById('menuHeaderLogo'); if (headerLogo) headerLogo.src = currentLogo; safetySetInputValue('inputAgencyLogoUrl', currentLogo);
    if (user.role === 'admin') { document.querySelectorAll('.admin-staff-only').forEach(el => el.classList.remove('d-none')); document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('d-none')); } 
    else if (user.role === 'staff') { document.querySelectorAll('.admin-staff-only').forEach(el => el.classList.remove('d-none')); document.querySelectorAll('.admin-only').forEach(el => el.classList.add('d-none')); } 
    else { document.querySelectorAll('.admin-staff-only').forEach(el => el.classList.add('d-none')); document.querySelectorAll('.admin-only').forEach(el => el.classList.add('d-none')); }
    
    await insertAuditLog('USER_LOGIN', 'users', user.id, `ผู้ใช้งานเข้าสู่ระบบสิทธิ์ ${user.role}`);

    toggleLoaderDisplay(false); document.getElementById('loginSection').classList.add('d-none'); document.getElementById('mainInterface').classList.remove('d-none');
    Swal.fire({ icon: 'success', title: 'ยินดีต้อนรับเข้าใช้งาน', text: `เจ้าหน้าที่ระบบ: ${user.full_name}`, timer: 1500, showConfirmButton: false });
    changeViewWindow('dash');
  } catch (err) { toggleLoaderDisplay(false); Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); }
}

async function executeLogout() { 
  await insertAuditLog('USER_LOGOUT', 'users', '-', `ลงชื่อออกจากระบบงานคัดกรอง`);
  activeVhvSession = { name: '', role: '', vhvId: '', logo: '', moo: 0, community: '' }; 
  document.getElementById('loginForm').reset(); 
  document.getElementById('mainInterface').classList.add('d-none'); 
  document.getElementById('loginSection').classList.remove('d-none'); 
}

function compileSmartPaginationLinks(currentPage, totalItems, elementWrapperId, clickFunctionName) {
  const totalPages = Math.ceil(totalItems / rowsPerPageLimit) || 1; const wrapper = document.getElementById(elementWrapperId); if (!wrapper) return; wrapper.innerHTML = ''; if (totalPages <= 1) return;
  const prevLi = document.createElement('li'); prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
  prevLi.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="${currentPage === 1 ? 'return false;' : clickFunctionName + '(' + (currentPage - 1) + ')'}">ก่อนหน้า</a>`; wrapper.appendChild(prevLi);
  let startPage = Math.max(1, currentPage - 2); let endPage = Math.min(totalPages, startPage + 4); if (endPage - startPage < 4) { startPage = Math.max(1, endPage - 4); }
  for (let i = startPage; i <= endPage; i++) {
    const li = document.createElement('li'); li.className = `page-item ${currentPage === i ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="${clickFunctionName}(${i})">${i}</a>`; wrapper.appendChild(li);
  }
  const nextLi = document.createElement('li'); nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
  nextLi.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="${currentPage === totalPages ? 'return false;' : clickFunctionName + '(' + (currentPage + 1) + ')'}">ถัดไป</a>`; wrapper.appendChild(nextLi);
}

function shiftTablePage(num) { const maxPage = Math.ceil(displayFilteredDataset.length / rowsPerPageLimit) || 1; tableCurrentPage = Math.max(1, Math.min(num, maxPage)); renderPopulationTableElements(); }
function shiftPerfPage(num) { const maxPage = Math.ceil(masterVhvPerformanceList.length / rowsPerPageLimit) || 1; perfCurrentPage = Math.max(1, Math.min(num, maxPage)); renderVhvPerformanceTable(); }
function shiftTgtMgPage(num) { const maxPage = Math.ceil(filteredTargetMgList.length / rowsPerPageLimit) || 1; tgtMgCurrentPage = Math.max(1, Math.min(num, maxPage)); renderTargetMgTable(); }
function shiftReportPage(num) { const maxPage = Math.ceil(masterReportList.length / rowsPerPageLimit) || 1; reportCurrentPage = Math.max(1, Math.min(num, maxPage)); renderReportTable(); }
function shiftLogsPage(num) { const maxPage = Math.ceil(masterLogList.length / rowsPerPageLimit) || 1; logsCurrentPage = Math.max(1, Math.min(num, maxPage)); renderLogTable(); }

async function fetchDashboardCountsFromServer() {
  try {
    // 1. ดึงข้อมูล "ทั้งหมด" มาเพื่อคำนวณกราฟและตารางเปรียบเทียบ (ปลอดภัยเพราะดึงเฉพาะ PID/ชุมชน)
    const allDataRows = await supabaseSelectAll('data', 'pid, vhv_pid, moo, community');
    
    // 2. แยกข้อมูล "เฉพาะของตนเอง" เพื่อไปแสดงใน 4 การ์ดสรุปผลด้านบน
    const myDataRows = (activeVhvSession.role === 'user') 
      ? allDataRows.filter(r => r.vhv_pid && r.vhv_pid.toString() === activeVhvSession.vhvId.toString())
      : allDataRows;

    const assignedCount = myDataRows.length;
    const assignedPids = myDataRows.map(r => r.pid.toString());
    
    const screenRows = await supabaseSelectAll('screening', '*');
    
    // กรองผลคัดกรองเฉพาะของตนเองสำหรับการ์ดสรุป
    const filteredScreenings = (screenRows || []).filter(s => assignedPids.includes(s.citizen_id.toString()));
    
    // คำนวณสรุปการ์ดส่วนตัว
    let normalCount = 0, riskCount = 0, alertCount = 0, totalSmokerCount = 0, totalDrinkerCount = 0;
    filteredScreenings.forEach(item => {
      if (item.smoking && item.smoking.includes('สูบ') && !item.smoking.includes('ไม่สูบ')) totalSmokerCount++;
      if (item.alcohol && item.alcohol.includes('ดื่ม') && !item.alcohol.includes('ไม่ดื่ม')) totalDrinkerCount++;
      if (item.ncd_status.includes('แดง') || item.ncd_status.includes('สงสัย')) alertCount++;
      else if (item.ncd_status.includes('เหลือง') || item.ncd_status.includes('เสี่ยง')) riskCount++;
      else if (item.ncd_status.includes('เขียว') || item.ncd_status.includes('ปกติ')) normalCount++;
    });

    // อัปเดตการ์ดสรุปยอด
    safetySetTextContent('stat-total-count', assignedCount); 
    safetySetTextContent('stat-normal-count', normalCount); 
    safetySetTextContent('stat-risk-count', riskCount); 
    safetySetTextContent('stat-alert-count', alertCount); 
    safetySetTextContent('stat-screened-count', filteredScreenings.length); 
    safetySetTextContent('stat-smoker-count', totalSmokerCount); 
    safetySetTextContent('stat-drinker-count', totalDrinkerCount);
    let progress = ((filteredScreenings.length / (assignedCount || 1)) * 100).toFixed(1); 
    safetySetTextContent('stat-progress-percent', progress + '%');

    // =========================================================================
    // กราฟและตารางเปรียบเทียบ 16 ชุมชน (แสดงให้ทุกคนเห็น เพื่อให้เกิดการแข่งขัน)
    // =========================================================================
    const commStats = {};
    allDataRows.forEach(r => {
      let rawComm = r.community ? r.community.trim() : "ไม่ได้ระบุชุมชน";
      let commName = rawComm.startsWith("ชุมชน") ? rawComm : `ชุมชน${rawComm}`;
      if (!commStats[commName]) commStats[commName] = { target: 0, done: 0 };
      commStats[commName].target++;
    });

    const screenedPidsSet = new Set(screenRows.map(s => s.citizen_id.toString()));
    allDataRows.forEach(r => {
      if (screenedPidsSet.has(r.pid.toString())) {
        let rawComm = r.community ? r.community.trim() : "ไม่ได้ระบุชุมชน";
        let commName = rawComm.startsWith("ชุมชน") ? rawComm : `ชุมชน${rawComm}`;
        if (commStats[commName]) commStats[commName].done++;
      }
    });

    const chartLabels = [], chartData = [];
    const tbody = document.getElementById('communityProgressTableBody'); 
    if (tbody) {
      tbody.innerHTML = '';
      Object.keys(commStats).sort().forEach(comm => {
        const { target, done } = commStats[comm];
        const percent = target > 0 ? ((done / target) * 100).toFixed(1) : "0.0";
        chartLabels.push(comm); chartData.push(percent);
        tbody.innerHTML += `<tr><td class="fw-bold">${comm}</td><td class="text-center">${target}</td><td class="text-center text-success">${done}</td><td class="text-center text-danger">${target - done}</td><td class="text-center">${percent}%</td></tr>`;
      });
    }

    const ctx = document.getElementById('communityProgressChart');
    if (ctx) {
      if (window.dashChartInstance) window.dashChartInstance.destroy(); 
      window.dashChartInstance = new Chart(ctx, { 
        type: 'bar', 
        data: { labels: chartLabels, datasets: [{ data: chartData, backgroundColor: 'rgba(14, 165, 233, 0.8)' }] }, 
        options: { responsive: true, maintainAspectRatio: false } 
      });
    }

    // ตารางผลงานรายบุคคลของ User (แสดงเฉพาะคนที่ล็อกอินเป็น User)
    const userTableContainer = document.getElementById('userDashboardTableContainer');
    if (userTableContainer) {
      if (activeVhvSession.role === 'user') {
        userTableContainer.classList.remove('d-none');
        const tbody = document.getElementById('dashboardSummaryTableBody');
        if (tbody) {
          tbody.innerHTML = '';
          filteredScreenings.forEach(item => {
            let bClass = item.ncd_status.includes('แดง') ? "bg-danger" : (item.ncd_status.includes('เหลือง') ? "bg-warning" : "bg-success");
            tbody.innerHTML += `<tr><td>${item.name}</td><td><span class="badge ${bClass}">${item.ncd_status}</span></td><td>${item.bmi || '-'}</td><td>${item.bp_status}</td><td>${item.fbs_status}</td><td>${item.cvd_risk}</td></tr>`;
          });
        }
      } else {
        userTableContainer.classList.add('d-none');
      }
    }

  } catch (err) { console.error("Error:", err); }
}

async function fetchPopulationListFromServer() {
  toggleLoaderDisplay(true);
  try {
    const dataRows = await supabaseSelectAll('data', '*', (q) => { 
      if (activeVhvSession.role === 'user') { 
        return q.eq('vhv_pid', activeVhvSession.vhvId);
      } else if (activeVhvSession.role === 'staff') {
        let query = q.eq('moo', activeVhvSession.moo);
        if (activeVhvSession.community && activeVhvSession.community.trim() !== "") {
          query = query.eq('community', activeVhvSession.community);
        }
        return query;
      } 
      return q; 
    });
    const screenRows = await supabaseSelectAll('screening', '*');
    populationDataset = (dataRows || []).map(r => {
      const s = (screenRows || []).find(sc => sc.citizen_id.toString() === r.pid.toString());
      let statusStr = "ยังไม่ได้คัดกรองปีนี้"; if (s) { statusStr = s.ncd_status; }
      
      let cleanComm = r.community ? r.community.trim() : "";
      let communityStr = "";
      if (cleanComm !== "") {
        communityStr = cleanComm.startsWith("ชุมชน") ? ` ${cleanComm}` : ` ชุมชน${cleanComm}`;
      }
      
      return {
        pid: r.pid, name: r.full_name, age: r.age, gender: r.gender,
        address: `บ้านเลขที่ ${r.house_no || '-'} ม.${r.moo}${communityStr}`,
        last_screening_status: statusStr, history_ht: r.history_ht || '-', history_dm: r.history_dm || '-',
        old_weight: r.weight || '-', old_height: r.height || '-', old_waist: r.waist || '-',
        screen_id: s ? s.id : '', screen_weight: s ? s.weight : '', screen_height: s ? s.height : '',
        screen_waist: s ? s.waist : '', screen_sbp: s ? s.bp_sys : '', screen_dbp: s ? s.bp_dia : '',
        screen_bsl: s ? s.fbs : '', screen_smoking: s ? s.smoking : 'ไม่สูบ',
        screen_alcohol: s ? s.alcohol : 'ไม่ดื่ม', screen_exercise: s ? s.exercise : 'เพียงพอ'
      };
    });
    toggleLoaderDisplay(false); executeTableFilter(false);
  } catch (err) { toggleLoaderDisplay(false); Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); }
}

function executeTableFilter(isFromUserInput = false) {
  clearTimeout(tableSearchDebounceTimeout);
  tableSearchDebounceTimeout = setTimeout(() => {
    const q = document.getElementById('inputSearchQuery').value.toLowerCase(); const st = document.getElementById('selectFilterStatus').value;
    displayFilteredDataset = populationDataset.filter(r => { return (r.name.toLowerCase().includes(q) || r.pid.toString().includes(q)) && (st === "" || r.last_screening_status.includes(st)); });
    if (isFromUserInput) { tableCurrentPage = 1; }
    const maxPage = Math.ceil(displayFilteredDataset.length / rowsPerPageLimit) || 1; tableCurrentPage = Math.max(1, Math.min(tableCurrentPage, maxPage)); renderPopulationTableElements();
  }, 300);
}

function renderPopulationTableElements() {
  const tbody = document.getElementById('populationTableBody'); if (!tbody) return; tbody.innerHTML = '';
  if (displayFilteredDataset.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted fs-4">ไม่พบรายชื่อประชากร</td></tr>'; safetySetTextContent('labelTablePaginationInfo', 'แสดงข้อมูล 0 รายการ');
    const pWrapper = document.getElementById('paginationWrapper'); if (pWrapper) pWrapper.innerHTML = ''; return;
  }
  const st = (tableCurrentPage - 1) * rowsPerPageLimit; const ed = Math.min(st + rowsPerPageLimit, displayFilteredDataset.length); const slice = displayFilteredDataset.slice(st, ed);
  slice.forEach(item => {
    let bStyle = "bg-secondary"; let bLabel = `<i class="fa fa-stethoscope"></i> เริ่มคัดกรอง`; let bClass = "btn-primary";
    if (item.last_screening_status.includes('เขียว') || item.last_screening_status.includes('ปกติ')) { bStyle = "bg-success"; bLabel = `<i class="fa fa-edit"></i> แก้ไขข้อมูล`; bClass = "btn-warning text-dark"; }
    else if (item.last_screening_status.includes('เหลือง') || item.last_screening_status.includes('เสี่ยง')) { bStyle = "bg-warning text-dark"; bLabel = `<i class="fa fa-edit"></i> แก้ไขข้อมูล`; bClass = "btn-warning text-dark"; }
    else if (item.last_screening_status.includes('แดง') || item.last_screening_status.includes('สงสัย')) { bStyle = "bg-danger"; bLabel = `<i class="fa fa-edit"></i> แก้ไขข้อมูล`; bClass = "btn-warning text-dark"; }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td data-label="ทะเบียน PID">${item.pid}</td><td data-label="ชื่อ - นามสกุล" class="fs-3 text-primary">${item.name}</td><td data-label="อายุ">${item.age} ปี</td><td data-label="ที่อยู่ปัจจุบัน" class="small text-muted">${item.address}</td><td data-label="ผลตรวจปีนี้"><span class="badge ${bStyle} fs-5">${item.last_screening_status}</span></td><td data-label="กดคัดกรอง" class="text-center w-100"><button class="btn ${bClass} btn-lg rounded-pill px-4 w-100" onclick="openScreeningFormWindow('${item.pid}')">${bLabel}</button></td>`; tbody.appendChild(tr);
  });
  safetySetTextContent('labelTablePaginationInfo', `แสดงรายการที่ ${st + 1} ถึง ${ed} จากทั้งหมด ${displayFilteredDataset.length} คน`); compileSmartPaginationLinks(tableCurrentPage, displayFilteredDataset.length, 'paginationWrapper', 'shiftTablePage');
}

function openScreeningFormWindow(pid) {
  const citizen = populationDataset.find(c => c.pid.toString() === pid.toString()); if (!citizen) return;
  const form = document.getElementById('ncdForm'); if (form) form.reset(); changeViewWindow('form');
  
  safetySetInputValue('form_pid', citizen.pid); 
  safetySetInputValue('form_name', citizen.name); 
  safetySetInputValue('form_age', citizen.age); 
  safetySetInputValue('form_gender', citizen.gender);
  safetySetTextContent('form_hist_ht', citizen.history_ht); 
  safetySetTextContent('form_hist_dm', citizen.history_dm);
  safetySetTextContent('label_old_weight', `(ค่าตรวจเดิม: ${citizen.old_weight} กก.)`); 
  safetySetTextContent('label_old_height', `(ค่าตรวจเดิม: ${citizen.old_height} ซม.)`); 
  safetySetTextContent('label_old_waist', `(ค่าตรวจเดิม: ${citizen.old_waist} ซม.)`);
  
  const inWeightField = document.getElementById('in_weight'); const inHeightField = document.getElementById('in_height'); const inWaistField = document.getElementById('in_waist');
  if (inWeightField) inWeightField.placeholder = "0.0"; if (inWaistField) inWaistField.placeholder = "0.0"; if (inHeightField) inHeightField.placeholder = "0.0";

  // ฟังก์ชันตั้งค่า Dropdown ที่ทนทานต่อการเว้นวรรคผิดพลาด
  const autoSelectDropdown = (selectId, dbText) => {
    const el = document.getElementById(selectId);
    if (!el || !dbText) return;
    const cleanDbText = dbText.replace(/\s+/g, ''); // ลบเว้นวรรคทิ้งให้หมดก่อนเทียบ
    for (let i = 0; i < el.options.length; i++) {
        const cleanOptionText = el.options[i].value.replace(/\s+/g, '');
        if (cleanDbText.includes(cleanOptionText)) {
            el.value = el.options[i].value;
            break;
        }
    }
  };

  if (citizen.screen_id && citizen.screen_id !== "") {
    safetySetInputValue('form_record_id', citizen.screen_id); 
    safetySetInputValue('in_weight', citizen.screen_weight); 
    safetySetInputValue('in_height', citizen.screen_height); 
    safetySetInputValue('in_waist', citizen.screen_waist); 
    safetySetInputValue('in_sbp', citizen.screen_sbp); 
    safetySetInputValue('in_dbp', citizen.screen_dbp); 
    safetySetInputValue('in_bsl', citizen.screen_bsl);
    
    // 1. การสูบบุหรี่
    if (citizen.screen_smoking.includes("ไม่สูบ")) { 
      if(document.getElementById('sm_no')) document.getElementById('sm_no').click(); 
    } else { 
      if(document.getElementById('sm_yes')) document.getElementById('sm_yes').click(); 
      autoSelectDropdown('sel_freq_smoke', citizen.screen_smoking);
    }

    // 2. การดื่มสุรา
    if (citizen.screen_alcohol.includes("ไม่ดื่ม")) { 
      if(document.getElementById('alc_no')) document.getElementById('alc_no').click(); 
    } else { 
      if(document.getElementById('alc_yes')) document.getElementById('alc_yes').click(); 
      autoSelectDropdown('sel_freq_alc', citizen.screen_alcohol);
    }

    // 3. การออกกำลังกาย
    if (citizen.screen_exercise.includes("ไม่เพียงพอ") || citizen.screen_exercise.includes("ไม่ได้ออก")) { 
      if(document.getElementById('ex_low')) document.getElementById('ex_low').click(); 
      autoSelectDropdown('sel_freq_ex', citizen.screen_exercise);
    } else { 
      if(document.getElementById('ex_ok')) document.getElementById('ex_ok').click(); 
    }
  } else { 
    safetySetInputValue('form_record_id', ""); 
    safetySetInputValue('in_weight', ""); 
    safetySetInputValue('in_waist', ""); 
    safetySetInputValue('in_height', citizen.old_height || ""); 
    
    // ค่าเริ่มต้น (Default) บังคับให้เปลี่ยนสีปุ่มทันที
    if(document.getElementById('sm_no')) document.getElementById('sm_no').click();
    if(document.getElementById('alc_no')) document.getElementById('alc_no').click();
    if(document.getElementById('ex_low')) document.getElementById('ex_low').click(); // เริ่มต้นที่ "ไม่เพียงพอ" เสมอ
  }
  
  toggleBehaviorFreqPanel('smoke'); 
  toggleBehaviorFreqPanel('alc'); 
  toggleBehaviorFreqPanel('ex');
  attachRealtimeClinicalCalculationListeners(); 
  runClinicalEvaluationEngine();
  
  setTimeout(function() { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, 80);
}

function attachRealtimeClinicalCalculationListeners() {
  document.querySelectorAll('.calc-hook').forEach(el => { 
    el.removeEventListener('input', runClinicalEvaluationEngine); 
    el.addEventListener('input', runClinicalEvaluationEngine); 
  });
  document.querySelectorAll('input[type="radio"]').forEach(el => { 
    el.removeEventListener('change', runClinicalEvaluationEngine); 
    el.addEventListener('change', runClinicalEvaluationEngine); 
  });
}

function runClinicalEvaluationEngine() {
  const wEl = document.getElementById('in_weight'); const hEl = document.getElementById('in_height'); const sbpEl = document.getElementById('in_sbp'); const dbpEl = document.getElementById('in_dbp'); const bslEl = document.getElementById('in_bsl'); const waistEl = document.getElementById('in_waist');
  const ageEl = document.getElementById('form_age'); const genderEl = document.getElementById('form_gender'); if (!wEl || !hEl || !sbpEl || !dbpEl || !bslEl || !waistEl) return;
  
  const w = parseFloat(wEl.value) || 0; const h = parseFloat(hEl.value) || 0; const sbp = parseInt(sbpEl.value) || 0; const dbp = parseInt(dbpEl.value) || 0; const bsl = parseInt(bslEl.value) || 0; const waist = parseFloat(waistEl.value) || 0;
  const age = parseInt(ageEl ? ageEl.value : 0) || 0; const gender = (genderEl ? genderEl.value : 'ชาย').trim();

  let bmiVal = 0; let bmiDisp = "-"; let bRule = null;
  if (w > 0 && h > 0) { bmiVal = w / Math.pow(h / 100, 2); bmiDisp = bmiVal.toFixed(2); bRule = masterHealthRules.find(r => r.category==='BMI' && bmiVal>=parseFloat(r.min_value) && bmiVal<=parseFloat(r.max_value)); }
  const bmiTextString = bmiDisp + (bRule ? ` (${bRule.result})` : ''); safetySetTextContent('rt-bmi', bmiTextString); safetySetTextContent('share-bmi', bmiTextString);

  let bpStat = "รอกรอกตัวเลข"; let bpColor = "bg-secondary";
  if (sbp > 0 || dbp > 0) {
    if (sbp >= 180 || dbp >= 110) { bpStat = "สูงวิกฤต (Stage 3)"; bpColor = "bg-danger"; }
    else if (sbp >= 160 || dbp >= 100) { bpStat = "สูงอันตราย (Stage 2)"; bpColor = "bg-danger"; }
    else if (sbp >= 140 || dbp >= 90) { bpStat = "ความดันโลหิตสูง (Stage 1)"; bpColor = "bg-warning text-dark"; }
    else if (sbp >= 120 || dbp >= 80) { bpStat = "ค่อนข้างสูง (Pre-HT)"; bpColor = "bg-warning text-dark"; }
    else { bpStat = "ปกติ (Normal)"; bpColor = "bg-success"; }
  }
  safetySetTextContent('rt-bp', bpStat); safetySetTextContent('share-bp', bpStat);
  const bpBadge = document.getElementById('rt-bp'); if (bpBadge) bpBadge.className = `badge fs-5 px-3 py-2 ${bpColor}`;

  let dmStat = "รอกรอกตัวเลข"; let dmColor = "bg-secondary"; let dmRule = masterHealthRules.find(r => r.category==='FBS' && bsl>=parseFloat(r.min_value) && bsl<=parseFloat(r.max_value));
  if (bsl > 0) { if(dmRule){ dmStat = dmRule.risk_level; dmColor = dmRule.color==='success'?'bg-success':(dmRule.color==='warning'?'bg-warning text-dark':'bg-danger'); }}
  safetySetTextContent('rt-bsl', dmStat); safetySetTextContent('share-bsl', dmStat);
  const dmBadge = document.getElementById('rt-bsl'); if (dmBadge) dmBadge.className = `badge fs-5 px-3 py-2 ${dmColor}`;

  let waistLimit = (gender === 'ชาย' || gender === 'Male') ? 90 : 80;
  let isObese = (waist > waistLimit);

  let cvdStat = "รอกรอกตัวเลข"; let cvdColor = "bg-secondary"; const cvdBadge = document.getElementById('rt-cvd');
  if (age >= 35 && sbp > 0) {
    let isSmoker = document.getElementById('sm_yes') && document.getElementById('sm_yes').checked; let isDM = (bsl >= 126);
    let cvdPoints = 0;
    if (gender === 'ชาย' || gender === 'Male') { if (age >= 65) cvdPoints += 4; else if (age >= 55) cvdPoints += 3; else if (age >= 45) cvdPoints += 2; else cvdPoints += 1; } 
    else { if (age >= 65) cvdPoints += 3; else if (age >= 55) cvdPoints += 2; else if (age >= 45) cvdPoints += 1; }
    if (isSmoker) cvdPoints += 2; if (isDM) cvdPoints += 3; if (isObese) cvdPoints += 1;
    if (sbp >= 180) cvdPoints += 4; else if (sbp >= 160) cvdPoints += 3; else if (sbp >= 140) cvdPoints += 2; else if (sbp >= 120) cvdPoints += 1;
    if (cvdPoints >= 10) { cvdStat = "เสี่ยงสูงมาก (>=30%)"; cvdColor = "bg-danger"; }
    else if (cvdPoints >= 8) { cvdStat = "เสี่ยงสูง (20-<30%)"; cvdColor = "bg-danger"; }
    else if (cvdPoints >= 6) { cvdStat = "เสี่ยงปานกลาง (10-<20%)"; cvdColor = "bg-warning text-dark"; }
    else { cvdStat = "เสี่ยงน้อย (<10%)"; cvdColor = "bg-success"; }
    safetySetTextContent('rt-cvd', cvdStat); safetySetTextContent('share-cvd', cvdStat); if (cvdBadge) cvdBadge.className = `badge fs-5 px-3 py-2 ${cvdColor}`;
  } else {
    cvdStat = age < 35 && sbp > 0 ? "เสี่ยงน้อย (<35 ปี)" : "รอกรอกตัวเลข"; cvdColor = age < 35 && sbp > 0 ? "bg-success" : "bg-secondary";
    safetySetTextContent('rt-cvd', cvdStat); safetySetTextContent('share-cvd', cvdStat); if (cvdBadge) cvdBadge.className = `badge fs-5 px-3 py-2 ${cvdColor}`;
  }

  let exTxt = ""; 
  if (waist > 0) {
    if (isObese) { exTxt += "<br>ดัชนีรอบเอว (" + gender + "): เกินเกณฑ์มาตรฐาน (รอบเอวคือ " + waist + " ซม. / ปกติต้องไม่เกิน " + waistLimit + " ซม.) มีภาวะอ้วนลงพุง"; } 
    else { exTxt += "<br>ดัชนีรอบเอว (" + gender + "): อยู่ในเกณฑ์ปลอดภัย (รอบเอวคือ " + waist + " ซม. / ปกติต้องไม่เกิน " + waistLimit + " ซม.)"; }
  }

  const box = document.getElementById('rt-summary-box'); const tSt = document.getElementById('rt-status-text'); const tAd = document.getElementById('rt-advice-text'); if (!box || !tSt || !tAd) return;
  if (sbp >= 140 || dbp >= 90 || bsl >= 126 || bpColor === 'bg-danger' || dmColor === 'bg-danger') {
    tSt.innerText = "กลุ่มสงสัยป่วยรายใหม่ (สีแดง)"; tAd.innerHTML = "<strong>คำแนะนำประเมินตนเอง:</strong> ผลตรวจสัญญาณชีพของท่านวันนี้สูงกว่าเกณฑ์ปกติ แนะนำให้ท่านงดกิจกรรมที่ใช้แรงหนัก หลีกเลี่ยงอาหารรสเค็มจัดหรือหวานจัดชั่วคราว และขอเชิญท่านเข้าพบเจ้าหน้าที่สาธารณสุข ณ อนามัย ภายในสัปดาห์นี้ เพื่อตรวจยืนยันความถูกต้องและรับคำแนะนำอย่างเหมาะสมต่อไปครับ" + exTxt;
    box.style.borderColor = "#dc2626"; box.style.backgroundColor = "#fee2e2"; tSt.className = "fw-black my-2 fs-2 text-danger";
  } else if (sbp >= 120 || dbp >= 80 || bsl >= 100 || bmiVal >= 23 || cvdColor.includes('warning')) {
    tSt.innerText = "กลุ่มเสี่ยงโรคเรื้อรัง (สีเหลือง)"; box.style.borderColor = "#ca8a04"; box.style.backgroundColor = "#fef9c3"; tSt.className = "fw-black my-2 fs-2 text-warning-dark";
    tAd.innerHTML = "<strong>คำแนะนำประเมินตนเอง:</strong> ร่างกายของท่านเริ่มส่งสัญญาณเตือนว่ามีความเสี่ยงต่อโรค NCDs แนะนำให้ปรับเปลี่ยนพฤติกรรมในชีวิตประจำวัน โดยลดการบริโภคอาหารรสหวาน มัน เค็ม เพิ่มการรับประทานผักผลไม้ และออกกำลังกายหรือแกว่งแขนอย่างน้อยวันละ 30 นาที แล้วอีก 6 เดือนมาติดตามดูระดับตัวเลขสุขภาพร่วมกับ อสม. อีกครั้งนะครับ" + exTxt;
  } else if (w > 0 && h > 0) {
    tSt.innerText = "กลุ่มปกติ สุขภาพดี (สีเขียว)"; box.style.borderColor = "#16a34a"; box.style.backgroundColor = "#dcfce7"; tSt.className = "fw-black my-2 fs-2 text-success";
    tAd.innerHTML = "<strong>คำแนะนำประเมินตนเอง:</strong> ยินดีด้วยครับ ผลการตรวจร่างกายโดยรวมของท่านอยู่ในเกณฑ์ปกติและสุขภาพแข็งแรงดีเยี่ยม ขอให้ท่านรักษาวินัยในการเลือกรับประทานอาหารที่มีประโยชน์และออกกำลังกายอย่างสม่ำเสมอแบบนี้ต่อไป และร่วมตรวจประเมินสุขภาพประจำปีกับ อสม. อีกครั้งในปีหน้านะครับ" + exTxt;
  } else { tSt.innerText = "ระบบรอคีย์ข้อมูล"; tAd.innerText = "กรอกตัวเลขเพื่อคำนวณผล"; box.style.borderColor = "#cbd5e0"; box.style.backgroundColor = "#f8f9fa"; tSt.className = "text-muted fs-4"; }
}

function toggleBehaviorFreqPanel(cat) {
  const smYes = document.getElementById('sm_yes'); const alcYes = document.getElementById('alc_yes'); const exLow = document.getElementById('ex_low');
  if (cat === 'smoke' && smYes) document.getElementById('panel_freq_smoke').classList.toggle('d-none', !smYes.checked);
  else if (cat === 'alc' && alcYes) document.getElementById('panel_freq_alc').classList.toggle('d-none', !alcYes.checked);
  else if (cat === 'ex' && exLow) document.getElementById('panel_freq_ex').classList.toggle('d-none', !exLow.checked);
}

async function submitFormScreeningData(e) {
  e.preventDefault(); 
  const form = document.getElementById('ncdForm'); 
  const wRaw = document.getElementById('in_weight').value; 
  const hRaw = document.getElementById('in_height').value; 
  const waistRaw = document.getElementById('in_waist').value; 
  const sbpRaw = document.getElementById('in_sbp').value; 
  const dbpRaw = document.getElementById('in_dbp').value; 
  const bslRaw = document.getElementById('in_bsl').value;
  
  if (wRaw === "" || hRaw === "" || waistRaw === "" || sbpRaw === "" || dbpRaw === "" || bslRaw === "") { 
    Swal.fire({ icon: 'error', title: 'ไม่สามารถบันทึกข้อมูลได้', text: 'กรุณากรอกข้อมูลสัญญาณชีพให้ครบถ้วนก่อนทำการบันทึกครับ!' }); 
    if (form) form.classList.add('was-validated'); 
    return; 
  }
  
  // แจ้งเตือนน้ำหนัก
  const weightVal = parseFloat(wRaw);
  if (isNaN(weightVal) || weightVal < 20 || weightVal > 300) {
    Swal.fire({ icon: 'warning', title: 'ค่าน้ำหนักผิดปกติ', text: 'ระบบตรวจพบน้ำหนักต่ำกว่า 20 กก. (หรือเกิน 300 กก.) โปรดตรวจสอบจุดทศนิยมหรือความถูกต้องอีกครั้งครับ' });
    return;
  }

  const sbp = parseInt(sbpRaw); const dbp = parseInt(dbpRaw); const bsl = parseInt(bslRaw);
  if (sbp<60 || sbp>200 || dbp<30 || dbp>120 || bsl<40 || bsl>600) { 
    Swal.fire({ icon: 'error', title: 'ตัวเลขคลาดเคลื่อน', text: 'ข้อมูลสัญญาณชีพผิดขอบเขตมาตรฐานสาธารณสุข โปรดตรวจทานอีกรอบครับ!' }); 
    return; 
  }
  
  let recId = document.getElementById('form_record_id').value; 
  const citizenIdVal = document.getElementById('form_pid').value; 
  if (!recId || recId === "") { recId = `SCR-${citizenIdVal}-${new Date().getTime()}`; }
  
  // ดึงค่าตัวเลือกให้ตรงตามปุ่มที่โดนคลิกเป๊ะๆ
  const finalSmoking = document.getElementById('sm_yes').checked ? `สูบ (${document.getElementById('sel_freq_smoke').value})` : "ไม่สูบ";
  const finalAlcohol = document.getElementById('alc_yes').checked ? `ดื่ม (${document.getElementById('sel_freq_alc').value})` : "ไม่ดื่ม";
  const finalExercise = document.getElementById('ex_low').checked ? `ไม่เพียงพอ (${document.getElementById('sel_freq_ex').value})` : "เพียงพอ";

  const payload = {
    id: recId, citizen_id: parseInt(citizenIdVal), name: document.getElementById('form_name').value, age: parseInt(document.getElementById('form_age').value), gender: document.getElementById('form_gender').value, weight: weightVal, height: parseFloat(hRaw), bmi: parseFloat(document.getElementById('rt-bmi').innerText) || 0, waist: parseFloat(waistRaw), bp_sys: sbp, bp_dia: dbp, bp_status: document.getElementById('rt-bp').innerText, fbs: bsl, fbs_status: document.getElementById('rt-bsl').innerText,
    smoking: finalSmoking, alcohol: finalAlcohol, exercise: finalExercise, cvd_risk: document.getElementById('rt-cvd').innerText, ncd_status: document.getElementById('rt-status-text').innerText, date: new Date().toLocaleDateString('th-TH'), operator: activeVhvSession.name
  };
  
  toggleLoaderDisplay(true); 
  try {
    const { error: screenErr } = await db.from('screening').upsert([payload]); if (screenErr) throw screenErr;
    await db.from('data').update({ screening_date: new Date().toISOString().split('T')[0], weight: weightVal, height: parseFloat(hRaw), waist: parseFloat(waistRaw), sbp: sbp, dbp: dbp, bsl: bsl, interpretation_ht: document.getElementById('rt-bp').innerText, interpretation_dm: document.getElementById('rt-bsl').innerText }).eq('pid', citizenIdVal);
    
    await insertAuditLog('UPSERT_SCREENING', 'screening', citizenIdVal, { name: payload.name, ncd_status: payload.ncd_status });

    toggleLoaderDisplay(false); 
    Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false }); 
    changeViewWindow('list'); 
  } catch (err) { 
    toggleLoaderDisplay(false); 
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); 
  }
}

function renderHealthRulesTable() {
  const tbody = document.getElementById('healthRulesTableBody'); if (!tbody) return; tbody.innerHTML = '';
  
  masterHealthRules.forEach(r => { 
    if(['BMI','BP','FBS'].indexOf(r.category) !== -1) { 
      tbody.innerHTML += `<tr><td data-label="ดัชนีชี้วัด"><span class="badge bg-primary fs-5 px-3 py-2">${r.category}</span></td><td data-label="ช่วงระดับเกณฑ์" class="fs-4">ช่วงค่า: ${r.min_value} - ${r.max_value}</td><td data-label="ผลการวิเคราะห์" class="fs-4 text-dark fw-bold">${r.result}</td><td data-label="แนวทางบอกต่อ" class="small text-muted fs-5">${r.advice}</td></tr>`; 
    } 
  });

  tbody.innerHTML += `
    <tr>
      <td data-label="ดัชนีชี้วัด"><span class="badge bg-info fs-5 px-3 py-2">รอบเอว (ชาย)</span></td>
      <td data-label="ช่วงระดับเกณฑ์" class="fs-4">ไม่เกิน 90 เซนติเมตร (หรือ ไม่เกิน ส่วนสูง / 2)</td>
      <td data-label="ผลการวิเคราะห์" class="fs-4 text-success fw-bold">ปกติ</td>
      <td data-label="แนวทางบอกต่อ" class="small text-muted fs-5">รอบเอวอยู่ในเกณฑ์ปลอดภัย ดัชนีรอบเอวสมส่วน ไม่มีความเสี่ยงภาวะอ้วนลงพุง</td>
    </tr>
    <tr>
      <td data-label="ดัชนีชี้วัด"><span class="badge bg-danger fs-5 px-3 py-2">รอบเอว (ชาย)</span></td>
      <td data-label="ช่วงระดับเกณฑ์" class="fs-4">ตั้งแต่ 91 เซนติเมตร ขึ้นไป (หรือ เกินเกณฑ์ ส่วนสูง / 2)</td>
      <td data-label="ผลการวิเคราะห์" class="fs-4 text-danger fw-bold">อ้วนลงพุง</td>
      <td data-label="แนวทางบอกต่อ" class="small text-muted fs-5">มีภาวะอ้วนลงพุง เสี่ยงต่อโรคแทรกซ้อนหลอดเลือดหัวใจ สมอง และเบาหวานรายใหม่</td>
    </tr>
    <tr>
      <td data-label="ดัชนีชี้วัด"><span class="badge fs-5 px-3 py-2 text-white" style="background-color: #db2777;">รอบเอว (หญิง)</span></td>
      <td data-label="ช่วงระดับเกณฑ์" class="fs-4">ไม่เกิน 80 เซนติเมตร (หรือ ไม่เกิน ส่วนสูง / 2)</td>
      <td data-label="ผลการวิเคราะห์" class="fs-4 text-success fw-bold">ปกติ</td>
      <td data-label="แนวทางบอกต่อ" class="small text-muted fs-5">รอบเอวอยู่ในเกณฑ์ปลอดภัย ดัชนีรอบเอวสมส่วน ไม่มีความเสี่ยงภาวะอ้วนลงพุง</td>
    </tr>
    <tr>
      <td data-label="ดัชนีชี้วัด"><span class="badge fs-5 px-3 py-2 text-white" style="background-color: #9d174d;">รอบเอว (หญิง)</span></td>
      <td data-label="ช่วงระดับเกณฑ์" class="fs-4">ตั้งแต่ 81 เซนติเมตร ขึ้นไป (หรือ เกินเกณฑ์ ส่วนสูง / 2)</td>
      <td data-label="ผลการวิเคราะห์" class="fs-4 text-danger fw-bold">อ้วนลงพุง</td>
      <td data-label="แนวทางบอกต่อ" class="small text-muted fs-5">มีภาวะอ้วนลงพุง เสี่ยงต่อโรคแทรกซ้อนหลอดเลือดหัวใจ สมอง และเบาหวานรายใหม่</td>
    </tr>
  `;
}

async function fetchVhvPerformanceReportFromServer() { 
  toggleLoaderDisplay(true); 
  try {
    const { data: allUsers, error: userErr } = await db.from('users').select('*');
    if (userErr) throw userErr;
    
    const dataRows = await supabaseSelectAll('data', 'pid, vhv_pid, vhv_name, moo, community');
    const screenRows = await supabaseSelectAll('screening', 'citizen_id');
    const screenedPids = screenRows ? screenRows.map(s => s.citizen_id.toString()) : [];

    let filteredVhvs = allUsers || [];
    
    // [แก้ไขลอจิก] ให้เทียบทั้ง "หมู่" และ "ชื่อชุมชน" ให้ตรงกัน (รองรับกรณีช่องชุมชนเป็นค่าว่าง)
    if (activeVhvSession.role === 'user') {
      const myMoo = parseInt(activeVhvSession.moo) || 0;
      const myComm = (activeVhvSession.community || "").trim();

      filteredVhvs = filteredVhvs.filter(u => {
        const uMoo = parseInt(u.moo) || 0;
        const uComm = (u.community || "").trim();

        // 1. ถ้าเป็นตัวเอง ให้แสดงเสมอ
        if (u.pid_vhv === activeVhvSession.vhvId) return true;
        
        // 2. ถ้าอยู่ หมู่เดียวกัน และ ชุมชนเดียวกัน ให้แสดงเพื่อนในหมู่ด้วย
        if (uMoo === myMoo && uComm === myComm) return true;

        return false;
      });
    } else if (activeVhvSession.role === 'staff') {
      filteredVhvs = filteredVhvs.filter(u => 
        u.pid_vhv === activeVhvSession.vhvId || 
        (u.moo === activeVhvSession.moo && (!activeVhvSession.community || u.community === activeVhvSession.community))
      );
    }

    masterVhvPerformanceList = filteredVhvs.map(u => {
      const myCitizens = dataRows.filter(r => 
        (r.vhv_pid && r.vhv_pid.toString() === u.pid_vhv.toString()) || 
        (r.vhv_name && r.vhv_name.trim() === u.full_name.trim())
      );
      
      const target = myCitizens.length;
      const done = myCitizens.filter(r => screenedPids.includes(r.pid.toString())).length;
      const pending = target - done;
      const percentage = target > 0 ? parseFloat(((done / target) * 100).toFixed(1)) : 0.0;
      
      return {
        name: u.full_name, moo: u.moo, community: u.community || '', target: target, done: done, pending: pending, percentage: percentage, role: u.role
      };
    });

    // จัดเรียงรายชื่อ: เอาตัวเองไว้บนสุดเสมอ ที่เหลือจัดอันดับตามร้อยละผลงานจากมากไปน้อย
    masterVhvPerformanceList.sort((a, b) => {
        if (a.name === activeVhvSession.name) return -1;
        if (b.name === activeVhvSession.name) return 1;
        return b.percentage - a.percentage; 
    });

    masterVhvPerformanceList = masterVhvPerformanceList.filter(item => 
      item.target > 0 || item.role === 'user' || item.name === activeVhvSession.name
    );

    toggleLoaderDisplay(false); 
    const maxPage = Math.ceil(masterVhvPerformanceList.length / rowsPerPageLimit) || 1; 
    perfCurrentPage = Math.max(1, Math.min(perfCurrentPage, maxPage)); 
    renderVhvPerformanceTable(); 
  } catch(err) { 
    toggleLoaderDisplay(false); 
    Swal.fire({ icon: 'error', title: 'โหลดรายงานล้มเหลว', text: err.message });
  }
}

function renderVhvPerformanceTable() {
  const tbody = document.getElementById('vhvPerformanceTableBody'); if (!tbody) return; tbody.innerHTML = ''; 
  if(masterVhvPerformanceList.length === 0) { 
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">ไม่พบรายงานข้อมูลสถิติผลงาน อสม. ในเขตรับผิดชอบนี้</td></tr>'; 
    return; 
  }
  const start = (perfCurrentPage - 1) * rowsPerPageLimit; const end = Math.min(start + rowsPerPageLimit, masterVhvPerformanceList.length); const slice = masterVhvPerformanceList.slice(start, end);
  slice.forEach(item => { 
    let communityText = item.community ? ` (${item.community})` : '';
    tbody.innerHTML += `<tr>
      <td data-label="ชื่อ อสม.">${item.name}</td>
      <td data-label="หมู่ที่ / ชุมชน">หมู่ ${item.moo}${communityText}</td>
      <td data-label="เป้าหมายทั้งหมด">${item.target} คน</td>
      <td data-label="คัดกรองแล้ว" class="text-success">${item.done} คน</td>
      <td data-label="คงเหลือ" class="text-danger">${item.pending} คน</td>
      <td data-label="ร้อยละผลงาน"><div class="d-flex align-items-center gap-2 w-100 justify-content-end justify-content-md-start"><div class="progress flex-grow-1 d-none d-md-flex" style="height:12px; min-width:100px;"><div class="progress-bar bg-success" style="width:${item.percentage}%"></div></div><span>${item.percentage}%</span></div></td>
    </tr>`; 
  });
  safetySetTextContent('labelPerfPaginationInfo', `รายงานแถวที่ ${start+1} ถึง ${end} จากทั้งหมด ${masterVhvPerformanceList.length} อสม.`); compileSmartPaginationLinks(perfCurrentPage, masterVhvPerformanceList.length, 'paginationPerfWrapper', 'shiftPerfPage');
}

async function fetchManagementTargetsFromServer() { 
  toggleLoaderDisplay(true); 
  try {
    const records = await supabaseSelectAll('data', 'pid, full_name, age, house_no, moo, vhv_name, area_status, community', (q) => {
      if (activeVhvSession.role === 'user') {
        return q.eq('vhv_pid', activeVhvSession.vhvId);
      } else if (activeVhvSession.role === 'staff') {
        let query = q.eq('moo', activeVhvSession.moo);
        if (activeVhvSession.community && activeVhvSession.community.trim() !== "") {
          query = query.eq('community', activeVhvSession.community);
        }
        return query;
      }
      return q;
    }); 
    toggleLoaderDisplay(false); 
    masterTargetMgList = (records || []).map(r => {
      let cleanComm = r.community ? r.community.trim() : "";
      let communityStr = "";
      if (cleanComm !== "") {
        communityStr = cleanComm.startsWith("ชุมชน") ? ` ${cleanComm}` : ` ชุมชน${cleanComm}`;
      }
      
      return { pid: r.pid, name: r.full_name, age: r.age, address: `บ้านเลขที่ ${r.house_no || '-'} ม.${r.moo}${communityStr}`, vhv_name: r.vhv_name || '-', status_area: r.area_status || 'อยู่ในพื้นที่' };
    });
    executeTargetMgTableFilter(false);
  } catch (err) { toggleLoaderDisplay(false); }
}

function executeTargetMgTableFilter(isFromUserInput = false) { 
  clearTimeout(targetMgSearchDebounceTimeout);
  targetMgSearchDebounceTimeout = setTimeout(() => {
    const q = document.getElementById('inputSearchTargetMg').value.toLowerCase(); const residencyStatusFilter = document.getElementById('selectTargetMgStatus') ? document.getElementById('selectTargetMgStatus').value : '';
    filteredTargetMgList = masterTargetMgList.filter(r => { const matchText = r.name.toLowerCase().includes(q); let matchResidency = true; if (residencyStatusFilter === "อยู่ในพื้นที่") { matchResidency = (r.status_area !== "ไม่อยู่ในพื้นที่"); } else if (residencyStatusFilter === "ไม่อยู่ในพื้นที่") { matchResidency = (r.status_area === "ไม่อยู่ในพื้นที่"); } return matchText && matchResidency; });
    if (isFromUserInput) { tgtMgCurrentPage = 1; }
    const maxPage = Math.ceil(filteredTargetMgList.length / rowsPerPageLimit) || 1; tgtMgCurrentPage = Math.max(1, Math.min(tgtMgCurrentPage, maxPage)); renderTargetMgTable(); 
  }, 300);
}

function renderTargetMgTable() {
  const tbody = document.getElementById('targetMgTableBody'); if (!tbody) return; tbody.innerHTML = ''; if(filteredTargetMgList.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">ไม่พบประวัติ</td></tr>'; return; }
  const st = (tgtMgCurrentPage - 1) * rowsPerPageLimit; const ed = Math.min(st + rowsPerPageLimit, filteredTargetMgList.length); const slice = filteredTargetMgList.slice(st, ed);
  slice.forEach(item => {
    const isChecked = item.status_area !== 'ไม่อยู่ในพื้นที่' ? 'checked' : ''; const statusLabel = item.status_area !== 'ไม่อยู่ในพื้นที่' ? '<span class="text-success fw-bold"><i class="fa fa-home"></i> อยู่ในพื้นที่</span>' : '<span class="text-danger fw-bold"><i class="fa fa-plane-departure"></i> ไม่อยู่ในพื้นที่</span>';
    tbody.innerHTML += `<tr><td data-label="ชื่อ - นามสกุลเป้าหมาย">${item.name}</td><td data-label="อายุ">${item.age} ปี</td><td data-label="ที่อยู่ปัจจุบัน" class="small text-muted">${item.address}</td><td data-label="อสม. ผู้รับผิดชอบ">${item.vhv_name}</td><td data-label="สถานะถิ่นพำนักปัจจุบัน" class="text-center print-hide"><div class="d-flex flex-row flex-md-column align-items-center justify-content-end justify-content-md-center gap-2 w-100"><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" ${isChecked} onchange="toggleTargetLocationState('${item.pid}', this)"></div><div class="fs-6">${statusLabel}</div></div></td></tr>`;
  });
  safetySetTextContent('labelTgtMgPaginationInfo', `แถวเป้าหมายที่ ${st+1} ถึง ${ed} จากทั้งหมด ${filteredTargetMgList.length} คน`); compileSmartPaginationLinks(tgtMgCurrentPage, filteredTargetMgList.length, 'paginationTgtMgWrapper', 'shiftTgtMgPage');
}

async function toggleTargetLocationState(pid, el) { 
  const statusStr = el.checked ? 'อยู่ในพื้นที่' : 'ไม่อยู่ในพื้นที่'; const { error } = await db.from('data').update({ area_status: statusStr }).eq('pid', pid);
  if(!error) { 
    const idx = masterTargetMgList.findIndex(t => t.pid.toString() === pid.toString()); 
    if(idx !== -1) masterTargetMgList[idx].status_area = statusStr; 
    
    await insertAuditLog('UPDATE_LOCATION_STATE', 'data', pid, `เปลี่ยนสถานะถิ่นพำนักเป็น: ${statusStr}`);
    
    executeTargetMgTableFilter(false); 
  } 
}

function executeSaveLogoConfig() { 
  const url = document.getElementById('inputAgencyLogoUrl').value.trim(); 
  localStorage.setItem('agencyLogoUrl', url); 
  const img = document.getElementById('menuHeaderLogo'); 
  if (img) img.src = url; 
  Swal.fire({ icon: 'success', title: 'อัปเดตโลโก้สำเร็จ' }); 
}

async function fetchUserAccountsFromServer() {
  const filterCard = document.getElementById('adminUserFilterCard');
  if (filterCard) {
    if (activeVhvSession.role && activeVhvSession.role.toString().trim().toLowerCase() === 'admin') {
      filterCard.classList.remove('d-none');
    } else {
      filterCard.classList.add('d-none');
    }
  }

  toggleLoaderDisplay(true);
  try {
    const { data: users } = await db.from('users').select('*').order('id', { ascending: true });
    masterUserAccountsDataset = users || []; 
    toggleLoaderDisplay(false); const tbody = document.getElementById('usersTableBody'); if (!tbody) return; tbody.innerHTML = '';
    if (users) {
      let displayedUsers = users || [];
      const currentRole = activeVhvSession.role ? activeVhvSession.role.toString().trim().toLowerCase() : '';
      
      if (currentRole === 'staff') {
        displayedUsers = displayedUsers.filter(u => u.community === activeVhvSession.community);
      } else if (currentRole === 'admin') {
        const commFilter = document.getElementById('selectUserFilterCommunity') ? document.getElementById('selectUserFilterCommunity').value : '';
        if (commFilter !== '') {
          displayedUsers = displayedUsers.filter(u => u.community === commFilter);
        }
      }

      displayedUsers.forEach(u => {
        let editBtn = `<button class="btn btn-sm btn-warning fw-bold fs-6 rounded-pill px-3 me-2" onclick="openEditUserModal(${u.id})"><i class="fa-solid fa-user-pen"></i> แก้ไข</button>`;
        let deleteBtn = `<button class="btn btn-sm btn-danger fw-bold fs-6 rounded-pill px-3" onclick="executeUserCrudAction('DELETE', ${u.id})"><i class="fa fa-trash"></i> ลบ</button>`;
        if(currentRole === 'staff') { deleteBtn = `<span class="badge bg-light text-muted fs-6">ล็อกสิทธิ์การลบ</span>`; if (u.role === 'admin') { editBtn = `<span class="badge bg-light text-muted fs-6 me-2">ล็อกสิทธิ์จัดการ Admin</span>`; } }
        
        let communityLabel = u.community && u.community.trim() !== "" ? `<br><span class="text-muted small"><i class="fa-solid fa-tree-city"></i> ${u.community}</span>` : '';
        
        tbody.innerHTML += `<tr><td data-label="รหัสผู้ใช้">${u.id}</td><td data-label="ชื่อผู้ใช้">${u.username}</td><td data-label="รหัสผ่าน"><code>${u.password}</code></td><td data-label="สิทธิ์ระบบ"><span class="badge bg-secondary">${u.role}</span></td><td data-label="ชื่อ - นามสกุล">${u.full_name}</td><td data-label="หมู่ที่ / ชุมชน">หมู่ ${u.moo}${communityLabel}</td><td data-label="จัดการคำสั่ง" class="text-center w-100">${editBtn} ${deleteBtn}</td></tr>`;
      });
    }
  } catch (err) { toggleLoaderDisplay(false); }
}

function openAddUserModal() {
  const form = document.getElementById('userActionForm'); if (form) form.reset(); safetySetInputValue('modal_user_id', ""); safetySetTextContent('userModalTitle', "เพิ่มบัญชีรายชื่อ อสม. คณะทำงานใหม่");
  safetySetInputValue('modal_community', ""); 
  const typeSelect = document.getElementById('modal_type'); if (typeSelect) { if (activeVhvSession.role === 'staff') { typeSelect.value = 'user'; typeSelect.disabled = true; } else { typeSelect.disabled = false; } }
  if (bootstrapUserModalInstance) bootstrapUserModalInstance.show();
}

function openEditUserModal(userId) {
  const uObj = masterUserAccountsDataset.find(u => u.id === userId);
  if (!uObj) return;

  safetySetInputValue('modal_user_id', uObj.id); safetySetInputValue('modal_user', uObj.username); safetySetInputValue('modal_pass', uObj.password); safetySetInputValue('modal_fullname', uObj.full_name); safetySetInputValue('modal_type', uObj.role); safetySetInputValue('modal_moo', uObj.moo); safetySetInputValue('modal_pid_อสม', uObj.pid_vhv);
  safetySetInputValue('modal_community', uObj.community || ""); 
  safetySetTextContent('userModalTitle', "แก้ไขข้อมูลระเบียบบัญชี อสม.");
  const typeSelect = document.getElementById('modal_type'); if (typeSelect) { typeSelect.disabled = (activeVhvSession.role === 'staff'); }
  if (bootstrapUserModalInstance) bootstrapUserModalInstance.show();
}

async function executeSaveUserForm(e) {
  e.preventDefault(); const uid = document.getElementById('modal_user_id').value;
  const payload = {
    username: document.getElementById('modal_user').value.trim(), password: document.getElementById('modal_pass').value.trim(),
    full_name: document.getElementById('modal_fullname').value.trim(), role: document.getElementById('modal_type').value,
    moo: parseInt(document.getElementById('modal_moo').value) || 0, pid_vhv: document.getElementById('modal_pid_อสม').value.trim(), 
    community: document.getElementById('modal_community').value
  };
  toggleLoaderDisplay(true);
  try {
    if(uid === "") {
      const { data: allUsers } = await db.from('users').select('id');
      const maxId = allUsers ? allUsers.reduce((max, u) => u.id > max ? u.id : max, 0) : 0;
      payload.id = maxId + 1; 
      await db.from('users').insert([payload]);
      
      await insertAuditLog('INSERT_USER', 'users', payload.id, { username: payload.username, full_name: payload.full_name, role: payload.role });
    } else { 
      await db.from('users').update(payload).eq('id', uid); 
      
      await insertAuditLog('UPDATE_USER', 'users', uid, { username: payload.username, full_name: payload.full_name, role: payload.role });
    }
    toggleLoaderDisplay(false); if (bootstrapUserModalInstance) bootstrapUserModalInstance.hide(); fetchUserAccountsFromServer();
    Swal.fire({ icon: 'success', title: 'ดำเนินการสำเร็จ', timer: 1200, showConfirmButton:false });
  } catch (err) { toggleLoaderDisplay(false); Swal.fire({ icon: 'error', title: 'ไม่สามารถทำรายการได้', text: err.message }); }
}

async function executeUserCrudAction(action, userId) {
  if(action === 'DELETE') {
    Swal.fire({ title: 'ยืนยันการลบระเบียบบัญชีนี้?', text: "เมื่อยืนยันแล้ว บัญชี อสม. ดังกล่าวจะไม่สามารถเข้าสู่ระบบได้อีกต่อไป!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'ลบข้อมูล' }).then(async (result) => {
      if (result.isConfirmed) { 
        toggleLoaderDisplay(true); 
        await db.from('users').delete().eq('id', userId); 
        
        await insertAuditLog('DELETE_USER', 'users', userId, `ลบบัญชีผู้ใช้ไอดี: ${userId} ออกจากฐานข้อมูลระบบ`);

        toggleLoaderDisplay(false); fetchUserAccountsFromServer(); Swal.fire('ถูกลบแล้ว!', '', 'success'); 
      }
    });
  }
}

async function fetchScreeningReportDataFromServer() {
  toggleLoaderDisplay(true);
  try {
    let allowedPids = [];
    if (activeVhvSession.role === 'user') {
      const allowedDataRows = await supabaseSelectAll('data', 'pid', (q) => q.eq('vhv_pid', activeVhvSession.vhvId));
      allowedPids = allowedDataRows.map(r => r.pid.toString());
    } else if (activeVhvSession.role === 'staff') {
      const allowedDataRows = await supabaseSelectAll('data', 'pid', (q) => {
        let query = q.eq('moo', activeVhvSession.moo);
        if (activeVhvSession.community && activeVhvSession.community.trim() !== "") {
          query = query.eq('community', activeVhvSession.community);
        }
        return query;
      });
      allowedPids = allowedDataRows.map(r => r.pid.toString());
    }

    const records = await supabaseSelectAll('screening', '*'); toggleLoaderDisplay(false);
    
    let filteredReports = records || [];
    if (activeVhvSession.role === 'user' || activeVhvSession.role === 'staff') {
      filteredReports = filteredReports.filter(r => allowedPids.includes(r.citizen_id.toString()));
    }

    masterReportList = filteredReports.map(r => ({ pid: r.citizen_id, name: r.name, date: r.date, weight: r.weight, height: r.height, waist: r.waist, sbp: r.bp_sys, dbp: r.bp_dia, bsl: r.fbs, smoking: r.smoking, alcohol: r.alcohol, exercise: r.exercise }));
    const maxPage = Math.ceil(masterReportList.length / rowsPerPageLimit) || 1; reportCurrentPage = Math.max(1, Math.min(reportCurrentPage, maxPage)); renderReportTable();
  } catch(err) { toggleLoaderDisplay(false); }
}

function renderReportTable() {
  const tbody = document.getElementById('reportTableBody'); if (!tbody) return; tbody.innerHTML = '';
  if (masterReportList.length === 0) { tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4 fs-4">ยังไม่พบบันทึกประวัติการคัดกรอง NCDs ในระบบ</td></tr>'; return; }
  const st = (reportCurrentPage - 1) * rowsPerPageLimit; const ed = Math.min(st + rowsPerPageLimit, masterReportList.length); const slice = masterReportList.slice(st, ed);
  slice.forEach(r => { tbody.innerHTML += `<tr><td data-label="เลขทะเบียน PID">${r.pid}</td><td data-label="ชื่อ - นามสกุล">${r.name}</td><td data-label="วันที่คัดกรอง">${r.date}</td><td data-label="น้ำหนัก (กก.)">${r.weight}</td><td data-label="ส่วนสูง (ซม.)">${r.height}</td><td data-label="รอบเอว (ซม.)">${r.waist}</td><td data-label="SYS (บน)" class="text-danger">${r.sbp}</td><td data-label="DIA (ล่าง)" class="text-danger">${r.dbp}</td><td data-label="BSL (น้ำตาล)" class="text-success">${r.bsl}</td><td data-label="พฤติกรรมสูบบุหรี่">${r.smoking}</td><td data-label="การดื่มสุรา">${r.alcohol}</td><td data-label="การออกกำลังกาย">${r.exercise}</td></tr>`; });
  safetySetTextContent('labelReportPaginationInfo', `รายงานแถวที่ ${st+1} ถึง ${ed} จากทั้งหมด ${masterReportList.length} รายการ`); compileSmartPaginationLinks(reportCurrentPage, masterReportList.length, 'paginationReportWrapper', 'shiftReportPage');
}

function executeExportReportToExcel() {
  if (masterReportList.length === 0) { Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: 'ไม่มีข้อมูลรายงานสำหรับการส่งออกไฟล์' }); return; }
  const worksheetData = [["เลขทะเบียน PID", "ชื่อ - นามสกุล", "วันที่คัดกรอง", "น้ำหนัก (กก.)", "ส่วนสูง (ซม.)", "รอบเอว (ซม.)", "SYS (บน)", "DIA (ล่าง)", "BSL (น้ำตาล)", "พฤติกรรมสูบบุหรี่", "การดื่มสุรา", "การออกกำลังกาย"]];
  masterReportList.forEach(r => { worksheetData.push([r.pid, r.name, r.date, r.weight, r.height, r.waist, r.sbp, r.dbp, r.bsl, r.smoking, r.alcohol, r.exercise]); });
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "ทะเบียนรายงานคัดกรองเชิงรุก"); XLSX.writeFile(workbook, "รายงานทะเบียนคัดกรอง_Smart_NCD_Care_อนามัย.xlsx");
}

function executePrintReportPdfLandscape() { 
  const tbody = document.getElementById('reportTableBody');
  if (tbody && masterReportList.length > 0) {
    let fullHtml = ''; masterReportList.forEach(r => { fullHtml += `<tr><td>${r.pid}</td><td>${r.name}</td><td>${r.date}</td><td>${r.weight}</td><td>${r.height}</td><td>${r.waist}</td><td class="text-danger">${r.sbp}</td><td class="text-danger">${r.dbp}</td><td class="text-success">${r.bsl}</td><td>${r.smoking}</td><td>${r.alcohol}</td><td>${r.exercise}</td></tr>`; }); tbody.innerHTML = fullHtml;
  }
  setTimeout(() => { window.print(); renderReportTable(); }, 500);
}

function executeSaveAdviceCardAsImage() {
  const cardElement = document.getElementById('shareableAdviceCard'); const statusText = document.getElementById('rt-status-text').innerText;
  if (statusText.includes("รอคีย์") || statusText.includes("กรอกตัวเลข")) { Swal.fire({ icon: 'warning', title: 'ไม่สามารถบันทึกได้', text: 'กรุณากรอกข้อมูลสัญญาณชีพและประมวลผลให้เรียร็จสิ้นก่อนกดสร้างภาพแชร์ครับ' }); return; }
  toggleLoaderDisplay(true); const dateNow = new Date(); const thaiDateStr = dateNow.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  safetySetTextContent('share-card-date', 'วันที่ตรวจประเมิน: ' + thaiDateStr);
  html2canvas(cardElement, { scale: 2, useCORS: true, backgroundColor: "#ffffff" }).then(canvas => {
    canvas.toBlob(blob => {
      toggleLoaderDisplay(false); const imgFile = new File([blob], `SmartNCDCare_${dateNow.getTime()}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [imgFile] })) {
        navigator.share({ files: [imgFile], title: 'บัตรประเมินสุขภาพตนเองนิรนาม', text: 'สรุปผลตรวจวิเคราะห์สัญญาณชีพเบื้องต้นจากระบบข้อมูล Smart NCD Care' }).then(() => { Swal.fire({ icon: 'success', title: 'ส่งข้อมูลสำเร็จ', text: 'ดำเนินการแชร์ข้อมูลสุขภาพเรียบร้อยแล้ว', timer: 1500, showConfirmButton: false }); }).catch(err => { if (err.name !== 'AbortError') { executeFallbackDownloadMechanism(canvas, dateNow); } });
      } else { executeFallbackDownloadMechanism(canvas, dateNow); }
    }, 'image/png');
  }).catch(err => { toggleLoaderDisplay(false); Swal.fire({ icon: 'error', title: 'ล้มเหลว', text: 'ล้มเหลวในการแปลงภาพ: ' + err.toString() }); });
}

function executeFallbackDownloadMechanism(canvas, dateNow) { const imgBase64Uri = canvas.toDataURL("image/png"); const downloadAnchor = document.createElement('a'); downloadAnchor.download = `บัตรแนะนำสุขภาพ_SmartNCDCare_${dateNow.getTime()}.png`; downloadAnchor.href = imgBase64Uri; downloadAnchor.click(); Swal.fire({ icon: 'success', title: 'ดาวน์โหลดภาพสำรองสำเร็จ', text: 'ระบบทำการเซฟภาพลงในเครื่องให้แทนโดยอัตโนมัติ', confirmButtonColor: '#0284c7' }); }
function executeExportTargetMgToExcel() { 
  if (filteredTargetMgList.length === 0) { 
    Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: 'ไม่มีข้อมูลกลุ่มเป้าหมายสำหรับการส่งออกไฟล์' }); 
    return; 
  } 
  const worksheetData = [["ชื่อ - นามสกุลเป้าหมาย", "อายุ", "ที่อยู่ปัจจุบัน", "อสม. ผู้รับผิดชอบ", "สถานะถิ่นพำนักปัจจุบัน"]]; 
  filteredTargetMgList.forEach(item => { 
    worksheetData.push([item.name, item.age + " ปี", item.address, item.vhv_name, item.status_area]); 
  }); 
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "เป้าหมาย");
  XLSX.writeFile(workbook, "ทะเบียนกลุ่มเป้าหมายประชากร_Smart_NCD_Care.xlsx"); 
}

function executePrintTargetMgPdf() { 
  const tbody = document.getElementById('targetMgTableBody');
  if (tbody && filteredTargetMgList.length > 0) {
    let fullHtml = ''; filteredTargetMgList.forEach(item => { const statusLabel = item.status_area !== 'ไม่อยู่ในพื้นที่' ? 'อยู่ในพื้นที่' : 'ไม่อยู่ในพื้นที่'; fullHtml += `<tr><td>${item.name}</td><td>${item.age} ปี</td><td class="small text-muted">${item.address}</td><td>${item.vhv_name}</td><td class="text-center print-hide">${statusLabel}</td></tr>`; }); tbody.innerHTML = fullHtml;
  }
  setTimeout(() => { window.print(); renderTargetMgTable(); }, 500);
}

function convertCsvTextToJsonArray(textString) {
  const lines = textString.split(/\r?\n/); if (lines.length === 0 || !lines[0].trim()) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '')); const parsedArray = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const columns = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')); const rowObj = {};
    headers.forEach((header, index) => { rowObj[header] = columns[index] !== undefined ? columns[index] : ''; }); parsedArray.push(rowObj);
  }
  return parsedArray;
}

function getCsvValueRobust(rowObj, acceptableKeys) {
  const rowKeys = Object.keys(rowObj);
  for (let key of rowKeys) {
    const cleanKey = key.trim().toLowerCase();
    for (let target of acceptableKeys) { if (cleanKey === target.toLowerCase() || cleanKey.includes(target.toLowerCase())) { return rowObj[key]; } }
  }
  return undefined;
}

function parseDateRobust(rawDate) {
  if (!rawDate || rawDate === '-' || rawDate.toString().trim() === '') return null;
  let cleanDate = rawDate.toString().trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return cleanDate;
  const parts = cleanDate.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) { let year = parseInt(parts[0]); if (year > 2500) year -= 543; return `${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`; }
    if (parts[2].length === 4 || parts[2].length === 2) { let year = parseInt(parts[2]); if (parts[2].length === 2) year += 2000; if (year > 2500) year -= 543; return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`; }
  }
  return null;
}

function parseNumberRobust(value, isFloat = false) {
  if (value === undefined || value === null || value === '-' || value.toString().trim() === '') return null;
  const parsed = isFloat ? parseFloat(value) : parseInt(value); return isNaN(parsed) ? null : parsed;
}

async function executeProcessingCsvUploadToServer() {
  const fileInput = document.getElementById('inputCsvTargetFile');
  if (!fileInput || fileInput.files.length === 0) { Swal.fire({ icon: 'warning', title: 'ยังไม่ได้เลือกไฟล์', text: 'กรุณาเลือกไฟล์เอกสารในรูปแบบนามสกุล .csv ก่อนกดยืนยันคำสั่งครับ' }); return; }
  const radioEl = document.querySelector('input[name="csvTypeRadio"]:checked'); if (!radioEl) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่พบประเภทข้อมูลที่เลือก กรุณารีเฟรชหน้าเว็บ' }); return; }
  
  const selectedCsvType = radioEl.value; const csvFile = fileInput.files[0]; const fileReader = new FileReader(); toggleLoaderDisplay(true);
  fileReader.onload = async function(event) {
    try {
      const textRawContent = event.target.result; const jsonBatchArray = convertCsvTextToJsonArray(textRawContent);
      if (jsonBatchArray.length === 0) { throw new Error("ไฟล์ CSV ว่างเปล่า หรือโครงสร้างแถวหัวตารางไม่ถูกต้อง"); }

      if (selectedCsvType === 'users') {
        const typedData = jsonBatchArray
          .map(u => {
            const idVal = parseNumberRobust(getCsvValueRobust(u, ['id', 'ลำดับ']));
            return {
              id: idVal, username: getCsvValueRobust(u, ['username', 'ชื่อผู้ใช้', 'เบอร์โทร']), password: getCsvValueRobust(u, ['password', 'รหัสผ่าน']), full_name: getCsvValueRobust(u, ['full_name', 'ชื่อ-นามสกุล', 'ชื่อจริง']), role: getCsvValueRobust(u, ['role', 'สิทธิ์']) || 'user', moo: parseNumberRobust(getCsvValueRobust(u, ['moo', 'หมู่ที่'])) || 0, pid_vhv: getCsvValueRobust(u, ['pid_vhv', 'PID อสม.']) || '', 
              community: getCsvValueRobust(u, ['community', 'ชุมชน']) || ''
            };
          })
          .filter(u => u.id !== null);
        if (typedData.length === 0) throw new Error("ไม่พบข้อมูลบัญชีผู้ใช้ที่ถูกต้องในไฟล์ CSV");
        const uniqueUsersMap = new Map(); typedData.forEach(item => uniqueUsersMap.set(item.id, item)); const finalUniqueUsers = Array.from(uniqueUsersMap.values());
        const { error: upsertErr } = await db.from('users').upsert(finalUniqueUsers); if (upsertErr) throw upsertErr;
        
        await insertAuditLog('IMPORT_CSV_USERS', 'users', 'BATCH', `นำเข้าข้อมูลบัญชีรายชื่อ อสม. จำนวน ${finalUniqueUsers.length} รายการผ่าน CSV`);

        Swal.fire({ icon: 'success', title: 'นำเข้าบัญชี อสม. สำเร็จ!', text: `อัปเดต/เพิ่มรายชื่อผู้ใช้งานตาราง users จำนวน ${finalUniqueUsers.length} รายการเรียบร้อย` });
      } else {
        const typedData = jsonBatchArray
          .map(p => {
            const pidVal = parseNumberRobust(getCsvValueRobust(p, ['pid', 'เลขทะเบียน'])); const rawScreenDate = getCsvValueRobust(p, ['screening_date', 'วันที่คัดกรอง']); const rawBirthDate = getCsvValueRobust(p, ['birth_date', 'วันเกิด', 'birthdate', 'birth date', 'วัน/เดือน/ปีเกิด', 'วัน เดือน ปีเกิด']);
            return {
              pid: pidVal, full_name: getCsvValueRobust(p, ['full_name', 'ชื่อ-นามสกุล']), gender: getCsvValueRobust(p, ['gender', 'เพศ']) || 'ชาย', birth_date: parseDateRobust(rawBirthDate), age: parseNumberRobust(getCsvValueRobust(p, ['age', 'อายุ'])) || 0, house_no: getCsvValueRobust(p, ['house_no', 'บ้านเลขที่']) || '', moo: parseNumberRobust(getCsvValueRobust(p, ['moo', 'หมู่ที่'])) || 0, village_name: getCsvValueRobust(p, ['village_name', 'ชื่อหมู่บ้าน']) || null, 
              community: getCsvValueRobust(p, ['community', 'ชุมชน']) || null,       
              vhv_name: getCsvValueRobust(p, ['vhv_name', 'อสม.ผู้ดูแล']) || '', vhv_pid: getCsvValueRobust(p, ['vhv_pid', 'PID อสม.']) || '', history_ht: getCsvValueRobust(p, ['history_ht', 'ประวัติ HT']) || null, history_dm: getCsvValueRobust(p, ['history_dm', 'ประวัติ DM']) || null, screening_date: parseDateRobust(rawScreenDate), weight: parseNumberRobust(getCsvValueRobust(p, ['weight', 'น้ำหนัก']), true), height: parseNumberRobust(getCsvValueRobust(p, ['height', 'ส่วนสูง']), true), waist: parseNumberRobust(getCsvValueRobust(p, ['waist', 'รอบเอว']), true), sbp: parseNumberRobust(getCsvValueRobust(p, ['sbp', 'SBP', 'ความดันตัวบน'])), dbp: parseNumberRobust(getCsvValueRobust(p, ['dbp', 'DBP', 'ความดันตัวล่าง'])), bsl: parseNumberRobust(getCsvValueRobust(p, ['bsl', 'BSL', 'น้ำตาล'])), interpretation_ht: getCsvValueRobust(p, ['interpretation_ht', 'ผลแปล HT']), interpretation_dm: getCsvValueRobust(p, ['interpretation_dm', 'ผลแปล DM']), area_status: getCsvValueRobust(p, ['area_status', 'สถานะพื้นที่']) || 'อยู่ในพื้นที่'
            };
          })
          .filter(p => p.pid !== null);
        if (typedData.length === 0) throw new Error("ไม่พบข้อมูลประชากรที่ถูกต้องในไฟล์ CSV");
        const uniqueDataMap = new Map(); typedData.forEach(item => uniqueDataMap.set(item.pid, item)); const finalUniqueData = Array.from(uniqueDataMap.values());
        
        const { error: upsertErr } = await db.from('data').upsert(finalUniqueData); if (upsertErr) throw upsertErr;
        
        await insertAuditLog('IMPORT_CSV_TARGETS', 'data', 'BATCH', `นำเข้าข้อมูลประชากรกลุ่มเป้าหมายจำนวน ${finalUniqueData.length} รายการผ่าน CSV`);

        Swal.fire({ icon: 'success', title: 'นำเข้าข้อมูลเป้าหมายสำเร็จ!', text: `ระบบอัปเดตข้อมูลรวมถึงวันเกิดสากลและสัญญาณชีพเข้าตาราง data จำนวน ${finalUniqueData.length} รายการเรียบร้อยครับ` });
      }
      fileInput.value = "";
    } catch (err) { Swal.fire({ icon: 'error', title: 'การนำเข้าล้มเหลว', text: 'ตรวจพบข้อผิดพลาด: ' + err.message }); } finally { toggleLoaderDisplay(false); }
  }; fileReader.readAsText(csvFile, "UTF-8");
}
   
async function executeClearScreeningDatabaseAction() {
  Swal.fire({
    title: 'ยืนยันการรีเซ็ตล้างฐานข้อมูล?', text: "[คำเตือนสำคัญ] คำสั่งนี้จะทำการล้างประวัติการคัดกรองสัญญาณชีพของปีนี้ทั้งหมดออกจากตาราง screening เพื่อเคลียร์ฐานข้อมูลให้ว่างเปล่าพร้อมรับปีงบประมาณใหม่ ข้อมูลเดิมจะสูญหายถาวร!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'ใช่, ฉันต้องการล้างประวัติคัดกรอง', cancelButtonText: 'ยกเลิก'
  }).then(async (result) => {
    if (result.isConfirmed) {
      toggleLoaderDisplay(true);
      try {
        const { error: delErr } = await db.from('screening').delete().neq('id', 'all_clear_trigger'); if (delErr) throw delErr;
        const { error: updateErr } = await db.from('data').update({ screening_date: null, weight: null, height: null, waist: null, sbp: null, dbp: null, bsl: null, interpretation_ht: null, interpretation_dm: null }).neq('pid', 0); if (updateErr) throw updateErr;
        
        await insertAuditLog('CLEAR_ALL_SCREENINGS', 'screening', 'ALL_RECORDS', 'สั่งล้างข้อมูลสัญญาณชีพและประวัติผลการคัดกรองประจำปีเพื่อเริ่มต้นปีงบประมาณใหม่');

        Swal.fire({ icon: 'success', title: 'ระบบล้างฐานข้อมูลเสร็จสิ้น', text: 'ล้างข้อมูลประวัติและเตรียมระบบรับการคัดกรองรอบใหม่เรียบร้อยแล้วครับ' });
      } catch (err) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); } finally { toggleLoaderDisplay(false); }
    }
  });
}

async function executeClearTargetDatabaseAction() {
  Swal.fire({
    title: 'ยืนยันการล้างรายชื่อเป้าหมาย?', text: "[คำเตือนขั้นเด็ดขาด] คำสั่งนี้จะล้างทำลายรายชื่อประชากรทั้งหมดออกจากตาราง data ทันที! อสม. จะไม่เห็นรายชื่อประชาชนใดๆ ในระบบจนกว่าแอดมินจะนำเข้าไฟล์ CSV ชุดใหม่เข้าไปทดแทน!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'ใช่, ฉันต้องการล้างรายชื่อประชากรทั้งหมด', cancelButtonText: 'ยกเลิก'
  }).then(async (result) => {
    if (result.isConfirmed) {
      toggleLoaderDisplay(true);
      try {
        const { error: delErr } = await db.from('data').delete().neq('pid', 0); if (delErr) throw delErr;
        
        await insertAuditLog('CLEAR_ALL_TARGETS', 'data', 'ALL_RECORDS', 'สั่งล้างรายชื่อประชากรเป้าหมายทั้งหมดออกจากตารางข้อมูลหลัก data');

        Swal.fire({ icon: 'success', title: 'ล้างข้อมูลเป้าหมายสำเร็จ', text: 'รายชื่อประชากรในตาราง data ถูกเคลียร์ลบเป็นช่องว่างคลีน 100% แล้วครับ' });
      } catch (err) { Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: err.message }); } finally { toggleLoaderDisplay(false); }
    }
  });
}

/* จัดการดึงประวัติ Audit Log และแผงตารางเมนูที่ 9 */
async function fetchLogDataFromServer() {
  toggleLoaderDisplay(true);
  try {
    const records = await supabaseSelectAll('logs', '*', (q) => q.order('created_at', { ascending: false }));
    toggleLoaderDisplay(false);
    masterLogList = records || [];
    const maxPage = Math.ceil(masterLogList.length / rowsPerPageLimit) || 1;
    logsCurrentPage = Math.max(1, Math.min(logsCurrentPage, maxPage));
    renderLogTable();
  } catch (err) {
    toggleLoaderDisplay(false);
    Swal.fire({ icon: 'error', title: 'โหลดข้อมูลล้มเหลว', text: err.message });
  }
}

function renderLogTable() {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (masterLogList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4 fs-4">ยังไม่มีบันทึกประวัติความเคลื่อนไหวในระบบคัดกรอง</td></tr>';
    safetySetTextContent('labelLogsPaginationInfo', 'แสดงผล 0 รายการ');
    document.getElementById('paginationLogsWrapper').innerHTML = '';
    return;
  }

  const st = (logsCurrentPage - 1) * rowsPerPageLimit;
  const ed = Math.min(st + rowsPerPageLimit, masterLogList.length);
  const slice = masterLogList.slice(st, ed);

  slice.forEach(log => {
    let localTime = new Date(log.created_at).toLocaleString('th-TH');
    let detailText = typeof log.details === 'object' ? JSON.stringify(log.details) : log.details;
    
    tbody.innerHTML += `<tr>
      <td data-label="วัน-เวลาบันทึก">${localTime}</td>
      <td data-label="ผู้ดำเนินการ" class="text-primary">${log.operator_name}</td>
      <td data-label="สิทธิ์ระบบ"><span class="badge bg-secondary">${log.operator_role}</span></td>
      <td data-label="ประเภทคำสั่ง"><span class="badge bg-info text-dark">${log.action}</span></td>
      <td data-label="ชื่อตาราง"><code>${log.table_name}</code></td>
      <td data-label="ไอดีอ้างอิง">${log.record_id}</td>
      <td data-label="รายละเอียดเชิงลึก" class="small text-muted text-wrap" style="max-width:250px; word-break:break-all;">${detailText || '-'}</td>
    </tr>`;
  });

  safetySetTextContent('labelLogsPaginationInfo', `แสดงแถวที่ ${st + 1} ถึง ${ed} จากทั้งหมด ${masterLogList.length} รายการ`);
  compileSmartPaginationLinks(logsCurrentPage, masterLogList.length, 'paginationLogsWrapper', 'shiftLogsPage');
}

function executeExportLogsToExcel() {
  if (masterLogList.length === 0) {
    Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: 'ไม่มีประวัติความเคลื่อนไหวระบบสำหรับนำออกไฟล์' });
    return;
  }
  const worksheetData = [["วัน-เวลา", "ผู้ดำเนินการ", "สิทธิ์ระบบ", "คำสั่งดำเนินการ", "ตารางเป้าหมาย", "ไอดีอ้างอิง", "รายละเอียดความเคลื่อนไหว"]];
  masterLogList.forEach(log => {
    let localTime = new Date(log.created_at).toLocaleString('th-TH');
    let detailText = typeof log.details === 'object' ? JSON.stringify(log.details) : log.details;
    worksheetData.push([localTime, log.operator_name, log.operator_role, log.action, log.table_name, log.record_id, detailText]);
  });
  
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "SystemAuditLogs");
  XLSX.writeFile(workbook, "ทะเบียนประวัติการใช้งานระบบ_Smart_NCD_Care_AuditLogs.xlsx");
}

async function executeClearLogsDatabaseAction() {
  if (masterLogList.length === 0) {
    Swal.fire({ icon: 'warning', title: 'ตารางว่างอยู่แล้ว', text: 'ไม่พบรายการล็อกข้อมูลที่จำเป็นต้องเคลียร์ล้างพื้นที่ครับ' });
    return;
  }
  
  Swal.fire({
    title: 'ยืนยันสำรองไฟล์และรีเซ็ต Log?',
    text: "[ข้อกำหนด PDPA] ระบบจะบังคับส่งออกแผ่นงานไฟล์ Excel สำรองข้อมูลประวัติทั้งหมดลงเครื่องของท่านโดยอัตโนมัติก่อนทันที! จากนั้นจึงจะล้างประวัติใน Supabase ครับ",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ดาวน์โหลด Excel และเคลียร์ล้างระบบ',
    cancelButtonText: 'ยกเลิกคำสั่ง'
  }).then(async (result) => {
    if (result.isConfirmed) {
      executeExportLogsToExcel();
      toggleLoaderDisplay(true);
      try {
        const { error } = await db.from('logs').delete().neq('id', 0);
        if (error) throw error;
        
        await insertAuditLog('RESET_AUDIT_LOGS', 'logs', 'ALL_RECORDS', 'ทำการเคลียร์ล้างพื้นที่ทะเบียนประวัติระบบทั้งหมดพร้อมส่งออกไฟล์สำรองภายนอกเรียบร้อย');
        
        toggleLoaderDisplay(false);
        Swal.fire({ icon: 'success', title: 'รีเซ็ตคลังล็อกสำเร็จ!', text: 'ล้างข้อมูลเรียบร้อยและดาวน์โหลดไฟล์สำรองลงเครื่องแล้วครับ' });
        fetchLogDataFromServer(); 
      } catch (err) {
        toggleLoaderDisplay(false);
        Swal.fire({ icon: 'error', title: 'ทำรายการล้มเหลว', text: err.message });
      }
    }
  });
}
