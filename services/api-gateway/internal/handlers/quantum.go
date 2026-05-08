package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/quantumworld/panel/api-gateway/internal/clients"
)

func QuantumSample(quantum *clients.QuantumClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req clients.SamplingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.PopulationSize <= 0 || req.SampleSize <= 0 {
			jsonError(w, "population_size and sample_size must be positive", http.StatusBadRequest)
			return
		}
		if req.SampleSize > req.PopulationSize {
			jsonError(w, "sample_size cannot exceed population_size", http.StatusBadRequest)
			return
		}
		if req.Backend == "" {
			req.Backend = "aer"
		}

		result, err := quantum.Sample(r.Context(), req)
		if err != nil {
			jsonError(w, "quantum sampling failed", http.StatusServiceUnavailable)
			return
		}
		jsonOK(w, result)
	}
}
