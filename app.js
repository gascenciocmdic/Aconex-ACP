import SyncEngine from './syncEngine.js';
import AconexClient from './aconexApi.js';

// DOM Elements
const tabs = document.querySelectorAll('.nav-tab');
const views = document.querySelectorAll('.view-section');

// Configuration Form
const adminForm = document.getElementById('adminForm');
const confAppKey = document.getElementById('confAppKey');
const confProjectId = document.getElementById('confProjectId');
const confRegion = document.getElementById('confRegion');
const confFilterName = document.getElementById('confFilterName');
const confUser = document.getElementById('confUser');
const confPass = document.getElementById('confPass');
const btnTogglePass = document.getElementById('btnTogglePass');
// Seleccionamos ambos iconos para el toggle
const iconEyeOpen = document.getElementById('iconEyeOpen');
const iconEyeClosed = document.getElementById('iconEyeClosed');
const techLog = document.getElementById('techLog');
const testResultContainer = document.getElementById('testResultContainer');
const btnTestConn = document.getElementById('btnTestConn');
const notifBadge = document.getElementById('notifBadge');
const syncAutoActive = document.getElementById('syncAutoActive');
const syncAutoInterval = document.getElementById('syncAutoInterval');

// Dashboard UI
const btnStartSync = document.getElementById('btnStartSync');
const btnClearDB = document.getElementById('btnClearDB');
const lastSyncLabel = document.getElementById('lastSyncLabel');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const circuitBanner = document.getElementById('circuitBanner');

// Table and Filters (Note: Multi-selects are handled via initMultiSelect)
const tableBody = document.getElementById('tableBody');
const tblCount = document.getElementById('tblCount');
const filterSearch = document.getElementById('filterSearch');
const filterContractor = document.getElementById('filterContractor');
const filterSpecialty = document.getElementById('filterSpecialty');
const confPageSize = document.getElementById('confPageSize');

// Notification UI
const notifTableBody = document.getElementById('notifTableBody');
const btnRefreshNotif = document.getElementById('btnRefreshNotif');
const filterTransSearch = document.getElementById('filterTransSearch');
const filterTransUser = document.getElementById('filterTransUser');
const filterTransOrg = document.getElementById('filterTransOrg');
const filterTransRecipient = document.getElementById('filterTransRecipient');
const filterTransStatus = document.getElementById('filterTransStatus');
const filterTransUnread = document.getElementById('filterTransUnread');
const transCount = document.getElementById('transCount');

// History UI
const histWeekSelect = document.getElementById('histWeekSelect');
const histDateStart = document.getElementById('histDateStart');
const histDateEnd = document.getElementById('histDateEnd');
const btnStartHistSync = document.getElementById('btnStartHistSync');
const histProgressContainer = document.getElementById('histProgressContainer');
const histProgressText = document.getElementById('histProgressText');
const histProgressPercent = document.getElementById('histProgressPercent');
const histProgressBar = document.getElementById('histProgressBar');
const tableHistBody = document.getElementById('tableHistBody');
const tblHistCount = document.getElementById('tblHistCount');
const filterHistSearch = document.getElementById('filterHistSearch');
const filterHistContractor = document.getElementById('filterHistContractor');
const filterHistSpecialty = document.getElementById('filterHistSpecialty');
const histPagingSize = document.getElementById('histPagingSize');
const histPrev = document.getElementById('histPrev');
const histNext = document.getElementById('histNext');

// State
let localDB = []; 
try {
    localDB = JSON.parse(localStorage.getItem('aconex_local_db')) || [];
} catch (e) {
    localDB = [];
}
let localTransmittalsDB = [];
try {
    localTransmittalsDB = JSON.parse(localStorage.getItem('aconex_local_transmittals_db')) || [];
} catch (e) {
    localTransmittalsDB = [];
}
let historyDB = [];
let isSyncing = false;

// Pagination State
let docCurrentPage = 1;
let docPageSize = 50;
let transCurrentPage = 1;
let transPageSize = 50;
let histCurrentPage = 1;
let histPageSize = 50;
let selectedHistFilters = {
    status: [],
    revision: [],
    doc_type: []
};
let histSortState = {
    field: 'modified_date',
    direction: 'desc'
};
let globalConfig = {
    projectId: confProjectId.value,
    region: confRegion.value,
    username: '',
    password: ''
};

let sortState = {
    field: 'docno',
    direction: 'asc' // asc, desc
};

let transSortState = {
    field: 'date',
    direction: 'desc'
};

// ======================================
// 0. Business Logic (Holidays & KPI Utils)
// ======================================
const CHILE_HOLIDAYS_2026 = [
    '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21',
    '2026-06-21', '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18',
    '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25'
];

function isBusinessDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Sábado o Domingo
    const dateStr = date.toISOString().split('T')[0];
    return !CHILE_HOLIDAYS_2026.includes(dateStr);
}

function getBusinessDaysDiff(startDate, endDate) {
    let count = 0;
    let cur = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(cur.getTime()) || isNaN(end.getTime())) return 0;
    
    // Si la fecha de inicio es mayor, no hay atraso positivo en este contexto
    if (cur > end) return 0;

    while (cur < end) {
        cur.setDate(cur.getDate() + 1);
        if (isBusinessDay(cur)) count++;
    }
    return count;
}

// Multiselect State
let selectedFilters = {
    status: [],
    revision: [],
    doc_type: []
};
let currentKPIFilter = null; // 'all', 'pending', 'revB', 'revP', 'cmdic', 'esed'

// ======================================
// 1. Navigation Logic
// ======================================
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active', 'text-brand'));
        tab.classList.add('active', 'text-brand');
        const target = tab.getAttribute('data-target');
        views.forEach(v => {
            if (v.id === `view-${target}`) {
                v.classList.remove('hidden');
                v.classList.add('active');
                if (target === 'notificaciones') syncNotifications();
                if (target === 'historial') {
                    populateWorkWeeks();
                    renderHistoryTable();
                }
            } else {
                v.classList.add('hidden');
                v.classList.remove('active');
            }
        });
    });
});

// ======================================
// 2. Admin Panel & Test Connection
// ======================================
adminForm.addEventListener('submit', (e) => {
    e.preventDefault();
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();
    
    // Switch to dashboard
    tabs[0].click();
});

