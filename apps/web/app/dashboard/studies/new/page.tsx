'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

const CreateStudySchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  min_responses: z.number().min(50, 'Minimum 50 responses required for differential privacy'),
  max_responses: z.number().optional(),
});

type Step = 1 | 2 | 3;

export default function NewStudyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState({
    title: '',
    description: '',
    min_responses: 50,
    max_responses: 500,
    targeting: { age_range: 'all', country_bucket: 'TIER_1' },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    try {
      CreateStudySchema.parse({ ...form, min_responses: Number(form.min_responses) });
    } catch (e: any) {
      setError(e.errors?.[0]?.message ?? 'Validation failed');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to create study');
      const { id } = await res.json();
      router.push(`/dashboard/studies/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create study');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Study</h1>
        <p className="text-sm text-gray-500">Step {step} of 3</p>
      </div>

      <div className="flex gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-brand-500' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold">Basic Information</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700">Study Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Consumer Electronics Preferences 2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Brief description shown to participants..."
            />
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Next: Privacy Settings
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold">Privacy & Sampling</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Minimum Responses (for DP results)
            </label>
            <input
              type="number"
              min={50}
              value={form.min_responses}
              onChange={(e) => setForm((f) => ({ ...f, min_responses: Number(e.target.value) }))}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-400">Minimum 50 required for differential privacy guarantees.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Maximum Responses</label>
            <input
              type="number"
              value={form.max_responses}
              onChange={(e) => setForm((f) => ({ ...f, max_responses: Number(e.target.value) }))}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Next: Review
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold">Review & Create</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Title</span>
              <span className="font-medium">{form.title}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Min responses</span>
              <span className="font-medium">{form.min_responses}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Max responses</span>
              <span className="font-medium">{form.max_responses}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Privacy</span>
              <span className="font-medium text-green-600">ε=10.0, δ=1e-5</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Study'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
