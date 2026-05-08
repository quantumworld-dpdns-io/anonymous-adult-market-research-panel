package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/quantumworld/panel/api-gateway/internal/clients"
)

func ListPublicStudies(analytics *clients.AnalyticsClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := analytics.ListStudies(r.Context())
		if err != nil {
			jsonError(w, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}
}

func GetStudyQuestions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		_ = studyID
		// Delegates to Supabase via internal Edge Function or direct query
		// Placeholder: returns empty questions list
		jsonOK(w, map[string]any{"study_id": studyID, "questions": []any{}})
	}
}

func CreateStudy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, "invalid body", http.StatusBadRequest)
			return
		}
		// Forward to Supabase Edge Function / internal service
		jsonOK(w, map[string]string{"status": "created"})
	}
}

func GetStudy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		jsonOK(w, map[string]string{"study_id": studyID})
	}
}

func UpdateStudy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		_ = studyID
		jsonOK(w, map[string]string{"status": "updated"})
	}
}
