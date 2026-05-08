package auth

import (
	"errors"

	"github.com/golang-jwt/jwt/v5"
)

type SupabaseJWTVerifier struct {
	secret []byte
}

func NewSupabaseJWTVerifier(secret string) *SupabaseJWTVerifier {
	return &SupabaseJWTVerifier{secret: []byte(secret)}
}

type ResearcherClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (v *SupabaseJWTVerifier) Verify(tokenStr string) (*ResearcherClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &ResearcherClaims{},
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return v.secret, nil
		},
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*ResearcherClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid claims")
	}
	return claims, nil
}
