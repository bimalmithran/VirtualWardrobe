package httpapi

import (
	"net/http"
)

type healthHandler struct{ db HealthChecker }

func (h healthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h.db.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
