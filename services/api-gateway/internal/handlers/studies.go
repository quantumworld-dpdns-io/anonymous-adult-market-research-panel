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

func GetStudyQuestions(sb *clients.SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		questions, err := sb.GetStudyQuestions(r.Context(), studyID)
		if err != nil {
			jsonError(w, "failed to fetch questions", http.StatusServiceUnavailable)
			return
		}
		jsonOK(w, map[string]any{"study_id": studyID, "questions": questions})
	}
}

func CreateStudy(sb *clients.SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, "invalid body", http.StatusBadRequest)
			return
		}
		study, err := sb.CreateStudy(r.Context(), body)
		if err != nil {
			jsonError(w, "failed to create study", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(study)
	}
}

func GetStudy(sb *clients.SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		study, err := sb.GetStudy(r.Context(), studyID)
		if err != nil {
			jsonError(w, "failed to fetch study", http.StatusServiceUnavailable)
			return
		}
		if study == nil {
			jsonError(w, "study not found", http.StatusNotFound)
			return
		}
		jsonOK(w, study)
	}
}

func UpdateStudy(sb *clients.SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := chi.URLParam(r, "studyId")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, "invalid body", http.StatusBadRequest)
			return
		}
		if err := sb.UpdateStudy(r.Context(), studyID, body); err != nil {
			jsonError(w, "failed to update study", http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "updated"})
	}
}