btnTestConn.addEventListener('click', async () => {
    const tmpClient = new AconexClient(
        confProjectId.value.trim(),
        confUser.value.trim(),
        confPass.value.trim(),
        confRegion.value
    );

    btnTestConn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-slate-500 border-t-white rounded-full"></span> Probando...`;
    btnTestConn.disabled = true;

    try {
        await tmpClient.testConnection();
        testResultContainer.className = 'mt-4 p-3 rounded-lg text-sm text-center font-medium bg-green-500/10 text-green-400 border border-green-500/20';
        testResultContainer.innerHTML = `✅ Autenticación exitosa. Credenciales válidas en Aconex (${confRegion.value.toUpperCase()}).`;
        testResultContainer.classList.remove('hidden');
    } catch (e) {
        testResultContainer.className = 'mt-4 p-3 rounded-lg text-sm text-center font-medium bg-red-500/10 text-red-400 border border-red-500/20';
        testResultContainer.innerHTML = `❌ Falló la autenticación o API Inaccesible. Code: ${e.message}`;
        testResultContainer.classList.remove('hidden');
    } finally {
        btnTestConn.innerHTML = `Test Connection`;
        btnTestConn.disabled = false;
    }
});

btnTogglePass.addEventListener('click', (e) => {
    e.preventDefault();
    const type = confPass.getAttribute('type') === 'password' ? 'text' : 'password';
    confPass.setAttribute('type', type);
    if (type === 'text') {
        iconEyeOpen.classList.add('hidden');
        iconEyeClosed.classList.remove('hidden');
    } else {
        iconEyeOpen.classList.remove('hidden');
        iconEyeClosed.classList.add('hidden');
    }
});

// ======================================
// 3. Rendering, Filters & Sorting
// ======================================
function getStatusBadge(status) {
    if (!status) return "";
    const s = status.toLowerCase();
    if (s.includes('aprobado')) return '<span class="badge badge-success">Aprobado</span>';
    if (s.includes('anulado') || s.includes('rechazado') || s.includes('cancelado')) return `<span class="badge badge-danger">${status}</span>`;
    return `<span class="badge badge-warning">${status}</span>`;
}

function handleSort(field) {
    if (sortState.field === field) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.field = field;
        sortState.direction = 'asc';
    }
    docCurrentPage = 1; // Reset to page 1 on sort
    
    // Update Icons UI
    document.querySelectorAll('th[data-sort] .sort-icon').forEach(icon => {
        icon.textContent = '↕';
        icon.classList.add('opacity-30');
    });
    const activeHeader = document.querySelector(`th[data-sort="${field}"]`);
    if (activeHeader) {
        const icon = activeHeader.querySelector('.sort-icon');
        icon.textContent = sortState.direction === 'asc' ? '↑' : '↓';
        icon.classList.remove('opacity-30');
        icon.classList.add('opacity-100');
    }

    renderTable();
}

document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
});

function applyFilters(data) {
    const today = new Date();
    const query = filterSearch.value.toLowerCase().trim();
    const contractorF = filterContractor.value;
    const specialtyF = filterSpecialty.value;

    return data.filter(doc => {
        const matchQ = !query || (doc.docno && doc.docno.toLowerCase().includes(query)) || (doc.title && doc.title.toLowerCase().includes(query));
        
        // Multi-select matches
        const matchS = selectedFilters.status.length === 0 || selectedFilters.status.includes(doc.status);
        const matchR = selectedFilters.revision.length === 0 || selectedFilters.revision.includes(doc.revision);
        const matchT = selectedFilters.doc_type.length === 0 || selectedFilters.doc_type.includes(doc.doc_type);
        
        // Single select matches
        const matchC = !contractorF || doc.author === contractorF;
        const matchSpec = !specialtyF || doc.specialty === specialtyF;
        
        // KPI Filter Logic
        let matchKPI = true;
        if (currentKPIFilter) {
            const status = (doc.status || '').toLowerCase();
            const rev = (doc.revision || '').toLowerCase();
            const modDateRaw = doc.modified_date;
            let businessDays = 0;
            if (modDateRaw) {
                const modDate = new Date(modDateRaw);
                if (!isNaN(modDate.getTime())) businessDays = getBusinessDaysDiff(modDate, today);
            }

            if (currentKPIFilter === 'pending') {
                matchKPI = status.includes('acción') || status.includes('pendiente') || status.includes('action');
            } else if (currentKPIFilter === 'revB') {
                matchKPI = rev === 'b';
            } else if (currentKPIFilter === 'revP') {
                matchKPI = rev === 'p' || rev === '0';
            } else if (currentKPIFilter === 'cmdic') {
                matchKPI = (status.includes('pendiente') || status.includes('acción')) && businessDays > 5;
            } else if (currentKPIFilter === 'esed') {
                const isAction = status.includes('acción') || status.includes('action');
                const isFYI = status.includes('conocimiento') || status.includes('fyi');
                const isCriticalRev = rev === 'b' || rev === 'c' || rev.startsWith('p');
                matchKPI = (isAction && businessDays > 5) || (isFYI && isCriticalRev && businessDays > 5);
            }
        }
        
        return matchQ && matchS && matchC && matchR && matchT && matchSpec && matchKPI;
    });
}

function toggleKPIFilter(kpi) {
    // Reset secondary filters when using KPI? User choice. Let's keep them and intersect.
    if (currentKPIFilter === kpi) {
        currentKPIFilter = null; // Unselect
    } else {
        currentKPIFilter = kpi;
    }
    
    // UI Update visual feedback
    document.querySelectorAll('.kpi-card').forEach(card => card.classList.remove('selected'));
    if (currentKPIFilter) {
        const idMap = {
            'all': 'kpiCardAll',
            'pending': 'kpiCardPending',
            'revB': 'kpiCardRevB',
            'revP': 'kpiCardRevP',
            'cmdic': 'kpiCardCmdic',
            'esed': 'kpiCardEsed'
        };
        const cardId = idMap[currentKPIFilter];
        const card = document.getElementById(cardId);
        if (card) card.classList.add('selected');
    }
    
    docCurrentPage = 1;
    renderTable();
}
window.toggleKPIFilter = toggleKPIFilter;

