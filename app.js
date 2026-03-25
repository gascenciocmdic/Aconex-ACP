import SyncEngine from './syncEngine.js';
import AconexClient from './aconexApi.js';

// DOM Elements
const tabs = document.querySelectorAll('.nav-tab');
const views = document.querySelectorAll('.view-section');

// Configuration Form
const adminForm = document.getElementById('adminForm');
const confAppKey = document.getElementById('confAppKey');
const confProjectId = document.getElementById('confProjectId');
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

// Table and Filters
const tableBody = document.getElementById('tableBody');
const tblCount = document.getElementById('tblCount');
const filterSearch = document.getElementById('filterSearch');
const filterStatus = document.getElementById('filterStatus');
const filterContractor = document.getElementById('filterContractor');
const filterRev = document.getElementById('filterRev');
const filterDocType = document.getElementById('filterDocType');
const filterSpecialty = document.getElementById('filterSpecialty');
const confPageSize = document.getElementById('confPageSize');

// Notification UI
const notifTableBody = document.getElementById('notifTableBody');
const btnRefreshNotif = document.getElementById('btnRefreshNotif');
const filterTransSearch = document.getElementById('filterTransSearch');
const filterTransUser = document.getElementById('filterTransUser');
const filterTransOrg = document.getElementById('filterTransOrg');
const transCount = document.getElementById('transCount');

// State
let localDB = []; 
let localTransmittalsDB = [];
let isSyncing = false;
let globalConfig = {
    projectId: confProjectId.value,
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
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();
    
    // Switch to dashboard
    tabs[0].click();
});

btnTestConn.addEventListener('click', async () => {
    const tmpClient = new AconexClient(
        confProjectId.value.trim(),
        confUser.value.trim(),
        confPass.value.trim()
    );

    btnTestConn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-slate-500 border-t-white rounded-full"></span> Probando...`;
    btnTestConn.disabled = true;

    try {
        await tmpClient.testConnection();
        testResultContainer.className = 'mt-4 p-3 rounded-lg text-sm text-center font-medium bg-green-500/10 text-green-400 border border-green-500/20';
        testResultContainer.innerHTML = `✅ Autenticación exitosa. Credenciales válidas en Aconex (US1).`;
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

function renderTable() {
    const query = filterSearch.value.toLowerCase();
    const statusF = filterStatus.value;
    const contractorF = filterContractor.value;
    const revF = filterRev.value;
    const docTypeF = filterDocType.value;
    const specialtyF = filterSpecialty.value;

    let filtered = localDB.filter(doc => {
        const matchQ = !query || doc.docno.toLowerCase().includes(query) || doc.title.toLowerCase().includes(query);
        const matchS = !statusF || doc.status === statusF;
        const matchC = !contractorF || doc.author === contractorF;
        const matchR = !revF || doc.revision === revF;
        const matchT = !docTypeF || doc.doc_type === docTypeF;
        const matchSpec = !specialtyF || doc.specialty === specialtyF;
        
        return matchQ && matchS && matchC && matchR && matchT && matchSpec;
    });

    // Sorting
    filtered.sort((a, b) => {
        let valA = a[sortState.field] || '';
        let valB = b[sortState.field] || '';
        
        if (sortState.field === 'modified_date') {
            valA = new Date(valA).getTime();
            valB = new Date(valB).getTime();
        } else {
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
        }

        if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
        return 0;
    });

    tblCount.textContent = filtered.length;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="px-6 py-8 text-center text-slate-500">No hay resultados para mostrar.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(doc => {
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
}

[filterSearch, filterStatus, filterContractor, filterRev, filterDocType, filterSpecialty].forEach(el => {
    el.addEventListener('change', renderTable);
    if(el.id === 'filterSearch') el.addEventListener('input', renderTable);
});

function updateFilterOptions() {
    const fields = [
        { id: 'filterStatus', key: 'status', label: 'Estatus' },
        { id: 'filterContractor', key: 'author', label: 'Contratista' },
        { id: 'filterRev', key: 'revision', label: 'Rev' },
        { id: 'filterDocType', key: 'doc_type', label: 'Tipo Doc' },
        { id: 'filterSpecialty', key: 'specialty', label: 'Disciplina' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        const currentVal = el.value;
        const uniqueValues = [...new Set(localDB.map(d => d[f.key]).filter(v => v))].sort();
        
        let html = `<option value="">${f.label} (Todos)</option>`;
        uniqueValues.forEach(val => {
            html += `<option value="${val}" ${val === currentVal ? 'selected' : ''}>${val}</option>`;
        });
        el.innerHTML = html;
    });
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
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Por favor, ingresa tus credenciales en el Panel Admin antes de extraer Transmittals.");
        tabs[1].click(); // Redirigir a Admin
        return;
    }
    
    notifTableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500 italic"><span class="animate-pulse">Consultando todos los Transmittals de Aconex...</span></td></tr>`;
    
    const engine = new SyncEngine(null, globalConfig);
    try {
        localTransmittalsDB = await engine.syncAllTransmittals();
        updateTransFilterOptions();
        renderNotifications();
        
        // Ocultar badge al ver las notificaciones (limpiar estado)
        notifBadge.classList.add('hidden'); 
    } catch (e) {
        console.error("Error en syncNotifications:", e);
        notifTableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-red-500 border border-red-500/20 bg-red-500/5">Error de conexión: ${e.message}</td></tr>`;
    }
}

function renderNotifications() {
    const query = filterTransSearch.value.toLowerCase();
    const userF = filterTransUser.value;
    const orgF = filterTransOrg.value;

    let filtered = localTransmittalsDB.filter(item => {
        const matchQ = !query || item.subject.toLowerCase().includes(query) || item.fromUser.toLowerCase().includes(query);
        const matchU = !userF || item.fromUser === userF;
        const matchO = !orgF || item.fromOrg === orgF;
        return matchQ && matchU && matchO;
    });

    // Sort
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

    if (filtered.length === 0) {
        notifTableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500 italic">No se encontraron Transmittals con los filtros aplicados.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(item => {
        let displayDate = item.date;
        try { displayDate = new Date(item.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch(e){}

        html += `
            <tr class="hover:bg-slate-800/80 transition-colors border-b border-slate-700/30">
                <td class="px-6 py-4 font-semibold text-slate-200">${item.fromUser}</td>
                <td class="px-6 py-4 text-xs text-slate-400">${item.fromOrg}</td>
                <td class="px-6 py-4 font-medium text-brand truncate max-w-sm" title="${item.subject}">${item.subject}</td>
                <td class="px-6 py-4 text-xs text-slate-500">${displayDate}</td>
            </tr>
        `;
    });
    notifTableBody.innerHTML = html;
}

function updateTransFilterOptions() {
    const fields = [
        { id: 'filterTransUser', key: 'fromUser', label: 'Remitente' },
        { id: 'filterTransOrg', key: 'fromOrg', label: 'Organización' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        const uniqueValues = [...new Set(localTransmittalsDB.map(d => d[f.key]).filter(v => v))].sort();
        let html = `<option value="">${f.label} (Todos)</option>`;
        uniqueValues.forEach(val => {
            html += `<option value="${val}">${val}</option>`;
        });
        el.innerHTML = html;
    });
}

btnRefreshNotif.addEventListener('click', syncNotifications);

// ======================================
// 5. Synchronization Orchestration
// ======================================
btnStartSync.addEventListener('click', async () => {
    if (isSyncing) return;
    
    globalConfig.projectId = confProjectId.value.trim();
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
