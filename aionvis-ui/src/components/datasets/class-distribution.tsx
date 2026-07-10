"use client";

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DatasetClass } from "@/lib/api/types";

const chartConfig = {
  instanceCount: { label: "Instances" },
} satisfies ChartConfig;

/**
 * Horizontal bar chart of labeled instances per class. Bar color follows the
 * class entity (same hue as its bbox overlays), names sit on the axis, and
 * values are direct-labeled at the bar ends.
 */
export function ClassDistribution({ classes }: { classes: DatasetClass[] }) {
  if (classes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No labels yet — the distribution appears once the Critic signs off.
      </p>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      style={{ height: classes.length * 40 + 8 }}
      className="w-full"
    >
      <BarChart
        data={classes}
        layout="vertical"
        margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
        barSize={16}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <ChartTooltip
          cursor={{ fill: "transparent" }}
          content={<ChartTooltipContent hideIndicator />}
        />
        <Bar dataKey="instanceCount" radius={[0, 4, 4, 0]}>
          {classes.map((cls) => (
            <Cell key={cls.id} fill={cls.color} />
          ))}
          <LabelList
            dataKey="instanceCount"
            position="right"
            formatter={(v) => Number(v).toLocaleString()}
            className="fill-muted-foreground"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