function updateDashboardKPIs(data) {
    const today = new Date();
    const statusMap = {
        total: data.length,
        pending: 0,
        revB: 0,
        revP: 0,
        delayedCMDIC: 0,
        delayedESED: 0
    };

    data.forEach(doc => {
        const status = (doc.status || '').toLowerCase();
        const rev = (doc.revision || '').toLowerCase();
        const modDateRaw = doc.modified_date;
        let businessDays = 0;
        
        if (modDateRaw) {
            const modDate = new Date(modDateRaw);
            if (!isNaN(modDate.getTime())) {
                businessDays = getBusinessDaysDiff(modDate, today);
            }
        }

        // 1. Pendientes
        if (status.includes('acción') || status.includes('pendiente') || status.includes('action')) {
            statusMap.pending++;
        }

        // 2. Rev B / b
        if (rev === 'b') statusMap.revB++;

        // 3. Rev P / p / 0
        if (rev === 'p' || rev === '0') statusMap.revP++;

        // 4. CMDIC Atrasados
        if ((status.includes('pendiente') || status.includes('acción')) && businessDays > 5) {
            statusMap.delayedCMDIC++;
        }

        // 5. ESED Atrasados
        const isAction = status.includes('acción') || status.includes('action');
        const isFYI = status.includes('conocimiento') || status.includes('fyi');
        const isCriticalRev = rev === 'b' || rev === 'c' || rev.startsWith('p');

        if (isAction && businessDays > 5) {
            statusMap.delayedESED++;
        } else if (isFYI && isCriticalRev && businessDays > 5) {
            statusMap.delayedESED++;
        }
    });

    // Update UI
    document.getElementById('kpiTotal').textContent = statusMap.total;
    document.getElementById('kpiPending').textContent = statusMap.pending;
    document.getElementById('kpiRevB').textContent = statusMap.revB;
    document.getElementById('kpiRevP').textContent = statusMap.revP;
    document.getElementById('kpiDelayedCMDIC').textContent = statusMap.delayedCMDIC;
    document.getElementById('kpiDelayedESED').textContent = statusMap.delayedESED;
}

