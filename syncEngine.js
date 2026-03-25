import AconexClient from './aconexApi.js';
import AconexETLProcessor from './etlProcessor.js';

class SyncEngine {
    constructor(dbPool, config) {
        this.db = dbPool;
        this.client = new AconexClient(config.projectId, config.username, config.password, config.region || 'us1');
        this.parser = new DOMParser();
    }

    parseTotalPages(xmlString) {
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            // En la lógica de Power Query, TotalPages es un ATRIBUTO del nodo raíz o SearchResults
            // Ejemplo: <ProjectRegister TotalPages="5">
            const root = xmlDoc.documentElement;
            let total = root.getAttribute('TotalPages') || root.getAttribute('Attribute:TotalPages');
            
            // Si no está en la raíz, buscar en cualquier nodo que lo tenga
            if (!total) {
                const allElements = Array.from(xmlDoc.getElementsByTagName('*'));
                const nodeWithAttr = allElements.find(el => el.hasAttribute('TotalPages'));
                if (nodeWithAttr) total = nodeWithAttr.getAttribute('TotalPages');
            }

            return total ? parseInt(total, 10) : 1;
        } catch (e) {
            return 1;
        }
    }

    parseDocumentsFromXml(xmlString) {
        const docs = [];
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            // Según Power Query: Origen{0}[SearchResults]{0}[Document]
            const nodes = xmlDoc.querySelectorAll('Document');
            
            nodes.forEach(node => {
                const getTxt = (selectors) => {
                    const children = Array.from(node.children);
                    for (const s of selectors) {
                        const child = children.find(c => c.nodeName.split(':').pop() === s);
                        if (child) {
                            // 1. Intentar texto directo
                            let text = child.textContent.trim();
                            // 2. Si está vacío y tiene hijos (ej. <Value>), buscar en el primer hijo
                            if (!text && child.children.length > 0) {
                                text = child.children[0].textContent.trim();
                            }
                            // 3. Si sigue vacío, buscar atributo 'Value' o 'Text'
                            if (!text) {
                                text = child.getAttribute('Value') || child.getAttribute('Text') || '';
                            }
                            if (text) return text;
                        }
                    }
                    return '';
                };
                
                // Mapeo EXACTO y ROBUSTO
                docs.push({
                    docno: getTxt(['DocumentNumber', 'NumDoc', 'DocumentNo']),
                    title: getTxt(['Title', 'DocumentTitle', 'Subject']),
                    revision: getTxt(['Revision', 'DocumentRevision']),
                    status: getTxt(['DocumentStatus', 'Estatus', 'StatusID']),
                    modified_date: getTxt(['DateModified', 'ModifiedDate', 'Modified']),
                    wbs: getTxt(['SelectList1', 'WBS']),
                    specialty: getTxt(['SelectList3', 'Especialidad', 'Specialty', 'Disciplina']),
                    contract: getTxt(['SelectList4', 'Contrato', 'ContractNumber']),
                    author: getTxt(['Author', 'CreatedBy']),
                    doc_type: getTxt(['DocumentType', 'Doctype', 'Tipo Doc'])
                });
            });
        } catch (e) {
            console.error("Error crítico parseando XML Aconex (Ultra-Robust):", e);
        }
        return docs;
    }

    parseTransmittalsFromXml(xmlString) {
        const transmittals = [];
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            const items = xmlDoc.querySelectorAll('MailItem');
            
            items.forEach(item => {
                const getVal = (selector) => {
                    const el = item.querySelector(selector);
                    return el ? el.textContent.trim() : '';
                };

                // Parsing más robusto para Nombres y Organizaciones
                const fromNode = item.querySelector('From');
                let user = '';
                let org = '';
                if (fromNode) {
                    const userNode = fromNode.querySelector('User');
                    const orgNode = fromNode.querySelector('Organization');
                    
                    if (userNode) {
                        const fn = userNode.querySelector('FirstName');
                        const ln = userNode.querySelector('LastName');
                        user = fn && ln ? `${fn.textContent} ${ln.textContent}` : userNode.textContent.trim();
                    }
                    if (orgNode) {
                        const on = orgNode.querySelector('Name');
                        org = on ? on.textContent.trim() : orgNode.textContent.trim();
                    }
                }

                transmittals.push({
                    id: getVal('MailId'),
                    subject: getVal('Subject'),
                    fromUser: user || 'S/N',
                    fromOrg: org || 'S/O',
                    date: getVal('DateSent'),
                    isUnread: true
                });
            });
        } catch (e) {
            console.error("Error parseando Transmittals:", e);
        }
        return transmittals;
    }

    async syncAllTransmittals(onFinished) {
        try {
            // Lógica ALINEADA con Python: mail_box=Inbox y search_query=mailtype:Transmittal
            const params = {
                mail_box: 'Inbox',
                search_query: 'mailtype:Transmittal'
            };
            const xml = await this.client.fetchMail(params);
            const list = this.parseTransmittalsFromXml(xml);
            if (onFinished) onFinished(list);
            return list;
        } catch (e) {
            throw e; // Relanzar para que app.js lo capture y muestre en UI
        }
    }

    async syncAllData({ onStart, onProgress, onDocumentUpsert, onCircuitBreakerTrip, onFinish, onError, onRawResponse, pageSize = 200 }) {
        try {
            if (onStart) onStart();

            // Paginación configurada por el usuario (mínimo 50, máximo 500)
            const params = {
                search_type: 'PAGED',
                page_size: Math.min(Math.max(pageSize, 50), 500),
                page_number: 1
            };

            const initialXml = await this.client.fetchProjects(params, onCircuitBreakerTrip);
            if (onRawResponse) onRawResponse(initialXml);
            
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
                
                await new Promise(r => setTimeout(r, 300));
            }

            if (onFinish) onFinish();
        } catch (fatal) {
            if (onError) onError(fatal);
        }
    }
}

export default SyncEngine;
