package clients

import (
	"context"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/keepalive"

	pb "github.com/quantumworld/panel/api-gateway/proto/zkproving/v1"
)

type ZKProvingClient struct {
	client pb.ZKProvingServiceClient
}

func NewZKProvingClient(addr string) *ZKProvingClient {
	creds, err := credentials.NewClientTLSFromFile("certs/zk-proving.crt", "")
	if err != nil {
		// Dev fallback: insecure (set ZK_PROVING_TLS=false to enable)
		creds = credentials.NewTLS(nil)
	}
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(creds),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(10*1024*1024)),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             5 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		panic("zk-proving grpc dial: " + err.Error())
	}
	return &ZKProvingClient{client: pb.NewZKProvingServiceClient(conn)}
}

func (c *ZKProvingClient) VerifyAge(ctx context.Context, req *pb.VerifyAgeRequest) (*pb.VerifyAgeResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return c.client.VerifyAge(ctx, req)
}

func (c *ZKProvingClient) IssueCredential(ctx context.Context, req *pb.IssueCredentialRequest) (*pb.IssueCredentialResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second) // zkVM proving can take time
	defer cancel()
	return c.client.IssueCredential(ctx, req)
}

func (c *ZKProvingClient) GetDateAttestation(ctx context.Context, req *pb.DateAttestationRequest) (*pb.DateAttestationResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return c.client.GetDateAttestation(ctx, req)
}
