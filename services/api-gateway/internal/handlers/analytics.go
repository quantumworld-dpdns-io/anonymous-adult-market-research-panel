package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/quantumworld/panel/api-gateway/internal/clients"
)

func GetResults(analytics *clients.AnalyticsClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		data, err := analytics.GetResults(r.Context(), studyID)
		if err != nil {
			jsonError(w, "results unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}
}

func InternalResults(analytics *clients.AnalyticsClient) http.HandlerFunc {
	return GetResults(analytics)
}