function renderTable() {
    try {
        let filtered = applyFilters(localDB);
        updateDashboardKPIs(localDB); 

        // Sorting
        filtered.sort((a, b) => {
            let valA = a[sortState.field] || '';
            let valB = b[sortState.field] || '';
            
            if (sortState.field === 'modified_date') {
                valA = new Date(valA).getTime() || 0;
                valB = new Date(valB).getTime() || 0;
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
            return 0;
        });

        tblCount.textContent = filtered.length;

        // Pagination Logic
        const totalPages = Math.ceil(filtered.length / docPageSize) || 1;
        if (docCurrentPage > totalPages) docCurrentPage = totalPages;
        
        const start = (docCurrentPage - 1) * docPageSize;
        const end = start + docPageSize;
        const paginated = filtered.slice(start, end);

        // Update Paging UI
        if (document.getElementById('docCurrentPage')) document.getElementById('docCurrentPage').textContent = docCurrentPage;
        if (document.getElementById('docTotalPages')) document.getElementById('docTotalPages').textContent = totalPages;
        if (document.getElementById('docPrev')) document.getElementById('docPrev').disabled = (docCurrentPage <= 1);
        if (document.getElementById('docNext')) document.getElementById('docNext').disabled = (docCurrentPage >= totalPages);

        if (paginated.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="px-6 py-8 text-center text-slate-500 italic">No se encontraron documentos con los filtros aplicados.</td></tr>`;
            return;
        }

        let html = '';
        paginated.forEach(doc => {
            let displayDate = doc.modified_date;
            if (displayDate) {
                const date = new Date(displayDate);
                if (!isNaN(date)) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    displayDate = `${day}-${month}-${year}`;
                }
            }

            html += `
                <tr class="hover:bg-slate-800/80 transition-colors border-b border-slate-700/30">
                    <td class="px-6 py-4 font-mono text-xs text-brand font-bold">${doc.docno}</td>
                    <td class="px-6 py-4 truncate max-w-[200px]" title="${doc.title}">${doc.title || 'S/T'}</td>
                    <td class="px-6 py-4 text-center font-semibold text-xs">${doc.revision || '-'}</td>
                    <td class="px-6 py-4">${getStatusBadge(doc.status)}</td>
                    <td class="px-6 py-4 text-xs text-slate-400">${displayDate || 'N/A'}</td>
                    <td class="px-6 py-4 text-xs text-slate-300">${doc.author || 'N/A'}</td>
                    <td class="px-6 py-4 text-xs font-medium">${doc.specialty || 'General'}</td>
                    <td class="px-6 py-4 text-xs text-slate-400 italic">${doc.doc_type || 'N/A'}</td>
                    <td class="px-6 py-4 text-xs text-slate-400">${doc.contract || ''}</td>
                </tr>
            `;
        });
        tableBody.innerHTML = html;
    } catch (e) {
        console.error("Error en renderTable:", e);
    }
}

[filterSearch, filterContractor, filterSpecialty].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => { docCurrentPage = 1; renderTable(); });
    if(el.id === 'filterSearch') el.addEventListener('input', () => { docCurrentPage = 1; renderTable(); });
});

// ======================================
// 3. Multi-select Controller
// ======================================
function initMultiSelect(containerId, menuId, key, label) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const button = container.querySelector('button');
    const menu = document.getElementById(menuId);

    // Toggle menu
    button.onclick = (e) => {
        e.stopPropagation();
        const isActive = menu.classList.contains('active');
        // Cerrar otros
        document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.remove('active'));
        if (!isActive) menu.classList.add('active');
    };

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) menu.classList.remove('active');
    });

    // Update choices
    const updateSelections = () => {
        const checked = Array.from(menu.querySelectorAll('input:checked')).map(i => i.value);
        selectedFilters[key] = checked;
        
        // Update button text
        const span = button.querySelector('span');
        if (checked.length === 0) {
            span.textContent = `${label} (Todos)`;
        } else if (checked.length === 1) {
            span.textContent = checked[0];
        } else {
            span.textContent = `${checked.length} selecc.`;
        }
        
        docCurrentPage = 1;
        renderTable();
    };

    // Inyectar opciones dinámicas
    const values = [...new Set(localDB.map(d => d[key]).filter(Boolean))].sort();
    menu.innerHTML = values.map((val, idx) => `
        <div class="multiselect-option">
            <input type="checkbox" id="chk-${key}-${idx}" value="${val}" ${selectedFilters[key].includes(val) ? 'checked' : ''}>
            <label for="chk-${key}-${idx}">${val}</label>
        </div>
    `).join('');

    // Attach events to checkboxes
    menu.querySelectorAll('input').forEach(chk => {
        chk.onchange = updateSelections;
    });
}

function updateFilterOptions() {
    // 1. Single Selects
    const singleFields = [
        { id: 'filterContractor', key: 'author', label: 'Contratista' },
        { id: 'filterSpecialty', key: 'specialty', label: 'Disciplina' }
    ];

    singleFields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        const currentVal = el.value;
        const uniqueValues = [...new Set(localDB.map(d => d[f.key]).filter(v => v))].sort();
        
        let html = `<option value="">${f.label} (Todos)</option>`;
        uniqueValues.forEach(val => {
            html += `<option value="${val}" ${val === currentVal ? 'selected' : ''}>${val}</option>`;
        });
        el.innerHTML = html;
    });

    // 2. Multi Selects
    initMultiSelect('containerStatus', 'menuStatus', 'status', 'Estatus');
    initMultiSelect('containerRev', 'menuRev', 'revision', 'Rev');
    initMultiSelect('containerDocType', 'menuDocType', 'doc_type', 'Tipo Doc');
}

// Transmittal Filters & Sorting
[filterTransSearch, filterTransUser, filterTransOrg].forEach(el => {
    el.addEventListener('change', renderNotifications);
    if(el.id === 'filterTransSearch') el.addEventListener('input', renderNotifications);
});

function handleTransSort(field) {
    if (transSortState.field === field) {
        transSortState.direction = transSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        transSortState.field = field;
        transSortState.direction = 'asc';
    }
    
    document.querySelectorAll('th[data-sort-trans] .sort-icon').forEach(icon => {
        icon.textContent = '↕';
        icon.classList.add('opacity-30');
    });
    const activeHeader = document.querySelector(`th[data-sort-trans="${field}"]`);
    if (activeHeader) {
        const icon = activeHeader.querySelector('.sort-icon');
        icon.textContent = transSortState.direction === 'asc' ? '↑' : '↓';
        icon.classList.remove('opacity-30');
        icon.classList.add('opacity-100');
    }

    renderNotifications();
}

document.querySelectorAll('th[data-sort-trans]').forEach(th => {
    th.addEventListener('click', () => handleTransSort(th.dataset.sortTrans));
});

// ======================================
// 4. Notifications Engine
// ======================================
async function syncNotifications() {
    // Aseguramos que los valores estén actualizados desde el form (o Admin Panel)
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Por favor, ingresa tus credenciales en el Panel Admin antes de extraer Transmittals.");
        tabs[1].click(); // Redirigir a Admin
        return;
    }

    const originalText = btnRefreshNotif.innerHTML;
    btnRefreshNotif.innerHTML = `<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-slate-500 border-t-white rounded-full"></span> Extrayendo...`;
    btnRefreshNotif.disabled = true;
    
    notifTableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500 italic"><span class="animate-pulse">Consultando todos los Transmittals de Aconex...</span></td></tr>`;

    
    const engine = new SyncEngine(null, globalConfig);
    try {
        const syncOptions = {
            onProgress: (done, total, msg) => {
                const displayMsg = msg || `Descargando detalles... ${done} de ${total}`;
                notifTableBody.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-500 italic"><span class="animate-pulse">${displayMsg}</span></td></tr>`;
                if (techLog) techLog.value += `\r[SYNC] ${displayMsg}`;
            }
        };
        
        if (filterTransUnread && filterTransUnread.checked) {
            syncOptions.status = 'Unread';
        }

        localTransmittalsDB = await engine.syncAllTransmittals(syncOptions);

        updateTransFilterOptions();
        renderNotifications();
        
        // Ocultar badge al ver las notificaciones (limpiar estado)
        notifBadge.classList.add('hidden'); 
    } catch (e) {
        console.error("Error en syncNotifications:", e);
        // Mostramos el error detallado (que ahora incluye el cuerpo de la respuesta de Aconex)
        notifTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-12 text-center text-red-500 border border-red-500/20 bg-red-500/5">
                    <div class="font-bold mb-2">Error de la API (400/500):</div>
                    <div class="text-xs font-mono bg-slate-900 p-3 rounded border border-slate-700 max-w-xl mx-auto overflow-auto text-left">
                        ${e.message}
                    </div>
                    <div class="mt-4 text-xs text-slate-400">
                        Sugerencia: Verifica que el ID del proyecto sea correcto para la región seleccionada.
                    </div>
                </td>
            </tr>`;
    } finally {
        btnRefreshNotif.innerHTML = originalText;
        btnRefreshNotif.disabled = false;
    }
}

function applyTransFilters(data) {
    const query = filterTransSearch.value.toLowerCase();
    const userF = filterTransUser.value;
    const orgF = filterTransOrg.value;
    const recipientF = filterTransRecipient.value;
    const statusF = filterTransStatus.value;

    return data.filter(item => {
        const matchQ = !query || 
                      (item.subject && item.subject.toLowerCase().includes(query)) || 
                      (item.fromUser && item.fromUser.toLowerCase().includes(query)) ||
                      (item.mailNo && item.mailNo.toLowerCase().includes(query)) ||
                      (item.toUser && item.toUser.toLowerCase().includes(query));
        const matchU = !userF || item.fromUser === userF;
        const matchO = !orgF || item.fromOrg === orgF;
        const matchR = !recipientF || (item.toUser && item.toUser.includes(recipientF));
        const matchS = !statusF || item.status === statusF;
        
        return matchQ && matchU && matchO && matchR && matchS;
    });
}

function renderNotifications() {
    let filtered = applyTransFilters(localTransmittalsDB);

    // Sorting
    filtered.sort((a, b) => {
        let valA = a[transSortState.field] || '';
        let valB = b[transSortState.field] || '';
        
        if (transSortState.field === 'date') {
            valA = new Date(valA).getTime();
            valB = new Date(valB).getTime();
        } else {
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
        }

        if (valA < valB) return transSortState.direction === 'asc' ? -1 : 1;
        if (valA > valB) return transSortState.direction === 'asc' ? 1 : -1;
        return 0;
    });

    transCount.textContent = filtered.length;

    // Pagination Logic
    const totalPages = Math.ceil(filtered.length / transPageSize) || 1;
    if (transCurrentPage > totalPages) transCurrentPage = totalPages;

    const start = (transCurrentPage - 1) * transPageSize;
    const end = start + transPageSize;
    const paginated = filtered.slice(start, end);

    // Update Paging UI
    document.getElementById('transCurrentPage').textContent = transCurrentPage;
    document.getElementById('transTotalPages').textContent = totalPages;
    document.getElementById('transPrev').disabled = (transCurrentPage <= 1);
    document.getElementById('transNext').disabled = (transCurrentPage >= totalPages);

    if (paginated.length === 0) {
        notifTableBody.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-500 italic">No se encontraron Transmittals con los filtros aplicados.</td></tr>`;
        return;
    }

    let html = '';
    paginated.forEach(item => {
        const dateStr = item.date ? new Date(item.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A';
        const docInfo = item.docName ? `<span class="text-brand font-medium">${item.docName}</span> <span class="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 ml-1">${item.docRev}</span>` : '<span class="text-slate-500 italic">Sin adjunto</span>';
        const fileInfo = item.fileName ? `<div class="text-[10px] text-slate-500 mt-1"><i class="far fa-file-pdf mr-1"></i>${item.fileName}</div>` : '';

        html += `
            <tr class="hover:bg-slate-800/80 transition-colors border-b border-slate-700/30">
                <td class="px-6 py-4 text-xs font-mono text-slate-400">${dateStr}</td>
                <td class="px-6 py-4 font-medium text-slate-200">${item.mailNo || item.id}</td>
                <td class="px-6 py-4 whitespace-normal max-w-xs">
                    <div class="text-slate-100 font-medium truncate" title="${item.subject}">${item.subject}</div>
                </td>
                <td class="px-6 py-4 text-xs">
                    <div class="text-slate-200">${item.fromUser}</div>
                    <div class="text-slate-500">${item.fromOrg}</div>
                </td>
                <td class="px-6 py-4 text-xs max-w-[150px] overflow-hidden text-ellipsis text-slate-400" title="${item.toUser}">
                    ${item.toUser}
                </td>
                <td class="px-6 py-4">
                    <span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${item.status === 'Approved' ? 'bg-green-500/10 text-green-400' : 'bg-slate-700 text-slate-300'}">
                        ${item.status || 'N/A'}
                    </span>
                </td>
                <td class="px-6 py-4 text-xs">
                    ${docInfo}
                    ${fileInfo}
                </td>
            </tr>
        `;
    });
    notifTableBody.innerHTML = html;
}

function updateTransFilterOptions() {
    const fields = [
        { id: 'filterTransUser', key: 'fromUser', label: 'Remitente' },
        { id: 'filterTransOrg', key: 'fromOrg', label: 'Organización' },
        { id: 'filterTransStatus', key: 'status', label: 'Estatus' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        const currentVal = el.value;
        const uniqueValues = [...new Set(localTransmittalsDB.map(i => i[f.key]))].filter(Boolean).sort();
        
        el.innerHTML = `<option value="">${f.label} (Todos)</option>` + 
                       uniqueValues.map(v => `<option value="${v}" ${v === currentVal ? 'selected' : ''}>${v}</option>`).join('');
    });

    // Filtro especial para Destinatarios (ya que pueden ser múltiples en un solo registro)
    const recipientEl = document.getElementById('filterTransRecipient');
    const currentR = recipientEl.value;
    let allRecipients = [];
    localTransmittalsDB.forEach(item => {
        if (item.toUser) {
            allRecipients = allRecipients.concat(item.toUser.split(', ').map(s => s.trim()));
        }
    });
    const uniqueRecipients = [...new Set(allRecipients)].filter(Boolean).sort();
    recipientEl.innerHTML = `<option value="">Destinatario (Todos)</option>` + 
                            uniqueRecipients.map(v => `<option value="${v}" ${v === currentR ? 'selected' : ''}>${v}</option>`).join('');
}

btnRefreshNotif.addEventListener('click', syncNotifications);
filterTransSearch.addEventListener('input', () => { transCurrentPage = 1; renderNotifications(); });
filterTransUser.addEventListener('change', () => { transCurrentPage = 1; renderNotifications(); });
filterTransOrg.addEventListener('change', () => { transCurrentPage = 1; renderNotifications(); });
filterTransRecipient.addEventListener('change', () => { transCurrentPage = 1; renderNotifications(); });
filterTransStatus.addEventListener('change', () => { transCurrentPage = 1; renderNotifications(); });

// Pagination Listeners
document.getElementById('docPrev').addEventListener('click', () => { if (docCurrentPage > 1) { docCurrentPage--; renderTable(); } });
document.getElementById('docNext').addEventListener('click', () => { 
    const totalPages = Math.ceil(applyFilters(localDB).length / docPageSize);
    if (docCurrentPage < totalPages) { docCurrentPage++; renderTable(); } 
});
document.getElementById('docPagingSize').addEventListener('change', (e) => {
    docPageSize = parseInt(e.target.value);
    docCurrentPage = 1;
    renderTable();
});

document.getElementById('transPrev').addEventListener('click', () => { if (transCurrentPage > 1) { transCurrentPage--; renderNotifications(); } });
document.getElementById('transNext').addEventListener('click', () => { 
    const totalPages = Math.ceil(applyTransFilters(localTransmittalsDB).length / transPageSize);
    if (transCurrentPage < totalPages) { transCurrentPage++; renderNotifications(); } 
});
document.getElementById('transPagingSize').addEventListener('change', (e) => {
    transPageSize = parseInt(e.target.value);
    transCurrentPage = 1;
    renderNotifications();
});

// ======================================
// 5. Synchronization Orchestration
// ======================================

function getLastSyncSearchQuery() {
    const lastSync = localStorage.getItem('aconex_last_sync');
    if (!lastSync) return null;
    const date = new Date(lastSync);
    if (isNaN(date.getTime())) return null;
    
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `lastmodified:[${yyyy}${mm}${dd} TO *]`;
}

function updateLastSyncUI() {
    const lastSync = localStorage.getItem('aconex_last_sync');
    if (lastSync) {
        const date = new Date(lastSync);
        if (!isNaN(date.getTime())) {
            const formatted = date.toLocaleString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            lastSyncLabel.textContent = `Última sincronización: ${formatted}`;
            return;
        }
    }
    lastSyncLabel.textContent = `Última sincronización: Nunca`;
}

async function executeSync({ silent = false } = {}) {
    if (isSyncing) return;
    
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        if (!silent) {
            alert("Por favor, configura las credenciales en el Panel Admin.");
            tabs[1].click();
        }
        return;
    }

    isSyncing = true;
    btnStartSync.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    circuitBanner.classList.add('hidden');
    
    if (techLog) techLog.value = "";
    
    const engine = new SyncEngine(null, globalConfig);
    const searchQuery = getLastSyncSearchQuery();
    
    if (techLog && searchQuery) {
        techLog.value += `[SYNC] Iniciando sincronización incremental con filtro: ${searchQuery}\n\n`;
    } else if (techLog) {
        techLog.value += `[SYNC] Iniciando sincronización completa.\n\n`;
    }

    try {
        await engine.syncAllData({
            pageSize: parseInt(confPageSize.value, 10),
            searchQuery: searchQuery || undefined,
            onProgress: (current, total) => {
                const percent = Math.round((current / total) * 100);
                progressText.textContent = `Página ${current} de ${total}`;
                progressPercent.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
            },
            onDocumentUpsert: async (doc) => {
                const idx = localDB.findIndex(d => d.docno === doc.docno);
                if (idx > -1) {
                    localDB[idx] = doc;
                } else {
                    localDB.push(doc);
                }
            },
            onRawResponse: (xml) => {
                if (techLog) techLog.value += `--- RESPUESTA XML ---\n${xml}\n\n`;
            },
            onCircuitBreakerTrip: () => {
                circuitBanner.classList.remove('hidden');
                btnStartSync.disabled = true;
                throw new Error("UI Sync Aborted by Sentinel.");
            },
            onFinish: () => {
                isSyncing = false;
                btnStartSync.classList.remove('hidden');
                progressContainer.classList.add('hidden');
                
                localStorage.setItem('aconex_last_sync', new Date().toISOString());
                localStorage.setItem('aconex_local_db', JSON.stringify(localDB));
                updateLastSyncUI();
                
                updateFilterOptions();
                renderTable();
                
                if (techLog) techLog.value += `[SYNC] Completada con éxito.\n`;
            },
            onError: (err) => {
                isSyncing = false;
                btnStartSync.classList.remove('hidden');
                progressContainer.classList.add('hidden');
                
                if (err.message !== "UI Sync Aborted by Sentinel." && !silent) {
                    alert(`Error: ${err.message}`);
                }
                
                localStorage.setItem('aconex_local_db', JSON.stringify(localDB));
                updateFilterOptions();
                renderTable();
                
                if (techLog) techLog.value += `[SYNC] Error: ${err.message}\n`;
            }
        });
    } catch (e) {
        console.error("Error en executeSync:", e);
    }
}

btnStartSync.addEventListener('click', () => executeSync({ silent: false }));

btnClearDB.addEventListener('click', () => {
    if (confirm("¿Está seguro de que desea restablecer la base de datos local? Esto eliminará todos los registros en memoria y forzará una sincronización completa en la próxima ejecución.")) {
        localDB = [];
        localStorage.removeItem('aconex_local_db');
        localStorage.removeItem('aconex_last_sync');
        updateLastSyncUI();
        renderTable();
        updateFilterOptions();
    }
});

// Auto Sync Scheduler State & Control
let autoSyncTimer = null;

function setupAutoSyncScheduler() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
    
    const active = localStorage.getItem('aconex_auto_sync_active') === 'true';
    const intervalMinutes = parseInt(localStorage.getItem('aconex_auto_sync_interval') || '15', 10);
    
    if (active && !isNaN(intervalMinutes)) {
        const intervalMs = intervalMinutes * 60 * 1000;
        autoSyncTimer = setInterval(() => {
            executeSync({ silent: true });
        }, intervalMs);
        console.log(`Auto-Sync programado cada ${intervalMinutes} minutos.`);
    }
}

// Interceptamos la actualización de credenciales para salvar también la config de auto-sync
adminForm.addEventListener('submit', (e) => {
    // La lógica base del submit original ya se ejecuta arriba, pero aquí persistimos en localStorage los campos automáticos.
    localStorage.setItem('aconex_auto_sync_active', syncAutoActive.checked);
    localStorage.setItem('aconex_auto_sync_interval', syncAutoInterval.value);
    
    setupAutoSyncScheduler();
});

// Load Auto Sync config and update UI elements on load
try {
    syncAutoActive.checked = localStorage.getItem('aconex_auto_sync_active') === 'true';
    syncAutoInterval.value = localStorage.getItem('aconex_auto_sync_interval') || '15';
} catch (e) {
    console.warn("Error cargando config de auto-sync:", e);
}

// Initial renders and setups
updateLastSyncUI();
updateFilterOptions();
renderTable();
setupAutoSyncScheduler();

// ======================================
// 6. Document History Tab Logic
// ======================================

function populateWorkWeeks() {
    if (histWeekSelect.children.length > 1) return; // Ya está cargado
    
    const months = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio", 
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ];
    
    // Obtener lunes de esta semana (en hora local, truncado)
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const currentMonday = new Date(today.setDate(diff));
    currentMonday.setHours(0,0,0,0);
    
    let html = '<option value="">-- Cargar Semana --</option>';
    
    for (let i = 0; i < 12; i++) {
        const mon = new Date(currentMonday);
        mon.setDate(mon.getDate() - (i * 7));
        
        const fri = new Date(mon);
        fri.setDate(fri.getDate() + 4);
        
        // Formatear fechas para mostrar al usuario (ej. 8 - 12 de junio)
        const monDay = mon.getDate();
        const monMonth = months[mon.getMonth()];
        const friDay = fri.getDate();
        const friMonth = months[fri.getMonth()];
        
        let weekText = "";
        if (mon.getMonth() === fri.getMonth()) {
            weekText = `${monDay} - ${friDay} de ${monMonth}`;
        } else {
            weekText = `${monDay} de ${monMonth} - ${friDay} de ${friMonth}`;
        }
        
        if (i === 0) {
            weekText = `Esta semana (${weekText})`;
        } else if (i === 1) {
            weekText = `Semana anterior (${weekText})`;
        }
        
        // Fechas en formato YYYY-MM-DD para cargar en los inputs
        const monVal = mon.toISOString().split('T')[0];
        const friVal = fri.toISOString().split('T')[0];
        
        html += `<option value="${monVal}|${friVal}">${weekText}</option>`;
    }
    histWeekSelect.innerHTML = html;
}

histWeekSelect.addEventListener('change', () => {
    const val = histWeekSelect.value;
    if (!val) return;
    const [start, end] = val.split('|');
    histDateStart.value = start;
    histDateEnd.value = end;
    histCurrentPage = 1;
});

function applyHistoryFilters(data) {
    const query = filterHistSearch.value.toLowerCase().trim();
    const contractorF = filterHistContractor.value;
    const specialtyF = filterHistSpecialty.value;

    return data.filter(doc => {
        const matchQ = !query || (doc.docno && doc.docno.toLowerCase().includes(query)) || (doc.title && doc.title.toLowerCase().includes(query));
        
        // Multi-selects
        const matchS = selectedHistFilters.status.length === 0 || selectedHistFilters.status.includes(doc.status);
        const matchR = selectedHistFilters.revision.length === 0 || selectedHistFilters.revision.includes(doc.revision);
        const matchT = selectedHistFilters.doc_type.length === 0 || selectedHistFilters.doc_type.includes(doc.doc_type);
        
        // Single selects
        const matchC = !contractorF || doc.author === contractorF;
        const matchSpec = !specialtyF || doc.specialty === specialtyF;
        
        return matchQ && matchS && matchC && matchR && matchT && matchSpec;
    });
}

function renderHistoryTable() {
    try {
        let filtered = applyHistoryFilters(historyDB);
        
        // Ordenamiento
        filtered.sort((a, b) => {
            let valA = a[histSortState.field] || '';
            let valB = b[histSortState.field] || '';
            
            if (histSortState.field === 'modified_date') {
                valA = new Date(valA).getTime() || 0;
                valB = new Date(valB).getTime() || 0;
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return histSortState.direction === 'asc' ? -1 : 1;
            if (valA > valB) return histSortState.direction === 'asc' ? 1 : -1;
            return 0;
        });

        tblHistCount.textContent = filtered.length;

        // Paginación
        const totalPages = Math.ceil(filtered.length / histPageSize) || 1;
        if (histCurrentPage > totalPages) histCurrentPage = totalPages;
        
        const start = (histCurrentPage - 1) * histPageSize;
        const end = start + histPageSize;
        const paginated = filtered.slice(start, end);

        document.getElementById('histCurrentPage').textContent = histCurrentPage;
        document.getElementById('histTotalPages').textContent = totalPages;
        histPrev.disabled = (histCurrentPage <= 1);
        histNext.disabled = (histCurrentPage >= totalPages);

        if (paginated.length === 0) {
            tableHistBody.innerHTML = `<tr><td colspan="10" class="px-6 py-8 text-center text-slate-500 italic">No se encontraron registros en el historial.</td></tr>`;
            return;
        }

        let html = '';
        paginated.forEach(doc => {
            let displayDate = doc.modified_date;
            if (displayDate) {
                const date = new Date(displayDate);
                if (!isNaN(date)) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    displayDate = `${day}-${month}-${year}`;
                }
            }

            html += `
                <tr class="hover:bg-slate-800/80 transition-colors border-b border-slate-700/30">
                    <td class="px-6 py-4 font-mono text-xs text-brand font-bold">${doc.docno}</td>
                    <td class="px-6 py-4 truncate max-w-[200px]" title="${doc.title}">${doc.title || 'S/T'}</td>
                    <td class="px-6 py-4 text-center font-semibold text-xs">${doc.revision || '-'}</td>
                    <td class="px-6 py-4">${getStatusBadge(doc.status)}</td>
                    <td class="px-6 py-4 text-xs text-slate-400">${displayDate || 'N/A'}</td>
                    <td class="px-6 py-4 text-center text-xs font-bold text-brand">${doc.version || '1'}</td>
                    <td class="px-6 py-4 text-xs text-slate-300">${doc.author || 'N/A'}</td>
                    <td class="px-6 py-4 text-xs font-medium">${doc.specialty || 'General'}</td>
                    <td class="px-6 py-4 text-xs text-slate-400 italic">${doc.doc_type || 'N/A'}</td>
                    <td class="px-6 py-4 text-xs text-slate-400">${doc.contract || ''}</td>
                </tr>
            `;
        });
        tableHistBody.innerHTML = html;
    } catch (e) {
        console.error("Error en renderHistoryTable:", e);
    }
}

function initHistMultiSelect(containerId, menuId, key, label) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const button = container.querySelector('button');
    const menu = document.getElementById(menuId);

    button.onclick = (e) => {
        e.stopPropagation();
        const isActive = menu.classList.contains('active');
        document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.remove('active'));
        if (!isActive) menu.classList.add('active');
    };

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) menu.classList.remove('active');
    });

    const updateSelections = () => {
        const checked = Array.from(menu.querySelectorAll('input:checked')).map(i => i.value);
        selectedHistFilters[key] = checked;
        
        const span = button.querySelector('span');
        if (checked.length === 0) {
            span.textContent = `${label} (Todos)`;
        } else if (checked.length === 1) {
            span.textContent = checked[0];
        } else {
            span.textContent = `${checked.length} selecc.`;
        }
        
        histCurrentPage = 1;
        renderHistoryTable();
    };

    const values = [...new Set(historyDB.map(d => d[key]).filter(Boolean))].sort();
    menu.innerHTML = values.map((val, idx) => `
        <div class="multiselect-option">
            <input type="checkbox" id="chk-hist-${key}-${idx}" value="${val}" ${selectedHistFilters[key].includes(val) ? 'checked' : ''}>
            <label for="chk-hist-${key}-${idx}">${val}</label>
        </div>
    `).join('');

    menu.querySelectorAll('input').forEach(chk => {
        chk.onchange = updateSelections;
    });
}

