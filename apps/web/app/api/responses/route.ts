import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SubmitSchema = z.object({
  study_id: z.string().uuid(),
  responses: z.record(z.string()),
});

export async function POST(req: NextRequest) {
  const zkToken = req.headers.get('X-ZK-Token');
  if (!zkToken) {
    return NextResponse.json({ message: 'Missing ZK token' }, { status: 401 });
  }

  let body: z.infer<typeof SubmitSchema>;
  try {
    body = SubmitSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const gatewayUrl = process.env.API_GATEWAY_URL;
  if (!gatewayUrl) {
    return NextResponse.json({ message: 'Gateway not configured' }, { status: 503 });
  }

  const res = await fetch(`${gatewayUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${zkToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
