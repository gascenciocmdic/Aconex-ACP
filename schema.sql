-- Esquema de Base de Datos para Panel Aconex

-- Tabla de Configuración de Administrador
CREATE TABLE IF NOT EXISTS Config_Admin (
    id SERIAL PRIMARY KEY,
    App_Key VARCHAR(255) NOT NULL,
    Auth_Basic VARCHAR(255) NOT NULL,
    Project_ID VARCHAR(100) NOT NULL,
    Filtro_Nombre VARCHAR(255)
);

-- Tabla de Documentos de Aconex
CREATE TABLE IF NOT EXISTS Aconex_Documents (
    docno VARCHAR(100) PRIMARY KEY,
    title VARCHAR(255),
    revision VARCHAR(50),
    status VARCHAR(50),
    modified_date TIMESTAMP,
    wbs VARCHAR(100),
    specialty VARCHAR(100),
    contract VARCHAR(100),
    author VARCHAR(100)
);

-- ==========================================
-- LÓGICA DE UPSERT (Deduplicación de PostgreSQL)
-- ==========================================
-- Esta query se debe ejecutar desde el Backend 
-- reemplazando los parámetros ( $1, $2, ... ) con los valores procesados en la capa ETL.

/*
INSERT INTO Aconex_Documents (docno, title, revision, status, modified_date, wbs, specialty, contract, author)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (docno) 
DO UPDATE SET 
    title = EXCLUDED.title,
    revision = EXCLUDED.revision,
    status = EXCLUDED.status,
    modified_date = EXCLUDED.modified_date,
    wbs = EXCLUDED.wbs,
    specialty = EXCLUDED.specialty,
    contract = EXCLUDED.contract,
    author = EXCLUDED.author
-- Regla de Deduplicación: Solo actualiza si la fecha de la API es más reciente que el registro local.
WHERE EXCLUDED.modified_date > Aconex_Documents.modified_date;
*/
