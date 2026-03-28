import AconexClient from './aconexApi.js';
import AconexETLProcessor from './etlProcessor.js';

class SyncEngine {
    constructor(dbPool, config) {
        this.db = dbPool;
        this.client = new AconexClient(config.projectId, config.username, config.password, config.region || 'us1');
        this.parser = new DOMParser();
        this.CONCURRENCY_LIMIT = 10;
    }

    parseMailSearchMetadata(xmlString) {
        try {
            const xmlDoc = this.parser.parseFromString(xmlString, "text/xml");
            const allElements = Array.from(xmlDoc.getElementsByTagName('*'));
            
            const findAttr = (attrNames) => {
                for (const el of allElements) {
                    for (const attrName of attrNames) {
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

    findNodeByBaseName(parent, baseName) {
        if (!parent) return null;
        const children = Array.from(parent.children || parent.childNodes);
        return children.find(c => c.nodeType === 1 && c.nodeName.split(':').pop() === baseName);
    }

    findNodesByBaseName(parent, baseName) {
        if (!parent) return [];
        // Búsqueda en todos los descendientes que coincidan con el nombre base
        const all = Array.from(parent.getElementsByTagName('*'));
        return all.filter(c => c.nodeName.split(':').pop() === baseName);
    }

    getValByBaseName(parent, baseName) {
        const node = this.findNodeByBaseName(parent, baseName);
        return node ? node.textContent.trim() : '';
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
            const mailNode = this.findNodeByBaseName(xmlDoc, 'Mail');
            if (!mailNode) return null;

            // 1. Datos Básicos con búsqueda robusta
            const mailId = mailNode.getAttribute('MailId');
            const mailNo = this.getValByBaseName(mailNode, 'MailNumber') || this.getValByBaseName(mailNode, 'MailNo');
            const subject = this.getValByBaseName(mailNode, 'Subject');
            const date = this.getValByBaseName(mailNode, 'DateSent') || this.getValByBaseName(mailNode, 'SentDate');
            const status = this.getValByBaseName(mailNode, 'ApprovalStatus') || this.getValByBaseName(mailNode, 'Status');

            // 2. Destinatario (Búsqueda robusta en To, Recipient, ToUsers)
            let toUser = 'S/D';
            const toNode = this.findNodeByBaseName(mailNode, 'To') || this.findNodeByBaseName(mailNode, 'ToUsers');
            if (toNode) {
                const userNodes = this.findNodesByBaseName(toNode, 'User');
                const recipientNodes = this.findNodesByBaseName(toNode, 'Recipient');
                const names = [...userNodes, ...recipientNodes].map(u => 
                    this.getValByBaseName(u, 'UserName') || 
                    this.getValByBaseName(u, 'Name') || 
                    this.getValByBaseName(u, 'FullName')
                ).filter(Boolean);
                if (names.length > 0) toUser = [...new Set(names)].join(', ');
            } else {
                // Si no hay nodo To/ToUsers, buscar Recipient directos en el Mail (raro pero posible)
                const standaloneRecipients = this.findNodesByBaseName(mailNode, 'Recipient');
                const names = standaloneRecipients.map(r => this.getValByBaseName(r, 'Name') || this.getValByBaseName(r, 'UserName')).filter(Boolean);
                if (names.length > 0) toUser = [...new Set(names)].join(', ');
            }

            // 3. Remitente (From / FromUserDetails / FromUser)
            let fromUser = 'S/N';
            let fromOrg = 'S/O';
            const fromNode = this.findNodeByBaseName(mailNode, 'From') || 
                             this.findNodeByBaseName(mailNode, 'FromUserDetails') || 
                             this.findNodeByBaseName(mailNode, 'FromUser');
            
            if (fromNode) {
                const userNode = this.findNodeByBaseName(fromNode, 'User') || 
                                 this.findNodeByBaseName(fromNode, 'FromUser');
                const orgNode = this.findNodeByBaseName(fromNode, 'Organization') || 
                                this.findNodeByBaseName(fromNode, 'OrganizationName');
                
                // Si fromNode es FromUserDetails, los datos pueden estar directos
                fromUser = this.getValByBaseName(userNode, 'UserName') || 
                           this.getValByBaseName(userNode, 'Name') || 
                           this.getValByBaseName(fromNode, 'Name') || 
                           this.getValByBaseName(fromNode, 'UserName') || 'S/N';
                
                fromOrg = this.getValByBaseName(orgNode, 'Name') || 
                          this.getValByBaseName(orgNode, 'OrganizationName') || 
                          this.getValByBaseName(fromNode, 'OrganizationName') || 
                          this.getValByBaseName(fromNode, 'Organization') || 'S/O';
            }

            // 4. Adjuntos
            const attachment = this.findNodeByBaseName(mailNode, 'RegisteredDocumentAttachment') || 
                               this.findNodeByBaseName(mailNode, 'DocumentAttachment');
            let docName = '', docRev = '', fileName = '';
            if (attachment) {
                docName = this.getValByBaseName(attachment, 'Title') || this.getValByBaseName(attachment, 'DocumentTitle');
                docRev = this.getValByBaseName(attachment, 'Revision') || this.getValByBaseName(attachment, 'DocumentRevision');
                fileName = this.getValByBaseName(attachment, 'FileName') || this.getValByBaseName(attachment, 'Filename');
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
            console.error("Error parseando detalle de transmittal robusto:", e);
            return null;
        }
    }

    async syncAllTransmittals(options = {}) {
        const { onProgress, onTransmittalUpsert, status } = options;
        try {
            const allMailIds = [];
            let totalResults = 0;
            const pageSize = 250; 

            if (onProgress) onProgress(0, 0, "Buscando IDs de transmittals (Página 1)...");

            // PASO 1: Obtener todos los MailId disponibles en Paralelo (si hay varias páginas)
            const initialParams = { 
                mail_box: 'Inbox', 
                search_type: 'PAGED',
                page_size: pageSize,
                page_number: 1
            };
            if (status) initialParams.status = status;

            const firstXml = await this.client.fetchMail(initialParams);
            const firstMetadata = this.parseMailSearchMetadata(firstXml);
            totalResults = firstMetadata.totalResults;
            const totalPages = Math.ceil(totalResults / pageSize);

            const extractIds = (xml) => {
                const xmlDoc = this.parser.parseFromString(xml, "text/xml");
                const elements = Array.from(xmlDoc.getElementsByTagName('*'));
                elements.forEach(item => {
                    const baseName = item.nodeName.split(':').pop();
                    if (['MailItem', 'Mail', 'MailHeader'].includes(baseName)) {
                        const id = item.getAttribute('MailId') || item.querySelector('MailId')?.textContent.trim();
                        if (id && !allMailIds.includes(id)) allMailIds.push(id);
                    }
                });
            };

            extractIds(firstXml);

            if (totalPages > 1) {
                const pageTasks = [];
                for (let p = 2; p <= totalPages; p++) {
                    pageTasks.push(p);
                }

                const PAGE_CONCURRENCY = 5;
                for (let i = 0; i < pageTasks.length; i += PAGE_CONCURRENCY) {
                    const batch = pageTasks.slice(i, i + PAGE_CONCURRENCY);
                    await Promise.all(batch.map(async (p) => {
                        const pXml = await this.client.fetchMail({ ...initialParams, page_number: p });
                        extractIds(pXml);
                        if (onProgress) onProgress(0, 0, `Obtenidos ${allMailIds.length} de ${totalResults} IDs...`);
                    }));
                }
            }

            if (allMailIds.length === 0) return [];

            // PASO 2: Extracción en Paralelo de Detalles con Control de Flujo
            const fullDetails = [];
            const DETAIL_CONCURRENCY = 10;
            const total = allMailIds.length;
            let completedCount = 0;

            const processMail = async (mailId) => {
                try {
                    const xmlDetail = await this.client.fetchMailDetail(mailId);
                    const detail = this.parseTransmittalDetails(xmlDetail);
                    
                    if (detail) {
                        // FILTRO "TRN": Conservamos la lógica solicitada previamente
                        if (detail.mailNo?.toString().includes('TRN')) {
                            fullDetails.push(detail);
                            if (onTransmittalUpsert) await onTransmittalUpsert(detail);
                        }
                    }
                } catch (e) {
                    console.warn(`Error al obtener detalle mail ${mailId}:`, e.message);
                } finally {
                    completedCount++;
                    if (onProgress) onProgress(completedCount, total, `Procesando: ${completedCount}/${total} (${Math.round(completedCount/total*100)}%)`);
                }
            };

            for (let i = 0; i < allMailIds.length; i += DETAIL_CONCURRENCY) {
                const batch = allMailIds.slice(i, i + DETAIL_CONCURRENCY);
                await Promise.all(batch.map(id => processMail(id)));
                // Mínimo delay para no saturar la API
                await new Promise(r => setTimeout(r, 50));
            }

            return fullDetails.sort((a,b) => new Date(b.date) - new Date(a.date));

        } catch (e) {
            console.error("Error en sincronización optimizada de transmittals:", e);
            throw e;
        }
    }

    async syncAllData({ onStart, onProgress, onDocumentUpsert, onCircuitBreakerTrip, onFinish, onError, onRawResponse, pageSize = 200 }) {
        try {
            if (onStart) onStart();

            // Paginación configurada por el usuario (mínimo 50, máximo 1000)
            const actualPageSize = Math.min(Math.max(pageSize, 50), 1000);
            const params = {
                search_type: 'PAGED',
                page_size: actualPageSize,
                page_number: 1
            };

            const initialXml = await this.client.fetchProjects(params, onCircuitBreakerTrip);
            if (onRawResponse) onRawResponse(initialXml);
            
            const totalPages = this.parseTotalPages(initialXml);
            
            // Procesar primera página
            const rawDocs1 = this.parseDocumentsFromXml(initialXml);
            const curatedDocs1 = AconexETLProcessor.processDocuments(rawDocs1);
            
            for (const doc of curatedDocs1) {
                if (onDocumentUpsert) await onDocumentUpsert(doc);
            }
            if (onProgress) onProgress(1, totalPages);

            // Ciclo de páginas restantes en paralelo (máximo 5 concurrentes)
            if (totalPages > 1) {
                const CONCURRENCY_LIMIT = 5;
                const pages = [];
                for (let p = 2; p <= totalPages; p++) pages.push(p);

                for (let i = 0; i < pages.length; i += CONCURRENCY_LIMIT) {
                    if (this.client.isBlocked) break;

                    const batch = pages.slice(i, i + CONCURRENCY_LIMIT);
                    await Promise.all(batch.map(async (page) => {
                        const loopParams = { ...params, page_number: page };
                        const xmlResp = await this.client.fetchProjects(loopParams, onCircuitBreakerTrip);
                        
                        const rawDocs = this.parseDocumentsFromXml(xmlResp);
                        const curated = AconexETLProcessor.processDocuments(rawDocs);
                        
                        for (const doc of curated) {
                            if (onDocumentUpsert) await onDocumentUpsert(doc);
                        }
                        
                        if (onProgress) onProgress(page, totalPages);
                    }));
                    
                    // Pequeño reposo entre batches para evitar Rate Limits
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            if (onFinish) onFinish();
        } catch (fatal) {
            if (onError) onError(fatal);
        }
    }
}

export default SyncEngine;
