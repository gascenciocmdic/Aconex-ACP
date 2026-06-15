/**
 * Módulo ETL para procesar la lista de documentos obtenidos de la API de Aconex.
 * Convierte un array de documentos en crudo desde el XML/JSON a un array curado listo para UPSERT.
 */
class AconexETLProcessor {
    /**
     * Aplica las reglas del negocio a una lista masiva de documentos.
     * @param {Array<Object>} documentsList - Lista parseada desde el XML
     * @returns {Array<Object>} Lista de documentos limpios y transformados
     */
    static processDocuments(documentsList) {
        const validDocuments = [];

        for (const doc of documentsList) {
            // Regla #1: Excluir: Si docno contiene '.' o '_'
            if (!doc.docno || doc.docno.includes('.') || doc.docno.includes('_')) {
                continue;
            }

            // Regla #2: Excluir: Si status es "Anulado" o "Cancelado"
            const statusLower = (doc.status || '').trim().toLowerCase();
            if (statusLower === 'anulado' || statusLower === 'cancelado') {
                continue;
            }

            // Regla #3: Transformar contract: 
            // - Tomar primeros 8 caracteres
            // - Truncar antes del guion '-' 
            let processedContract = (doc.contract || '').trim();
            // Tomamos los primeros 8 caracteres
            processedContract = processedContract.substring(0, 8);
            
            // Si después de limitar a 8 contiene '-', truncamos
            if (processedContract.includes('-')) {
                processedContract = processedContract.split('-')[0];
            }
            
            processedContract = processedContract.trim();

            // Excluir si el valor resultante es "00000 Do"
            if (processedContract === '00000 Do') {
                continue;
            }

            // Regla de Deduplicación será aplicada del lado de SQL usando UPSERT,
            // pero nos aseguramos de que las fechas sean objetos Date o String válidos.
            const modifiedDate = doc.modified_date ? new Date(doc.modified_date) : null;

            // Ensamblaje final de la entidad a insertar
            validDocuments.push({
                docno: doc.docno,
                title: doc.title || '',
                revision: doc.revision || '',
                status: doc.status || '',
                modified_date: modifiedDate,
                wbs: doc.wbs || '',
                specialty: doc.specialty || '',
                contract: processedContract,
                author: doc.author || '',
                doc_type: doc.doc_type || ''
            });
        }

        return validDocuments;
    }
}

export default AconexETLProcessor;
