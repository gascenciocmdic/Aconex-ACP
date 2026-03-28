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

// Dashboard UI
const btnStartSync = document.getElementById('btnStartSync');
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

// State
let localDB = []; 
let localTransmittalsDB = [];
let isSyncing = false;

// Pagination State
let docCurrentPage = 1;
let docPageSize = 50;
let transSortState = { field: 'date', direction: 'desc' };
let transCurrentPage = 1;
const transPageSize = 50; 
let hasNextTransPage = false;
let isTransLoading = false;
let transSearchTimeout = null;
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

// ======================================
// 4. Notifications Engine
// ======================================
// ======================================
// 4. Notifications Engine (Senior UX)
// ======================================
async function syncNotifications(isLoadMore = false) {
    if (isTransLoading) return;

    // Actualizar configuración desde UI
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Credenciales requeridas en Panel Admin.");
        tabs[1].click();
        return;
    }

    if (!isLoadMore) {
        transCurrentPage = 1;
        localTransmittalsDB = [];
        const grid = document.getElementById('notifCardGrid');
        if (grid) grid.innerHTML = '';
        document.getElementById('notifEmptyState').classList.add('hidden');
    } else {
        transCurrentPage++;
    }

    isTransLoading = true;
    btnRefreshNotif.disabled = true;
    const skeleton = document.getElementById('notifSkeletonContainer');
    const loadMoreCont = document.getElementById('notifLoadMoreContainer');
    
    if (skeleton) skeleton.classList.remove('hidden');
    if (loadMoreCont) loadMoreCont.classList.add('hidden');

    const engine = new SyncEngine(null, globalConfig);
    
    try {
        const result = await engine.fetchTransmittalBatch({
            page: transCurrentPage,
            pageSize: transPageSize,
            status: (document.getElementById('filterTransUnread')?.checked) ? 'Unread' : null
        });

        localTransmittalsDB = isLoadMore ? [...localTransmittalsDB, ...result.data] : result.data;
        hasNextTransPage = result.hasNextPage;
        
        const countEl = document.getElementById('transCount');
        if (countEl) countEl.textContent = localTransmittalsDB.length;
        
        renderNotifications();
        updateTransFilterOptions();
        
        if (hasNextTransPage && loadMoreCont) {
            loadMoreCont.classList.remove('hidden');
            const pageCounter = document.getElementById('transPageCounter');
            if (pageCounter) pageCounter.textContent = `Página ${transCurrentPage}`;
        }

        if (localTransmittalsDB.length === 0 && !hasNextTransPage) {
            document.getElementById('notifEmptyState').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Error Senior UX Sync:", e);
        const grid = document.getElementById('notifCardGrid');
        if (grid) {
            grid.innerHTML = `<div class="col-span-full p-6 bg-red-500/10 text-red-500 rounded-xl border border-red-500/20 text-xs font-mono">${e.message}</div>`;
        }
    } finally {
        isTransLoading = false;
        btnRefreshNotif.disabled = false;
        if (skeleton) skeleton.classList.add('hidden');
    }
}

