'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSessionToken } from '@/lib/zk/sessionToken';
import { StudyQuestion } from '@/components/participate/StudyQuestion';

interface Question {
  id: string;
  question_type: string;
  text: string;
  options?: { id: string; label: string }[];
  required: boolean;
  position: number;
}

export default function StudyPage() {
  const { studyId } = useParams<{ studyId: string }>();
  const router = useRouter();
  const token = getSessionToken(studyId);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!token && !hasRedirected.current) {
      hasRedirected.current = true;
      router.replace(`/participate/verify?study=${studyId}`);
    }
  }, [token, studyId, router]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/studies/${studyId}/questions`)
      .then((r) => r.json())
      .then(setQuestions)
      .catch(() => setError('Failed to load study questions.'));
  }, [studyId, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const missing = questions.filter(
      (q) => q.required && !responses[q.id],
    );
    if (missing.length > 0) {
      setError(`Please answer all required questions (${missing.length} remaining).`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ZK-Token': token,
        },
        body: JSON.stringify({ study_id: studyId, responses }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? 'Submission failed');
      }

      router.push(`/participate/${studyId}/complete`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  }

  if (!token) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Study Questions</h1>
        <p className="text-sm text-gray-500">
          Your responses are encrypted before leaving your browser.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {questions
          .sort((a, b) => a.position - b.position)
          .map((q) => (
            <StudyQuestion
              key={q.id}
              question={q}
              value={responses[q.id] ?? ''}
              onChange={(val) => setResponses((r) => ({ ...r, [q.id]: val }))}
            />
          ))}

        {questions.length > 0 && (
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 px-6 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit Responses'}
          </button>
        )}
      </form>
    </div>
  );
}
