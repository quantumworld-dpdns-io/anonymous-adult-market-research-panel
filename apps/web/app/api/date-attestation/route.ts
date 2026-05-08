import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const studyId = searchParams.get('study') ?? '';

  const gatewayUrl = process.env.API_GATEWAY_URL;
  if (!gatewayUrl) {
    return NextResponse.json({ message: 'Gateway not configured' }, { status: 503 });
  }

  const res = await fetch(
    `${gatewayUrl}/zk/date-attestation?study=${encodeURIComponent(studyId)}`,
  );

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