function updateHistFilterOptions() {
    // 1. Selects Simples
    const singleFields = [
        { id: 'filterHistContractor', key: 'author', label: 'Contratista' },
        { id: 'filterHistSpecialty', key: 'specialty', label: 'Disciplina' }
    ];

    singleFields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        const currentVal = el.value;
        const uniqueValues = [...new Set(historyDB.map(d => d[f.key]).filter(v => v))].sort();
        
        let html = `<option value="">${f.label} (Todos)</option>`;
        uniqueValues.forEach(val => {
            html += `<option value="${val}" ${val === currentVal ? 'selected' : ''}>${val}</option>`;
        });
        el.innerHTML = html;
    });

    // 2. Selects Múltiples
    initHistMultiSelect('containerHistStatus', 'menuHistStatus', 'status', 'Estatus');
    initHistMultiSelect('containerHistRev', 'menuHistRev', 'revision', 'Rev');
    initHistMultiSelect('containerHistDocType', 'menuHistDocType', 'doc_type', 'Tipo Doc');
}

btnStartHistSync.addEventListener('click', async () => {
    if (isSyncing) return;
    
    const startStr = histDateStart.value;
    const endStr = histDateEnd.value;
    
    if (!startStr || !endStr) {
        alert("Por favor, selecciona un rango de fechas o una semana laboral.");
        return;
    }
    
    // Formatear fechas a YYYYMMDD para Aconex
    const startFormatted = startStr.replace(/-/g, '');
    const endFormatted = endStr.replace(/-/g, '');
    const searchQuery = `lastmodified:[${startFormatted} TO ${endFormatted}]`;

    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Por favor, configura las credenciales en el Panel Admin.");
        tabs[2].click(); // Redirigir a Admin (ahora es el tab index 2)
        return;
    }

    isSyncing = true;
    btnStartHistSync.disabled = true;
    histProgressContainer.classList.remove('hidden');
    
    historyDB = [];
    if (techLog) techLog.value = "";
    
    const engine = new SyncEngine(null, globalConfig);

    try {
        await engine.syncAllData({
            pageSize: parseInt(confPageSize.value, 10),
            searchQuery: searchQuery,
            showDocumentHistory: true,
            onProgress: (current, total) => {
                const percent = Math.round((current / total) * 100);
                histProgressText.textContent = `Página ${current} de ${total}`;
                histProgressPercent.textContent = `${percent}%`;
                histProgressBar.style.width = `${percent}%`;
            },
            onDocumentUpsert: async (doc) => {
                // En historial no deduplicamos por docno, ya que queremos ver todas las versiones.
                // Sin embargo, para no duplicar exactamente el mismo registro si repetimos la carga,
                // podemos validar la dupla única docno + version.
                const idx = historyDB.findIndex(d => d.docno === doc.docno && d.version === doc.version);
                if (idx > -1) {
                    historyDB[idx] = doc;
                } else {
                    historyDB.push(doc);
                }
            },
            onRawResponse: (xml) => {
                if (techLog) techLog.value += `--- RESPUESTA HISTORIAL XML ---\n${xml}\n\n`;
            },
            onCircuitBreakerTrip: () => {
                alert("Sincronización de Historial bloqueada por el Sentinel.");
                throw new Error("Historial Sync Aborted by Sentinel.");
            },
            onFinish: () => {
                isSyncing = false;
                btnStartHistSync.disabled = false;
                histProgressContainer.classList.add('hidden');
                
                updateHistFilterOptions();
                renderHistoryTable();
            },
            onError: (err) => {
                isSyncing = false;
                btnStartHistSync.disabled = false;
                histProgressContainer.classList.add('hidden');
                
                if (err.message !== "Historial Sync Aborted by Sentinel.") {
                    alert(`Error extrayendo historial: ${err.message}`);
                }
                updateHistFilterOptions();
                renderHistoryTable();
            }
        });
    } catch (e) {
        console.error("Error en extracción de historial:", e);
    }
});

