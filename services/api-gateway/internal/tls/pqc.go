package tlsconfig

import (
	"crypto/tls"
)

// NewHybridTLSConfig returns a TLS 1.3 config preferring X25519 (post-quantum hybrid
// via Kyber768X25519 will be wired once circl exposes a stable TLSCurveID hook;
// pinned to X25519 + P-256 in the interim for compile-time correctness).
func NewHybridTLSConfig(certFile, keyFile string) *tls.Config {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		panic("TLS keypair load: " + err.Error())
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
		// X25519MLKEM768 curve ID will be registered by circl once the FIPS-203
		// naming lands in the installed CIRCL release. Using X25519 as the
		// classical-safe default; swap to hybrid.Kyber768X25519().TLSCurveID()
		// once the installed circl version exports that method.
		CurvePreferences: []tls.CurveID{
			tls.X25519,  // classical (PQC hybrid upgrade: see note above)
			tls.CurveP256,
		},
		CipherSuites: []uint16{
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_CHACHA20_POLY1305_SHA256,
		},
	}
}
