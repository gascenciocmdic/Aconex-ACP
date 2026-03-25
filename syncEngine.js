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
            // Aconex usa ProjectRegisterData para búsquedas Super Search o lista de Document
            const nodes = xmlDoc.querySelectorAll('ProjectRegisterData, Document');
            
            nodes.forEach(node => {
                const getTxt = (selectors) => {
                    for (const s of selectors) {
                        const el = node.querySelector(s);
                        if (el && el.textContent.trim()) return el.textContent.trim();
                    }
                    return '';
                };
                
                // Mapeo robusto: Aconex varía nombres según servicio (DocumentNumber vs DocumentNo)
                docs.push({
                    docno: getTxt(['DocumentNo', 'DocumentNumber', 'DocumentID']),
                    title: getTxt(['Title', 'DocumentTitle', 'Subject']),
                    revision: getTxt(['Revision', 'DocumentRevision', 'Rev']),
                    status: getTxt(['Status', 'DocumentStatus', 'CurrentStatus']),
                    modified_date: getTxt(['ModifiedDate', 'Modified', 'LastModified']),
                    wbs: getTxt(['WBS', 'WorkPackage', 'WBS_Code']),
                    specialty: getTxt(['Specialty', 'Disc', 'Discipline']),
                    // Contract suele estar en atributos personalizados Attr1-50 o campos específicos
                    contract: getTxt(['Contract', 'Attribute1', 'Attr1', 'ContractNumber']),
                    author: getTxt(['Author', 'CreatedBy', 'Originator'])
                });
            });
        } catch (e) {
            console.error("Error crítico parseando XML Aconex:", e);
        }
        return docs;
    }

    async syncAllData({ onStart, onProgress, onDocumentUpsert, onCircuitBreakerTrip, onFinish, onError }) {
        try {
            if (onStart) onStart();

            // Paginación establecida para un máximo de 500 registros por página (Restricción Aconex)
            const params = {
                search_type: 'PAGED',
                page_size: 500,
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
                
                // Pausa de cortesía para no saturar el servidor
                await new Promise(r => setTimeout(r, 400));
            }

            if (onFinish) onFinish();
        } catch (fatal) {
            if (onError) onError(fatal);
        }
    }
}

export default SyncEngine;
