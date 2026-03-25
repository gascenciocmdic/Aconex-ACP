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
const testResultContainer = document.getElementById('testResultContainer');
const btnTestConn = document.getElementById('btnTestConn');

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
const filterSpecialty = document.getElementById('filterSpecialty');

// State
let localDB = []; // Simulated database table `Aconex_Documents`
let specialtiesSet = new Set(); // For filling the dropdown
let isSyncing = false;
let globalConfig = {
    projectId: confProjectId.value,
    username: '',
    password: ''
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
        // Ejecución SEGURA: Usamos el nuevo método GET /api/projects de AconexClient
        // Esto valida si el Usuario/Pass/AppKey son correctos independientemente del Proyecto.
        await tmpClient.testConnection();
        
        testResultContainer.classList.remove('hidden', 'bg-red-500/10', 'text-red-400', 'border-red-500/20');
        testResultContainer.classList.add('bg-green-500/10', 'text-green-400', 'border', 'border-green-500/20');
        testResultContainer.innerHTML = `✅ Autenticación exitosa. Credenciales válidas en Aconex (US1).`;
    } catch (e) {
        testResultContainer.classList.remove('hidden', 'bg-green-500/10', 'text-green-400', 'border-green-500/20');
        testResultContainer.classList.add('bg-red-500/10', 'text-red-400', 'border', 'border-red-500/20');
        testResultContainer.innerHTML = `❌ Falló la autenticación o API Inaccesible. Code: ${e.message}`;
    } finally {
        btnTestConn.innerHTML = `Test Connection`;
        btnTestConn.disabled = false;
    }
});

btnTogglePass.addEventListener('click', (e) => {
    e.preventDefault();
    const type = confPass.getAttribute('type') === 'password' ? 'text' : 'password';
    confPass.setAttribute('type', type);
    
    // Toggle iconos usando clases nativas de visibilidad
    if (type === 'text') {
        iconEyeOpen.classList.add('hidden');
        iconEyeClosed.classList.remove('hidden');
    } else {
        iconEyeOpen.classList.remove('hidden');
        iconEyeClosed.classList.add('hidden');
    }
});

// ======================================
// 3. Rendering Engine & Filters
// ======================================
function getStatusBadge(status) {
    const s = status.toLowerCase();
    if (s.includes('aprobado')) return '<span class="badge badge-success">Aprobado</span>';
    if (s.includes('anulado') || s.includes('rechazado') || s.includes('cancelado')) return `<span class="badge badge-danger">${status}</span>`;
    return `<span class="badge badge-warning">${status}</span>`; // En revisión u otros
}

function renderTable() {
    const query = filterSearch.value.toLowerCase();
    const specialty = filterSpecialty.value;

    const filtered = localDB.filter(doc => {
        const matchQ = doc.docno.toLowerCase().includes(query) || doc.title.toLowerCase().includes(query);
        const matchS = specialty === "" || doc.specialty === specialty;
        return matchQ && matchS;
    });

    tblCount.textContent = filtered.length;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-500">No hay resultados para mostrar.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(doc => {
        html += `
            <tr class="hover:bg-slate-800/80 transition-colors">
                <td class="px-6 py-4 font-mono text-brand">${doc.docno}</td>
                <td class="px-6 py-4 truncate max-w-xs" title="${doc.title}">${doc.title}</td>
                <td class="px-6 py-4 font-semibold">${doc.revision}</td>
                <td class="px-6 py-4">${getStatusBadge(doc.status)}</td>
                <td class="px-6 py-4">${doc.specialty}</td>
                <td class="px-6 py-4 text-slate-400">${doc.contract}</td>
            </tr>
        `;
    });
    tableBody.innerHTML = html;
}

filterSearch.addEventListener('input', renderTable);
filterSpecialty.addEventListener('change', renderTable);

function updateSpecialtyDropdown() {
    const currentVal = filterSpecialty.value;
    let ops = '<option value="">Todas las Especialidades</option>';
    
    Array.from(specialtiesSet).sort().forEach(s => {
        ops += `<option value="${s}" ${currentVal === s ? 'selected' : ''}>${s}</option>`;
    });
    
    filterSpecialty.innerHTML = ops;
}

// ======================================
// 4. Synchronization Orchestration
// ======================================
btnStartSync.addEventListener('click', async () => {
    if (isSyncing) return;
    
    // Sincronizamos globalConfig con los inputs actuales antes de iniciar
    globalConfig.projectId = confProjectId.value.trim();
    globalConfig.username = confUser.value.trim();
    globalConfig.password = confPass.value.trim();

    if (!globalConfig.username || !globalConfig.password) {
        alert("Por favor, configura las credenciales (Usuario y Password) en el Panel Admin antes de continuar.");
        tabs[1].click(); // navigate to admin
        return;
    }

    isSyncing = true;
    btnStartSync.classList.add('hidden');
    progressContainer.classList.remove('hidden', 'flex-col');
    progressContainer.classList.add('flex', 'flex-col');
    circuitBanner.classList.add('hidden');
    
    localDB = []; // Limpiar antes de sync
    specialtiesSet.clear();
    
    const engine = new SyncEngine(null, globalConfig);

    try {
        await engine.syncAllData({
            onProgress: (current, total) => {
                const percent = Math.round((current / total) * 100);
                progressText.textContent = `Página ${current} de ${total}`;
                progressPercent.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
            },
            onDocumentUpsert: async (doc) => {
                // Mock UPSERT push array
                const idx = localDB.findIndex(d => d.docno === doc.docno);
                if (idx > -1) localDB[idx] = doc;
                else localDB.push(doc);

                if (doc.specialty) specialtiesSet.add(doc.specialty);
            },
            onCircuitBreakerTrip: () => {
                // UI Event handling when Sentinel activates
                circuitBanner.classList.remove('hidden');
                btnStartSync.disabled = true;
                btnStartSync.classList.add('opacity-50', 'cursor-not-allowed');
                throw new Error("UI Sync Aborted by Sentinel.");
            },
            onFinish: () => {
                isSyncing = false;
                btnStartSync.classList.remove('hidden');
                progressContainer.classList.add('hidden');
                progressContainer.classList.remove('flex');
                progressBar.style.width = '0%';
                
                updateSpecialtyDropdown();
                renderTable();
            },
            onError: (err) => {
                isSyncing = false;
                btnStartSync.classList.remove('hidden');
                progressContainer.classList.add('hidden');
                
                if (err.message !== "UI Sync Aborted by Sentinel.") {
                    alert(`Ocurrió un error general: ${err.message}`);
                }
            }
        });
    } catch (e) {
        // Handled in onError callback
    }
});
