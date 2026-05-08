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

type QuantumClient struct {
	baseURL string
	http    *http.Client
}

type SamplingRequest struct {
	PopulationSize int       `json:"population_size"`
	SampleSize     int       `json:"sample_size"`
	Strata         []float64 `json:"strata,omitempty"`
	Backend        string    `json:"backend"`
}

type SamplingResult struct {
	SelectedIndices    []int     `json:"selected_indices"`
	StratumAssignments []int     `json:"stratum_assignments,omitempty"`
	CircuitQASM        string    `json:"circuit_qasm"`
	BackendUsed        string    `json:"backend_used"`
	NQubits            int       `json:"n_qubits"`
	ShotsExecuted      int       `json:"shots_executed"`
	UniformityPValue   float64   `json:"uniformity_p_value"`
}

func NewQuantumClient(baseURL string) *QuantumClient {
	return &QuantumClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *QuantumClient) Sample(ctx context.Context, req SamplingRequest) (*SamplingResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/quantum/sample", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("quantum service error %d: %s", resp.StatusCode, b)
	}

	var result SamplingResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
