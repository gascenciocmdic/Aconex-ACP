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
    async fetchProjects(xmlPayload, onCircuitBreakerTrip) {
      if (this.isBlocked) {
        throw new Error("Sentinel Activo: Conexión Bloqueada. 2 fallos de Auth (401/403).");
      }
      return this._executeFetch(xmlPayload, true, onCircuitBreakerTrip);
    }

    /** 
     * Función especial para testear la credencial en el Panel Admin sin disparar
     * el contador global responsable de bloquear la cuenta por seguridad.
     */
    async testConnection(xmlPayload) {
      // Ignoramos el bloqueado general para pruebas, pero tampoco aumentamos el contador general
      // El 2do parámetro false evita que incremente fallos en el "Sentinel global".
      return this._executeFetch(xmlPayload, false);
    }

    /** Helper function to execute requests to avoid code duplication */
    async _executeFetch(xmlPayload, affectGlobalSentinel, onCircuitBreakerTrip) {
        // En lugar de apuntar a https://us1.aconex.com directamente (lo cual bloquea el navegador por CORS)
        // Apuntamos al servidor de Vercel para que él haga la petición por detrás de escena de forma segura.
        // Si estás ejecutándolo en local (npx serve), esto dará 404 a menos que instales una extensión "Allow CORS" 
        // y reviertas esta URL a us1.aconex.com.
        const url = `/aconex-proxy/projects/${this.projectId}/register/search`;
        const cleanPayload = this.cleanXmlString(xmlPayload);
    
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/xml',
              'X-Application-Key': '827ccb23-a96e-4e49-be99-d7263c7a8ab4',
              'Authorization': `Basic ${this.credentials}`
            },
            body: cleanPayload
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
