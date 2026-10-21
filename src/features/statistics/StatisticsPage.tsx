import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../shared/api";
import type { OpeningStat, OpponentType } from "../../shared/types";
import { OpponentTypeSelect } from "../../shared/ui/OpponentTypeSelect";
import { Select } from "../../shared/ui/select";
import {
  groupOpeningFamilies,
  type OpeningFamilyStat,
} from "./opening-families";
export default function StatisticsPage() {
  const [view, setView] = useState<"family" | "detail">("family");
  const [opponentType, setOpponentType] = useState<OpponentType>("human");
  const [color, setColor] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stats, setStats] = useState<OpeningStat[]>([]);
  const [error, setError] = useState("");
  const families = useMemo(() => groupOpeningFamilies(stats), [stats]);
  const rows: (OpeningFamilyStat & { eco?: string })[] =
    view === "family" ? families : stats;
  const isFamily = view === "family";
  const total = stats.reduce((sum, stat) => sum + stat.total, 0);
  useEffect(() => {
    let active = true;
    api
      .openingStats(
        color,
        speed,
        from || null,
        to ? `${to}T23:59:59Z` : null,
        opponentType,
      )
      .then((result) => {
        if (active) {
          setStats(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [color, speed, from, to, opponentType]);
  return (
    <>
      <div className="mb-7 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-sm [&_p]:text-description">
        <div>
          <div className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            PERFORMANCE
          </div>
          <h1>开局统计</h1>
        </div>
        <button
          type="button"
          className="relative grid min-h-10.5 w-34 shrink-0 grid-cols-2 gap-0 rounded-full border border-control-edge bg-sidebar p-1 text-body-sm text-engine-muted select-none transition-transform duration-120 ease-switch before:absolute before:inset-y-1 before:left-1 before:w-toggle-thumb before:rounded-inherit before:bg-selected before:shadow-toggle before:content-empty before:transition-transform before:duration-180 before:ease-switch aria-checked:before:translate-x-full [&_span]:relative [&_span]:z-1 hover:filter-none active:scale-98 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-brand-ink focus-visible:outline-offset-3 focus-visible:scale-100 focus-visible:transition-none focus-visible:before:transition-none motion-reduce:transition-none motion-reduce:before:transition-none motion-reduce:active:scale-100"
          role="switch"
          aria-label="细分开局统计"
          aria-checked={!isFamily}
          onClick={() =>
            setView((current) => (current === "family" ? "detail" : "family"))
          }
        >
          <span
            aria-hidden="true"
            className={isFamily ? " text-selected-ink" : ""}
          >
            大类
          </span>
          <span
            aria-hidden="true"
            className={isFamily ? "" : " text-selected-ink"}
          >
            细分
          </span>
        </button>
      </div>
      {error && (
        <div className="mb-4.5 rounded-lg border border-notice-edge bg-notice px-3.75 py-3 text-body-sm text-notice-ink">
          {error}
        </div>
      )}
      <div className="rounded-xl border border-panel-edge bg-panel mb-4.5 flex flex-wrap gap-2.5 p-3.5 [&>*]:min-w-31.25 [&>*]:flex-1">
        <OpponentTypeSelect value={opponentType} onChange={setOpponentType} />
        <Select
          label="执棋颜色"
          value={color ?? ""}
          onValueChange={(color) => setColor(color || null)}
          options={[
            { value: "", label: "全部执棋" },
            { value: "white", label: "白方" },
            { value: "black", label: "黑方" },
          ]}
        />
        <Select
          label="对局时限"
          value={speed ?? ""}
          onValueChange={(speed) => setSpeed(speed || null)}
          options={[
            { value: "", label: "全部时限" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
          ]}
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {rows.length > 0 && (
        <div className="rounded-xl border border-panel-edge bg-panel mb-4.5 p-4.5">
          <ResponsiveContainer width="100%" height={isFamily ? 300 : 230}>
            <BarChart
              data={rows.slice(0, 8)}
              layout={isFamily ? "vertical" : "horizontal"}
            >
              <CartesianGrid
                stroke="var(--color-chart-grid)"
                vertical={isFamily}
                horizontal={!isFamily}
              />
              {isFamily ? (
                <>
                  <XAxis
                    type="number"
                    stroke="var(--color-chart-axis)"
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="opening"
                    width={180}
                    stroke="var(--color-chart-axis)"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    tickFormatter={(name: string) =>
                      name.length > 26 ? `${name.slice(0, 25)}…` : name
                    }
                  />
                </>
              ) : (
                <>
                  <XAxis dataKey="eco" stroke="var(--color-chart-axis)" />
                  <YAxis
                    stroke="var(--color-chart-axis)"
                    allowDecimals={false}
                  />
                </>
              )}
              <Tooltip />
              <Bar
                name="样本"
                dataKey="total"
                fill="var(--color-chart-bar)"
                radius={isFamily ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="rounded-xl border border-panel-edge bg-panel overflow-hidden">
        <div className="border-b border-panel-edge px-5 py-4.25 text-body font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          {isFamily ? "开局大类" : "开局细分"}
          <span>
            {rows.length} {isFamily ? "类" : "项"} · {total} 局
          </span>
        </div>
        <table>
          <thead>
            <tr>
              {!isFamily && <th>ECO</th>}
              <th>{isFamily ? "开局大类" : "开局"}</th>
              <th>样本</th>
              <th>胜</th>
              <th>和</th>
              <th>负</th>
              <th>胜率</th>
              <th>得分率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={isFamily ? s.opening : `${s.eco}-${s.opening}`}>
                {!isFamily && <td>{s.eco}</td>}
                <td>{s.opening}</td>
                <td>{s.total}</td>
                <td>{s.wins}</td>
                <td>{s.draws}</td>
                <td>{s.losses}</td>
                <td>{(s.winRate * 100).toFixed(1)}%</td>
                <td>{(s.scoreRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-5 py-15 text-center text-empty">
            暂无可统计的对局。
          </div>
        )}
      </div>
    </>
  );
}
