import AconexClient from './aconexApi.js';
import AconexETLProcessor from './etlProcessor.js';

class SyncEngine {
    constructor(dbPool, config) {
        this.db = dbPool;
        this.client = new AconexClient(config.projectId, config.username, config.password, config.region || 'us1');
        this.parser = new DOMParser();
    }

    parseMailSearchMetadata(xmlString) {
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            const allElements = Array.from(xmlDoc.getElementsByTagName('*'));
            
            const findAttr = (attrNames) => {
                for (const el of allElements) {
                    for (const attrName of attrNames) {
                        // Búsqueda insensible a mayúsculas en los atributos del elemento
                        for (let i = 0; i < el.attributes.length; i++) {
                            const a = el.attributes[i];
                            if (a.name.toLowerCase() === attrName.toLowerCase()) return a.value;
                        }
                    }
                }
                return null;
            };

            const totalResults = findAttr(['TotalResults', 'TotalCount', 'totalResults']) || '0';
            const onPage = findAttr(['TotalResultsOnPage', 'Count', 'onPage']) || '0';

            return {
                totalResults: parseInt(totalResults, 10),
                onPage: parseInt(onPage, 10)
            };
        } catch (e) {
            console.warn("Error parseando metadatos Mail:", e);
            return { totalResults: 0, onPage: 0 };
        }
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
            
            // Aconex Mail API puede usar <MailItem>, <Mail>, o <MailHeader>
            let items = xmlDoc.querySelectorAll('MailItem');
            if (items.length === 0) items = xmlDoc.querySelectorAll('Mail');
            if (items.length === 0) items = xmlDoc.querySelectorAll('MailHeader');
            
            console.log(`Debug Transmittals: Encontrados ${items.length} nodos XML.`);

