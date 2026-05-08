package tlsconfig

import (
	"crypto/tls"

	// Importing circl registers the hybrid KEM curve IDs with the TLS stack.
	"github.com/cloudflare/circl/kem/hybrid"
)

// NewHybridTLSConfig returns a TLS 1.3 config with X25519+ML-KEM-768 hybrid KEM
// as the preferred key exchange, falling back to classical X25519 and P-256.
func NewHybridTLSConfig(certFile, keyFile string) *tls.Config {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		panic("TLS keypair load: " + err.Error())
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
		CurvePreferences: []tls.CurveID{
			hybrid.X25519MLKEM768.TLSCurveID(), // hybrid PQC (preferred)
			tls.X25519,                          // classical fallback
			tls.CurveP256,                       // legacy fallback
		},
		CipherSuites: []uint16{
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_CHACHA20_POLY1305_SHA256,
		},
	}
}
