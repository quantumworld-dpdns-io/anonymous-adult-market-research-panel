package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type ZKTokenVerifier struct {
	secret []byte
}

func NewZKTokenVerifier(secret string) *ZKTokenVerifier {
	return &ZKTokenVerifier{secret: []byte(secret)}
}

type ZKTokenPayload struct {
	Sub        string `json:"sub"`
	StudyID    string `json:"study_id"`
	Commitment string `json:"commitment,omitempty"`
	IssuedAt   int64  `json:"iat"`
	ExpiresAt  int64  `json:"exp"`
	JTI        string `json:"jti"`
	Version    int    `json:"v"`
}

func (v *ZKTokenVerifier) Verify(tokenStr, studyID string) (*ZKTokenPayload, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(signingInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, errors.New("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid token encoding")
	}

	var payload ZKTokenPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, errors.New("invalid token payload")
	}

	if time.Now().Unix() > payload.ExpiresAt {
		return nil, errors.New("token expired")
	}

	if studyID != "" && payload.StudyID != studyID {
		return nil, errors.New("token bound to different study")
	}

	return &payload, nil
}
