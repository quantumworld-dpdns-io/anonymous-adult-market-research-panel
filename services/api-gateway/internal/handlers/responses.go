package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/quantumworld/panel/api-gateway/internal/clients"
	"github.com/quantumworld/panel/api-gateway/internal/middleware"
)

type submitResponseRequest struct {
	StudyID   string            `json:"study_id"`
	Responses map[string]string `json:"responses"`
}

// SubmitResponse encrypts participant responses with AES-256-GCM using the
// study's shard key and writes the ciphertext to Supabase. The nullifier hash
// is hashed again before storage so it cannot be linked back to the session token.
func SubmitResponse(sb *clients.SupabaseClient) http.HandlerFunc {
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

		// Derive a per-study AES-256 key from the gateway's response encryption secret.
		// In production the secret is a 32-byte value from Vault / Secrets Manager.
		// SHA-256(secret || study_id) produces a distinct key per study.
		encSecret := []byte(os.Getenv("RESPONSE_ENCRYPTION_SECRET"))
		if len(encSecret) == 0 {
			// Dev fallback — never use in production
			encSecret = []byte("dev-fallback-32-byte-secret-key!")
		}
		keyInput := append(encSecret, []byte(req.StudyID)...)
		key := sha256Key(keyInput)

		// Serialize + encrypt the responses payload
		plaintext, err := json.Marshal(req.Responses)
		if err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		nonce, ciphertext, err := aesGCMEncrypt(key, plaintext)
		if err != nil {
			jsonError(w, "encryption failed", http.StatusInternalServerError)
			return
		}

		// Double-hash the nullifier so the stored value cannot be linked to the
		// original nullifier (which is stored in the nullifiers table).
		storedID := fmt.Sprintf("%x", sha256Key([]byte(nullifierHash+req.StudyID)))

		// Write to Supabase — unique constraint on (study_id, participant_id) enforces
		// one response per participant without storing linkable identity.
		_, writeErr := sb.InsertEncryptedResponse(r.Context(), map[string]any{
			"study_id":          req.StudyID,
			"participant_id":    storedID,
			"encrypted_payload": base64.StdEncoding.EncodeToString(ciphertext),
			"nonce":             base64.StdEncoding.EncodeToString(nonce),
		})
		if writeErr != nil {
			jsonError(w, "failed to store response", http.StatusInternalServerError)
			return
		}

		jsonOK(w, map[string]string{"status": "submitted"})
	}
}

func sha256Key(input []byte) []byte {
	h := sha256.Sum256(input)
	return h[:]
}

func aesGCMEncrypt(key, plaintext []byte) (nonce, ciphertext []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return nonce, gcm.Seal(nil, nonce, plaintext, nil), nil
}
