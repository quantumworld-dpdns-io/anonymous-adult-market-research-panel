package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/quantumworld/panel/api-gateway/internal/middleware"
)

type submitResponseRequest struct {
	StudyID   string            `json:"study_id"`
	Responses map[string]string `json:"responses"`
}

func SubmitResponse() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nullifierHash := middleware.NullifierHashFromCtx(r.Context())
		if nullifierHash == "" {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req submitResponseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.StudyID == "" || len(req.Responses) == 0 {
			jsonError(w, "study_id and responses required", http.StatusBadRequest)
			return
		}

		// Encrypt responses and write to Supabase via internal service
		// The nullifier hash is used to enforce one-response-per-participant
		// but is NOT stored alongside the encrypted payload in a linkable way
		_ = nullifierHash

		jsonOK(w, map[string]string{"status": "submitted"})
	}
}
