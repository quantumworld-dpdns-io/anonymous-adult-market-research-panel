import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const CreateStudySchema = z.object({
  title: z.string().min(5),
  description: z.string().min(20),
  min_responses: z.number().min(50),
  max_responses: z.number().optional(),
  targeting: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const supabase = createServerClient();
  let query = supabase
    .from('studies')
    .select('id, title, description, status')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof CreateStudySchema>;
  try {
    body = CreateStudySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('studies')
    .insert({
      researcher_id: user.id,
      title: body.title,
      description: body.description,
      min_responses: body.min_responses,
      max_responses: body.max_responses,
      targeting: body.targeting ?? {},
      status: 'draft',
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
