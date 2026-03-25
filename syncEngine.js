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

    async syncAllTransmittals(options = {}) {
        const { onProgress } = options;
        try {
            // Paso 1: Obtener la lista de MailIds
            const params = { mail_box: 'Inbox' };
            const xmlList = await this.client.fetchMail(params);
            const headers = this.parseTransmittalsFromXml(xmlList);
            
            if (headers.length === 0) return [];
            
            const fullDetails = [];
            const total = headers.length;
            
            // Paso 2: Obtener el detalle de CADA CORREO
            // Para no saturar la API, procesaremos por lotes pequeños
            for (let i = 0; i < total; i++) {
                const header = headers[i];
                try {
                    const xmlDetail = await this.client.fetchMailDetail(header.id);
                    const parsed = this.parseTransmittalsFromXml(xmlDetail);
                    if (parsed.length > 0) {
                        fullDetails.push(parsed[0]);
                    }
                } catch (e) {
                    console.error(`Error descargando detalle de Mail ${header.id}:`, e);
                    // Si falla el detalle, guardamos al menos el encabezado con S/N
                    fullDetails.push(header);
                }

                if (onProgress) onProgress(i + 1, total);
                
                // Pequeña pausa para ser respetuosos con la API
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 100));
            }

            return fullDetails;
        } catch (e) {
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
