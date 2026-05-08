'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (year: number, month: number, day: number) => void;
}

export function AgeVerificationForm({ onSubmit }: Props) {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | null>(null);

  function validate(): boolean {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const currentYear = new Date().getFullYear();

    if (!y || y < 1900 || y > currentYear) {
      setError('Please enter a valid birth year.');
      return false;
    }
    if (!m || m < 1 || m > 12) {
      setError('Please enter a valid birth month (1–12).');
      return false;
    }
    if (!d || d < 1 || d > 31) {
      setError('Please enter a valid birth day (1–31).');
      return false;
    }
    setError(null);
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) {
      onSubmit(Number(year), Number(month), Number(day));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border bg-blue-50 p-4 text-sm text-blue-700">
        Enter your date of birth. It is processed locally in your browser to generate
        a zero-knowledge proof — it is never sent to our servers.
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
          <input
            type="number"
            placeholder="1990"
            min={1900}
            max={new Date().getFullYear()}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <input
            type="number"
            placeholder="1"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Day</label>
          <input
            type="number"
            placeholder="1"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        className="w-full rounded-lg bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 transition-colors"
      >
        Generate Age Proof
      </button>

      <p className="text-center text-xs text-gray-400">
        Your birth date never leaves this device.
      </p>
    </form>
  );
}
