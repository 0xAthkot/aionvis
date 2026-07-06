"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { TrainingCurvePoint } from "@/lib/api/types";

/** Series hues validated as a pair against the dark card surface. */
const lossConfig = {
  boxLoss: { label: "Box loss", color: "#3987e5" },
  clsLoss: { label: "Class loss", color: "#199e70" },
} satisfies ChartConfig;

const mapConfig = {
  map50: { label: "mAP@50", color: "#3987e5" },
  map5095: { label: "mAP@50–95", color: "#199e70" },
} satisfies ChartConfig;

function CurveChart({
  data,
  config,
  yDomain,
}: {
  data: TrainingCurvePoint[];
  config: ChartConfig;
  yDomain?: [number, number];
}) {
  const keys = Object.keys(config);
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis
          dataKey="epoch"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          domain={yDomain ?? ["auto", "auto"]}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={44}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(v) => `Epoch ${v}`} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {keys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export function LossCurves({ curves }: { curves: TrainingCurvePoint[] }) {
  return <CurveChart data={curves} config={lossConfig} />;
}

export function MapCurves({ curves }: { curves: TrainingCurvePoint[] }) {
  return <CurveChart data={curves} config={mapConfig} yDomain={[0, 1]} />;
}
