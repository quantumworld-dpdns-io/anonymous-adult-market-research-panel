'use client';

interface Option {
  id: string;
  label: string;
}

interface Question {
  id: string;
  question_type: string;
  text: string;
  options?: Option[];
  required: boolean;
}

interface Props {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}

export function StudyQuestion({ question, value, onChange }: Props) {
  return (
    <div className="rounded-lg border bg-white p-5 space-y-3">
      <label className="block font-medium text-gray-900">
        {question.text}
        {question.required && <span className="ml-1 text-red-500">*</span>}
      </label>

      {question.question_type === 'single_choice' && question.options && (
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label key={opt.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-gray-50">
              <input
                type="radio"
                name={question.id}
                value={opt.id}
                checked={value === opt.id}
                onChange={() => onChange(opt.id)}
                className="text-brand-500"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {question.question_type === 'multiple_choice' && question.options && (
        <div className="space-y-2">
          {question.options.map((opt) => {
            const selected = value.split(',').filter(Boolean);
            const checked = selected.includes(opt.id);
            return (
              <label key={opt.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((v) => v !== opt.id)
                      : [...selected, opt.id];
                    onChange(next.join(','));
                  }}
                  className="text-brand-500"
                />
                <span className="text-sm text-gray-700">{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.question_type === 'likert_scale' && (
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(String(n))}
              className={`flex-1 rounded-md border py-2 text-sm font-medium transition-colors ${
                value === String(n)
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'hover:bg-gray-50 text-gray-600'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {question.question_type === 'open_text' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Your answer..."
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      )}
    </div>
  );
}