            items.forEach(node => {
                const getVal = (sel) => {
                    const el = node.querySelector(sel);
                    return el ? el.textContent.trim() : '';
                };

                // 1. Datos Básicos
                const mailId = node.getAttribute('MailId') || getVal('MailId');
                const mailNo = getVal('MailNo');
                const subject = getVal('Subject');
                const date = getVal('SentDate') || getVal('DateSent');
                const status = getVal('ApprovalStatus') || getVal('Status');

                // 2. Remitente (FromUserDetails)
                const fromNode = node.querySelector('FromUserDetails');
                let fromUser = 'S/N';
                let fromOrg = 'S/O';
                if (fromNode) {
                    fromUser = fromNode.querySelector('Name')?.textContent.trim() || 'S/N';
                    fromOrg = fromNode.querySelector('OrganizationName')?.textContent.trim() || 'S/O';
                }

                // 3. Destinatarios (ToUsers -> Recipient)
                const recipients = Array.from(node.querySelectorAll('ToUsers > Recipient')).map(r => r.querySelector('Name')?.textContent.trim()).filter(Boolean);
                const toUser = recipients.length > 0 ? recipients.join(', ') : 'S/D';

                // 4. Adjuntos (Attachments -> RegisteredDocumentAttachment)
                // Usamos el primero para el listado principal
                const attachment = node.querySelector('RegisteredDocumentAttachment');
                let docName = '';
                let docRev = '';
                let fileName = '';
                if (attachment) {
                    docName = attachment.querySelector('Title')?.textContent.trim() || '';
                    docRev = attachment.querySelector('Revision')?.textContent.trim() || '';
                    fileName = attachment.querySelector('FileName')?.textContent.trim() || '';
                }

                transmittals.push({
                    id: mailId,
                    mailNo: mailNo,
                    subject: subject || '(Sin Asunto)',
                    fromUser: fromUser,
                    fromOrg: fromOrg,
                    toUser: toUser,
                    date: date,
                    status: status,
                    docName: docName,
                    docRev: docRev,
                    fileName: fileName,
                    isUnread: true
                });
            });
        } catch (e) {
            console.error("Error parseando Transmittals:", e);
        }
        return transmittals;
    }

    parseTransmittalDetails(xmlString) {
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            const mailNode = xmlDoc.querySelector('Mail');
            if (!mailNode) return null;

            const getVal = (sel) => {
                const el = mailNode.querySelector(sel);
                return el ? el.textContent.trim() : '';
            };

            // 1. Datos Básicos solicitados por el usuario
            const mailId = mailNode.getAttribute('MailId');
            const mailNo = getVal('MailNumber') || getVal('MailNo');
            const subject = getVal('Subject');
            const date = getVal('DateSent') || getVal('SentDate');
            const status = getVal('ApprovalStatus') || getVal('Status');

            // 2. Destinatario (To -> User -> UserName) conforme a regla técnica
            let toUser = 'S/D';
            const toNode = mailNode.querySelector('To');
            if (toNode) {
                const userNodes = Array.from(toNode.querySelectorAll('User'));
                const names = userNodes.map(u => u.querySelector('UserName')?.textContent.trim()).filter(Boolean);
                if (names.length > 0) toUser = names.join(', ');
                else {
                    // Fallback para otros formatos posibles (ej. Recipient > Name)
                    const altNames = Array.from(toNode.querySelectorAll('Recipient')).map(r => r.querySelector('Name')?.textContent.trim()).filter(Boolean);
                    if (altNames.length > 0) toUser = altNames.join(', ');
                }
            }

            // 3. Remitente (From -> User -> UserName)
            let fromUser = 'S/N';
            let fromOrg = 'S/O';
            const fromNode = mailNode.querySelector('From');
            if (fromNode) {
                fromUser = fromNode.querySelector('User > UserName')?.textContent.trim() || 'S/R';
                fromOrg = fromNode.querySelector('Organization > Name')?.textContent.trim() || 'S/O';
            }

            // 4. Adjuntos
            const attachment = mailNode.querySelector('RegisteredDocumentAttachment');
            let docName = '', docRev = '', fileName = '';
            if (attachment) {
                docName = attachment.querySelector('Title')?.textContent.trim() || '';
                docRev = attachment.querySelector('Revision')?.textContent.trim() || '';
                fileName = attachment.querySelector('FileName')?.textContent.trim() || '';
            }

            return {
                id: mailId,
                mailNo: mailNo,
                subject: subject || '(Sin Asunto)',
                fromUser: fromUser,
                fromOrg: fromOrg,
                toUser: toUser,
                date: date,
                status: status,
                docName: docName,
                docRev: docRev,
                fileName: fileName,
                isUnread: true
            };
        } catch (e) {
            console.error("Error parseando detalle de transmittal:", e);
            return null;
        }
    }

    async syncAllTransmittals(options = {}) {
        const { onProgress, status } = options;
        try {
            const allMailIds = [];
            let startRow = 1;
            let totalResults = 0;
            const pageSize = 250; // Solicitado: page_size=250

            if (onProgress) onProgress(0, 0, "Buscando IDs de transmittals...");

            // PASO 1: Obtener todos los MailId disponibles
            do {
                const params = { 
                    mail_box: 'Inbox', 
                    page_size: pageSize
                };
                if (startRow > 1) params.start = startRow;
                if (status) params.status = status;

                const xmlList = await this.client.fetchMail(params);
                const metadata = this.parseMailSearchMetadata(xmlList);
                totalResults = metadata.totalResults;

                // Extraer IDs del XML de búsqueda de forma robusta (ignora namespaces)
                const xmlDoc = this.parser.parseFromString(xmlList, "text/xml");
                const allElements = Array.from(xmlDoc.getElementsByTagName('*'));
                allElements.forEach(item => {
                    const baseName = item.nodeName.split(':').pop();
                    if (['MailItem', 'Mail', 'MailHeader'].includes(baseName)) {
                        const id = item.getAttribute('MailId') || item.querySelector('MailId')?.textContent.trim();
                        if (id && !allMailIds.includes(id)) allMailIds.push(id);
                    }
                });

                if (onProgress) onProgress(0, 0, `Obtenidos ${allMailIds.length} de ${totalResults} IDs...`);
                
                if (metadata.onPage === 0 || allMailIds.length >= totalResults) break;
                startRow += metadata.onPage;
                
                if (startRow <= totalResults) await new Promise(r => setTimeout(r, 200));

            } while (startRow <= totalResults);

            if (allMailIds.length === 0) return [];

            // PASO 2: Extracción en Paralelo con Control de Flujo (Promise Pool)
            const fullDetails = [];
            const CONCURRENCY_LIMIT = 10;
            const total = allMailIds.length;
            let completedCount = 0;

            const processBatch = async (ids) => {
                return Promise.all(ids.map(async (mailId) => {
                    try {
                        const xmlDetail = await this.client.fetchMailDetail(mailId);
                        const detail = this.parseTransmittalDetails(xmlDetail);
                        if (detail) {
                            fullDetails.push(detail);
                        }
                    } catch (e) {
                        console.warn(`Error al obtener detalle mail ${mailId}:`, e.message);
                    } finally {
                        completedCount++;
                        if (onProgress) onProgress(completedCount, total, `Procesando: ${completedCount}/${total} (${Math.round(completedCount/total*100)}%)`);
                    }
                }));
            };

            // Ejecutar en grupos de 10
            for (let i = 0; i < allMailIds.length; i += CONCURRENCY_LIMIT) {
                const batch = allMailIds.slice(i, i + CONCURRENCY_LIMIT);
                await processBatch(batch);
                // Pequeño reposo para el Rate Limit entre batches si es necesario
                await new Promise(r => setTimeout(r, 100));
            }

            // Ordenar por fecha descendente (más recientes primero)
            return fullDetails.sort((a,b) => new Date(b.date) - new Date(a.date));

        } catch (e) {
            console.error("Error en sincronización optimizada:", e);
            throw e;
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
