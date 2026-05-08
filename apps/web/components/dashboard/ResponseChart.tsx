'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface OptionData {
  option_id: string;
  label: string;
  count: number;
  percentage: number;
}

interface Props {
  question: { text: string };
  data: OptionData[];
}

const COLORS = ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe'];

export function ResponseChart({ question, data }: Props) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">No data available.</p>;
  }

  const chartData = data.map((d) => ({
    name: d.label,
    value: d.percentage,
    count: d.count,
  }));

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis unit="%" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number, _name: string, props: any) => [
              `${value.toFixed(1)}% (n≈${props.payload.count})`,
              'Share',
            ]}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-2">
        {data.map((d) => (
          <div key={d.option_id} className="flex items-center justify-between rounded border px-3 py-2 text-xs">
            <span className="text-gray-600">{d.label}</span>
            <span className="font-medium">{d.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Values are differentially private — small counts include DP noise.
      </p>
    </div>
  );
}
