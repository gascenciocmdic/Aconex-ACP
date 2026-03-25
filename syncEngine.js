import AconexClient from './aconexApi.js';
import AconexETLProcessor from './etlProcessor.js';

class SyncEngine {
    constructor(dbPool, config) {
        this.db = dbPool;
        this.client = new AconexClient(config.projectId, config.username, config.password);
        this.parser = new DOMParser();
    }

    parseTotalPages(xmlString) {
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            const totalPagesNode = xmlDoc.querySelector('TotalPages');
            return totalPagesNode ? parseInt(totalPagesNode.textContent, 10) : 1;
        } catch (e) {
            return 1;
        }
    }

    parseDocumentsFromXml(xmlString) {
        const docs = [];
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            // Aconex suele devolver una lista de <ProjectRegisterData> o <Document>
            const nodes = xmlDoc.querySelectorAll('ProjectRegisterData, Document');
            
            nodes.forEach(node => {
                const getTxt = (selector) => node.querySelector(selector)?.textContent || '';
                
                docs.push({
                    docno: getTxt('DocumentNo') || getTxt('DocumentNumber') || 'N/A',
                    title: getTxt('Title') || 'Sin Título',
                    revision: getTxt('Revision') || '0',
                    status: getTxt('Status') || getTxt('DocumentStatus') || 'Desconocido',
                    modified_date: getTxt('ModifiedDate') || new Date().toISOString(),
                    wbs: getTxt('WBS') || '',
                    specialty: getTxt('Specialty') || 'General',
                    contract: getTxt('Contract') || getTxt('Attribute1') || '',
                    author: getTxt('Author') || ''
                });
            });
        } catch (e) {
            console.error("Error parseando documentos:", e);
        }
        return docs;
    }

    async syncAllData({ onStart, onProgress, onDocumentUpsert, onCircuitBreakerTrip, onFinish, onError }) {
        try {
            if (onStart) onStart();

            // Parámetros iniciales para la primera página
            const params = {
                search_type: 'PAGED',
                page_size: 50,
                page_number: 1
            };

            const initialXml = await this.client.fetchProjects(params, onCircuitBreakerTrip);
            const totalPages = this.parseTotalPages(initialXml);
            
            // Procesar primera página
            const rawDocs1 = this.parseDocumentsFromXml(initialXml);
            const curatedDocs1 = AconexETLProcessor.processDocuments(rawDocs1);
            
            if (onProgress) onProgress(1, totalPages);
            for (const doc of curatedDocs1) {
                if (onDocumentUpsert) await onDocumentUpsert(doc);
            }

            // Ciclo de páginas restantes
            for (let page = 2; page <= totalPages; page++) {
                if (this.client.isBlocked) break;

                const loopParams = { ...params, page_number: page };
                const xmlResp = await this.client.fetchProjects(loopParams, onCircuitBreakerTrip);
                
                const rawDocs = this.parseDocumentsFromXml(xmlResp);
                const curated = AconexETLProcessor.processDocuments(rawDocs);
                
                if (onProgress) onProgress(page, totalPages);
                for (const doc of curated) {
                    if (onDocumentUpsert) await onDocumentUpsert(doc);
                }
                
                // Pequeña pausa para no saturar
                await new Promise(r => setTimeout(r, 300));
            }

            if (onFinish) onFinish();
        } catch (fatal) {
            if (onError) onError(fatal);
        }
    }
}

export default SyncEngine;
