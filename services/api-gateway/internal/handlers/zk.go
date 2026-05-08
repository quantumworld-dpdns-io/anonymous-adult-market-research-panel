package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/quantumworld/panel/api-gateway/internal/clients"
	pb "github.com/quantumworld/panel/api-gateway/proto/zkproving/v1"
)

type verifyAgeRequest struct {
	Proof           []byte   `json:"proof"`
	PublicInputs    []string `json:"public_inputs"`
	Nullifier       string   `json:"nullifier"`
	StudyID         string   `json:"study_id"`
	DateAttestation struct {
		Year      uint32 `json:"year"`
		Month     uint32 `json:"month"`
		Day       uint32 `json:"day"`
		SignedAt  int64  `json:"signed_at"`
		Signature []byte `json:"signature"`
		StudyID   string `json:"study_id"`
	} `json:"date_attestation"`
}

func VerifyAge(zk *clients.ZKProvingClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req verifyAgeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if len(req.Proof) == 0 || req.Nullifier == "" || req.StudyID == "" {
			jsonError(w, "missing required fields", http.StatusBadRequest)
			return
		}

		resp, err := zk.VerifyAge(r.Context(), &pb.VerifyAgeRequest{
			Proof:        req.Proof,
			PublicInputs: req.PublicInputs,
			Nullifier:    req.Nullifier,
			StudyId:      req.StudyID,
			DateAttestation: &pb.DateAttestation{
				Year:      req.DateAttestation.Year,
				Month:     req.DateAttestation.Month,
				Day:       req.DateAttestation.Day,
				SignedAt:  req.DateAttestation.SignedAt,
				Signature: req.DateAttestation.Signature,
				StudyId:   req.DateAttestation.StudyID,
			},
		})
		if err != nil {
			jsonError(w, "verification failed", http.StatusBadRequest)
			return
		}

		jsonOK(w, map[string]string{"zk_session_token": resp.ZkSessionToken})
	}
}

func IssueCredential(zk *clients.ZKProvingClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AgeProof       []byte   `json:"age_proof"`
			AgePublicInputs []string `json:"age_public_inputs"`
			Nullifier      string   `json:"nullifier"`
			StudyID        string   `json:"study_id"`
			BlindingFactor []byte   `json:"blinding_factor"`
			Attributes     struct {
				AgeRange      string   `json:"age_range"`
				CountryBucket string   `json:"country_bucket"`
				Interests     []string `json:"interests"`
			} `json:"attributes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}

		resp, err := zk.IssueCredential(r.Context(), &pb.IssueCredentialRequest{
			AgeProof:        req.AgeProof,
			AgePublicInputs: req.AgePublicInputs,
			Nullifier:       req.Nullifier,
			StudyId:         req.StudyID,
			BlindingFactor:  req.BlindingFactor,
			Attributes: &pb.StudyAttributes{
				AgeRange:      req.Attributes.AgeRange,
				CountryBucket: req.Attributes.CountryBucket,
				Interests:     req.Attributes.Interests,
			},
		})
		if err != nil {
			jsonError(w, "credential issuance failed", http.StatusBadRequest)
			return
		}

		jsonOK(w, map[string]string{
			"zk_session_token":      resp.ZkSessionToken,
			"credential_commitment": resp.CredentialCommitment,
			"receipt_seal":          resp.ReceiptSeal,
		})
	}
}

func DateAttestation(zk *clients.ZKProvingClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		studyID := r.URL.Query().Get("study")
		if studyID == "" {
			jsonError(w, "study parameter required", http.StatusBadRequest)
			return
		}

		resp, err := zk.GetDateAttestation(r.Context(), &pb.DateAttestationRequest{StudyId: studyID})
		if err != nil {
			jsonError(w, "attestation unavailable", http.StatusServiceUnavailable)
			return
		}

		jsonOK(w, map[string]any{
			"current_date": map[string]uint32{
				"year":  resp.Attestation.Year,
				"month": resp.Attestation.Month,
				"day":   resp.Attestation.Day,
			},
			"signed_at": resp.Attestation.SignedAt,
			"signature": resp.Attestation.Signature,
			"study_id":  resp.Attestation.StudyId,
			"public_key": resp.PublicKey,
		})
	}
}
