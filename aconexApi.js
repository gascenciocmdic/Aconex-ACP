class AconexClient {
    constructor(projectId, user, pass) {
      this.projectId = projectId;
      this.credentials = btoa(`${user}:${pass}`);
      this.failedAttempts = 0;
      this.isBlocked = false; // Sentinel lock
    }
  
    /** Limpiador ETL XML base */
    cleanXmlString(xmlStr) {
      if (!xmlStr) return '';
      return xmlStr.replace(/[\x02\x0A\x0B]/g, '');
    }
  
    /** Fetch core function with Sentinel Block Logic */
    async fetchProjects(queryParams, onCircuitBreakerTrip) {
      if (this.isBlocked) {
        throw new Error("Sentinel Activo: Conexión Bloqueada. 2 fallos de Auth (401/403).");
      }
      return this._executeFetch(queryParams, true, onCircuitBreakerTrip);
    }

    /** 
     * Función especial para testear la credencial en el Panel Admin.
     * Cambiamos a GET /api/projects porque es el endpoint más universal
     * para validar credenciales (devuelve la lista de proyectos visibles).
     */
    async testConnection() {
        const url = `/aconex-proxy/api/projects`;
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'X-Application-Key': '827ccb23-a96e-4e49-be99-d7263c7a8ab4',
              'Authorization': `Basic ${this.credentials}`
            }
          });
          if (!response.ok) throw new Error(`Auth Error (${response.status})`);
          return await response.text();
        } catch (err) {
          throw err;
        }
    }

    /** Helper function to execute requests to avoid code duplication */
    async _executeFetch(params, affectGlobalSentinel, onCircuitBreakerTrip) {
        // Usamos GET /api/projects/{id}/register con Query Params para máxima compatibilidad. 
        // Aconex suele dar 405 (Method Not Allowed) en POST /register si el proyecto es estricto.
        let url = `/aconex-proxy/api/projects/${this.projectId}/register`;
        
        // Si hay parámetros (como page_number), los añadimos a la URL
        if (params && typeof params === 'object') {
            const searchParams = new URLSearchParams(params);
            url += `?${searchParams.toString()}`;
        }
    
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'X-Application-Key': '827ccb23-a96e-4e49-be99-d7263c7a8ab4',
              'Authorization': `Basic ${this.credentials}`,
              'Accept': 'application/xml'
            }
          });
    
          if (!response.ok) {
            // Evaluamos Auth failures
            if (response.status === 401 || response.status === 403) {
                if (affectGlobalSentinel) {
                    this.failedAttempts++;
                    if (this.failedAttempts >= 2) {
                        this.isBlocked = true; // El Sentinel cierra el paso
                        if (typeof onCircuitBreakerTrip === 'function') onCircuitBreakerTrip();
                    }
                }
                throw new Error(`Auth Error (${response.status})`);
            }
            throw new Error(`Aconex Error: ${response.status}`);
          }
    
          if (affectGlobalSentinel) this.failedAttempts = 0; // Reset
          return await response.text(); 

        } catch (err) {
          throw err;
        }
    }
  }
  
  export default AconexClient;