function renderNotifications() {
    const query = filterTransSearch.value.toLowerCase();
    const orgF = filterTransOrg.value;
    const grid = document.getElementById('notifCardGrid');
    if (!grid) return;

    const filtered = localTransmittalsDB.filter(item => {
        const matchQ = !query || (
            item.subject?.toLowerCase().includes(query) || 
            item.fromUser?.toLowerCase().includes(query) || 
            item.mailNo?.toLowerCase().includes(query)
        );
        const matchO = !orgF || item.fromOrg === orgF;
        return matchQ && matchO;
    });

    if (filtered.length === 0 && !isTransLoading) {
        grid.innerHTML = (localTransmittalsDB.length > 0) ? 
            `<div class="col-span-full py-12 text-center text-slate-500 italic">No hay coincidencias con los filtros aplicados.</div>` : '';
        return;
    }

    grid.innerHTML = filtered.map(item => {
        const dateStr = item.date ? new Date(item.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : 'N/A';
        return `
            <div class="trans-card ${item.isUnread ? 'unread' : ''} p-6 rounded-2xl animate-fade-in">
                <div class="flex justify-between items-start mb-4">
                    <span class="text-[10px] font-bold text-brand tracking-widest uppercase">${item.mailNo || 'CORREO'}</span>
                    <span class="text-[10px] text-slate-500 font-medium">${dateStr}</span>
                </div>
                <h3 class="text-sm font-bold text-slate-100 leading-tight mb-2 line-clamp-2" title="${item.subject}">${item.subject || '(Sin Asunto)'}</h3>
                <div class="flex items-center gap-3 mt-4 pt-4 border-t border-slate-700/30">
                    <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-brand font-bold text-xs ring-1 ring-slate-700">
                        ${(item.fromUser || 'U').charAt(0)}
                    </div>
                    <div class="flex flex-col min-w-0">
                        <span class="text-xs font-semibold text-slate-200 truncate">${item.fromUser}</span>
                        <span class="text-[10px] text-slate-500 truncate">${item.fromOrg}</span>
                    </div>
                </div>
                ${item.docName ? `
                <div class="mt-4 flex items-center gap-2 px-3 py-2 bg-slate-900/40 rounded-lg border border-slate-700/30">
                    <svg class="w-3 h-3 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                    <span class="text-[10px] text-slate-400 truncate">${item.docName}</span>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

function updateTransFilterOptions() {
    const orgSelect = document.getElementById('filterTransOrg');
    if (!orgSelect) return;
    
    const currentVal = orgSelect.value;
    const orgs = [...new Set(localTransmittalsDB.map(i => i.fromOrg).filter(Boolean))].sort();
    
    orgSelect.innerHTML = `<option value="">Todas las Organizaciones</option>` + 
                          orgs.map(o => `<option value="${o}" ${o === currentVal ? 'selected' : ''}>${o}</option>`).join('');
}

// Event Listeners (Senior UX)
btnRefreshNotif.addEventListener('click', () => syncNotifications(false));
document.getElementById('btnLoadMoreTrans')?.addEventListener('click', () => syncNotifications(true));

filterTransSearch.addEventListener('input', () => {
    clearTimeout(transSearchTimeout);
    transSearchTimeout = setTimeout(renderNotifications, 300);
});

filterTransOrg.addEventListener('change', renderNotifications);
document.getElementById('filterTransUnread')?.addEventListener('change', () => syncNotifications(false));


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
btnStartSync.addEventListener('click', async () => {
    if (isSyncing) return;
    
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.region = confRegion.value;
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Por favor, configura las credenciales en el Panel Admin.");
        tabs[1].click();
        return;
    }

    isSyncing = true;
    btnStartSync.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    circuitBanner.classList.add('hidden');
    
    localDB = [];
    techLog.value = "";
    
    const engine = new SyncEngine(null, globalConfig);

    try {
        await engine.syncAllData({
            pageSize: parseInt(confPageSize.value, 10),
            onProgress: (current, total) => {
                const percent = Math.round((current / total) * 100);
                progressText.textContent = `Página ${current} de ${total}`;
                progressPercent.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
                
                // Renderizado incremental por página
                renderTable();
                updateFilterOptions();
            },
            onDocumentUpsert: async (doc) => {
                const idx = localDB.findIndex(d => d.docno === doc.docno);
                if (idx > -1) localDB[idx] = doc;
                else localDB.push(doc);
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
                updateFilterOptions();
                renderTable();
            },
            onError: (err) => {
                isSyncing = false;
                btnStartSync.classList.remove('hidden');
                progressContainer.classList.add('hidden');
                if (err.message !== "UI Sync Aborted by Sentinel.") alert(`Error: ${err.message}`);
                updateFilterOptions();
                renderTable();
            }
        });
    } catch (e) {}
});
