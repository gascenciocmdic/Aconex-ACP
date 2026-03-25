import AconexClient from './aconexApi.js';
import AconexETLProcessor from './etlProcessor.js';

class SyncEngine {
    constructor(dbPool, config) {
        // En una UI local, dbPool representa la DB (ej. capa local que llama a SQLite, o simplemente memoria)
        this.db = dbPool;
        this.client = new AconexClient(config.projectId, config.username, config.password);
    }

    buildSearchPayload(pageNumber, pageSize = 500) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<ProjectRegister>
    <Search>
        <search_type>PAGED</search_type>
        <page_number>${pageNumber}</page_number>
        <page_size>${pageSize}</page_size>
    </Search>
</ProjectRegister>`;
    }

    parseTotalPages(xmlString) {
        // MOCK para parsear el TotalPages del XML Aconex real
        const match = xmlString.match(/<TotalPages>(\d+)<\/TotalPages>/i);
        // Retornamos de 1 a 6 para simular la demo si no encuentra el tag real.
        return match ? parseInt(match[1], 10) : 6; 
    }

    parseDocumentsFromXml(xmlString, pageNumber) {
        // MOCK: Generador de datos Aconex de prueba para poblar el Frontend
        const list = [];
        for (let i = 1; i <= 50; i++) {
            const num = (pageNumber * 100) + i;
            const statuses = ["Aprobado", "En revisión", "Rechazado", "Anulado", "Cancelado"];
            list.push({
                docno: `DOC-2026-${num}`,
                title: `Plano Arquitectónico ${num} - Proyecto Aconex`,
                revision: ['A', 'B', '0C', 'D'][num % 4],
                status: statuses[num % statuses.length], // Para ver los semáforos y filtros
                modified_date: new Date().toISOString(),
                contract: `CONT${num}-XYZ`, // Para ver regla 3
                specialty: ['Arquitectura', 'Estructura', 'Eléctrica', 'Sanitaria'][num % 4],
                author: `Arquitecto ${num % 3}`
            });
        }
        return list;
    }

    // Callbacks passed from UI (El Orquestador manda eventos al DOM)
    async syncAllData({ onStart, onProgress, onDocumentUpsert, onCircuitBreakerTrip, onFinish, onError }) {
        try {
            if (onStart) onStart();

            const PAGE_SIZE = 50; // Mock menor tamaño para UI rapida
            const payload = this.buildSearchPayload(1, PAGE_SIZE);
            const initialXml = await this.client.fetchProjects(payload, onCircuitBreakerTrip);
            
            const totalPages = this.parseTotalPages(initialXml);

            // Proc 1
            const rawDocs1 = this.parseDocumentsFromXml(initialXml, 1);
            const curatedDocs1 = AconexETLProcessor.processDocuments(rawDocs1);
            if (onProgress) onProgress(1, totalPages);
            for (const doc of curatedDocs1) if (onDocumentUpsert) await onDocumentUpsert(doc);

            // Ciclo Paginas
            for (let page = 2; page <= totalPages; page++) {
                try {
                    // Simulamos delay del fetch
                    await new Promise(r => setTimeout(r, 600));

                    const loopPayload = this.buildSearchPayload(page, PAGE_SIZE);
                    const xmlResp = await this.client.fetchProjects(loopPayload, onCircuitBreakerTrip);
                    
                    const rawDocs = this.parseDocumentsFromXml(xmlResp, page);
                    const curated = AconexETLProcessor.processDocuments(rawDocs);
                    
                    if (onProgress) onProgress(page, totalPages);
                    for (const doc of curated) if (onDocumentUpsert) await onDocumentUpsert(doc);

                } catch (pageErr) {
                    console.warn(`Página ${page} errónea:`, pageErr);
                    if (this.client.isBlocked) {
                        throw new Error("Sentinel Blocked!"); // break everything
                    }
                }
            }

            if (onFinish) onFinish();
        } catch (fatal) {
            if (onError) onError(fatal);
        }
    }
}

export default SyncEngine;
