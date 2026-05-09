package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// SupabaseClient makes authenticated REST calls to Supabase PostgREST.
type SupabaseClient struct {
	baseURL    string
	serviceKey string
	http       *http.Client
}

func NewSupabaseClient(url, serviceKey string) *SupabaseClient {
	return &SupabaseClient{
		baseURL:    url,
		serviceKey: serviceKey,
		http:       &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *SupabaseClient) authHeaders(req *http.Request) {
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
}

func (c *SupabaseClient) get(ctx context.Context, path string, query map[string]string) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/rest/v1/"+path, nil)
	if err != nil {
		return nil, err
	}
	c.authHeaders(req)
	q := req.URL.Query()
	for k, v := range query {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("supabase %d: %s", resp.StatusCode, body)
	}
	return body, nil
}

func (c *SupabaseClient) post(ctx context.Context, path string, payload any) (json.RawMessage, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/rest/v1/"+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	c.authHeaders(req)
	req.Header.Set("Prefer", "return=representation")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("supabase %d: %s", resp.StatusCode, body)
	}
	return body, nil
}

func (c *SupabaseClient) patch(ctx context.Context, path string, query map[string]string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, c.baseURL+"/rest/v1/"+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	c.authHeaders(req)
	req.Header.Set("Prefer", "return=minimal")
	q := req.URL.Query()
	for k, v := range query {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase %d: %s", resp.StatusCode, body)
	}
	return nil
}

// --- Study helpers ---

type Study struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Status       string `json:"status"`
	MinResponses int    `json:"min_responses"`
	ResearcherID string `json:"researcher_id,omitempty"`
}

type Question struct {
	ID           string          `json:"id"`
	StudyID      string          `json:"study_id"`
	Text         string          `json:"text"`
	QuestionType string          `json:"question_type"`
	Options      json.RawMessage `json:"options"`
	Position     int             `json:"position"`
}

func (c *SupabaseClient) GetStudy(ctx context.Context, studyID string) (*Study, error) {
	raw, err := c.get(ctx, "studies", map[string]string{
		"id":     "eq." + studyID,
		"select": "id,title,description,status,min_responses",
		"limit":  "1",
	})
	if err != nil {
		return nil, err
	}
	var rows []Study
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

func (c *SupabaseClient) GetStudyQuestions(ctx context.Context, studyID string) ([]Question, error) {
	raw, err := c.get(ctx, "study_questions", map[string]string{
		"study_id": "eq." + studyID,
		"select":   "id,study_id,text,question_type,options,position",
		"order":    "position.asc",
	})
	if err != nil {
		return nil, err
	}
	var rows []Question
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *SupabaseClient) CreateStudy(ctx context.Context, payload map[string]any) (*Study, error) {
	raw, err := c.post(ctx, "studies", payload)
	if err != nil {
		return nil, err
	}
	var rows []Study
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no row returned from insert")
	}
	return &rows[0], nil
}

func (c *SupabaseClient) UpdateStudy(ctx context.Context, studyID string, payload map[string]any) error {
	return c.patch(ctx, "studies", map[string]string{"id": "eq." + studyID}, payload)
}

func (c *SupabaseClient) InsertEncryptedResponse(ctx context.Context, payload map[string]any) (json.RawMessage, error) {
	return c.post(ctx, "encrypted_responses", payload)
}
