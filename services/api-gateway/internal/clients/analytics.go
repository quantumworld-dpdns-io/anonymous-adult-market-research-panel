package clients

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

type AnalyticsClient struct {
	baseURL    string
	hmacSecret string
	http       *http.Client
}

func NewAnalyticsClient(baseURL string) *AnalyticsClient {
	return &AnalyticsClient{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *AnalyticsClient) WithHMACSecret(secret string) *AnalyticsClient {
	c.hmacSecret = secret
	return c
}

func (c *AnalyticsClient) GetResults(ctx context.Context, studyID string) (json.RawMessage, error) {
	return c.get(ctx, fmt.Sprintf("/analytics/%s/results", studyID))
}

func (c *AnalyticsClient) ListStudies(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/studies")
}

func (c *AnalyticsClient) TriggerRound(ctx context.Context, studyID string) error {
	_, err := c.post(ctx, fmt.Sprintf("/analytics/%s/trigger-round", studyID), nil)
	return err
}

func (c *AnalyticsClient) get(ctx context.Context, path string) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	c.signRequest(req, path)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("analytics service error: %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (c *AnalyticsClient) post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	var buf io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.signRequest(req, path)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func (c *AnalyticsClient) signRequest(req *http.Request, path string) {
	if c.hmacSecret == "" {
		return
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	msg := req.Method + path + ts
	mac := hmac.New(sha256.New, []byte(c.hmacSecret))
	mac.Write([]byte(msg))
	req.Header.Set("X-Service-HMAC", hex.EncodeToString(mac.Sum(nil)))
	req.Header.Set("X-Service-Timestamp", ts)
}