// Eventos de Filtro de Historial
[filterHistSearch, filterHistContractor, filterHistSpecialty].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => { histCurrentPage = 1; renderHistoryTable(); });
    if(el.id === 'filterHistSearch') el.addEventListener('input', () => { histCurrentPage = 1; renderHistoryTable(); });
});

// Paginación de Historial
histPrev.addEventListener('click', () => { if (histCurrentPage > 1) { histCurrentPage--; renderHistoryTable(); } });
histNext.addEventListener('click', () => { 
    const totalPages = Math.ceil(applyHistoryFilters(historyDB).length / histPageSize);
    if (histCurrentPage < totalPages) { histCurrentPage++; renderHistoryTable(); } 
});
histPagingSize.addEventListener('change', (e) => {
    histPageSize = parseInt(e.target.value);
    histCurrentPage = 1;
    renderHistoryTable();
});

// Cabeceras ordenables del Historial
document.querySelectorAll('th[data-sort-hist]').forEach(th => {
    th.addEventListener('click', () => {
        const field = th.dataset.sortHist;
        if (histSortState.field === field) {
            histSortState.direction = histSortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            histSortState.field = field;
            histSortState.direction = 'asc';
        }
        histCurrentPage = 1;
        
        document.querySelectorAll('th[data-sort-hist] .sort-icon').forEach(icon => {
            icon.textContent = '↕';
            icon.classList.add('opacity-30');
        });
        const activeHeader = document.querySelector(`th[data-sort-hist="${field}"]`);
        if (activeHeader) {
            const icon = activeHeader.querySelector('.sort-icon');
            icon.textContent = histSortState.direction === 'asc' ? '↑' : '↓';
            icon.classList.remove('opacity-30');
            icon.classList.add('opacity-100');
        }
        renderHistoryTable();
    });
});
