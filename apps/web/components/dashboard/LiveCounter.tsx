'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

interface Props {
  studyId: string;
}

export function LiveCounter({ studyId }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const supabase = createBrowserClient();

  useEffect(() => {
    // Fetch initial count
    supabase
      .from('encrypted_responses')
      .select('id', { count: 'exact', head: true })
      .eq('study_id', studyId)
      .then(({ count: c }) => setCount(c ?? 0));

    // Subscribe to new INSERT events
    const channel = supabase
      .channel(`study-responses:${studyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'encrypted_responses',
          filter: `study_id=eq.${studyId}`,
        },
        () => setCount((c) => (c ?? 0) + 1),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studyId, supabase]);

  return (
    <div>
      <p className="text-3xl font-bold text-gray-900">
        {count === null ? (
          <span className="animate-pulse text-gray-300">—</span>
        ) : (
          count.toLocaleString()
        )}
      </p>
      <p className="text-xs text-gray-400 mt-1">live · updates in real-time</p>
    </div>
  );
}
