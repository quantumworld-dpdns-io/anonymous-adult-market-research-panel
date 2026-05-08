import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const gatewayUrl = process.env.API_GATEWAY_URL;
  if (!gatewayUrl) {
    return NextResponse.json({ message: 'Gateway not configured' }, { status: 503 });
  }

  const res = await fetch(`${gatewayUrl}/zk/verify-age`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
