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
      <div className="page-head">
        <div>
          <div className="eyebrow">PERFORMANCE</div>
          <h1>开局统计</h1>
        </div>
        <button
          type="button"
          className="statistics-view-switch"
          role="switch"
          aria-label="细分开局统计"
          aria-checked={!isFamily}
          onClick={() =>
            setView((current) => current === "family" ? "detail" : "family")
          }
        >
          <span aria-hidden="true" className={isFamily ? "selected" : ""}>
            大类
          </span>
          <span aria-hidden="true" className={isFamily ? "" : "selected"}>
            细分
          </span>
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="panel filters">
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
        <div className="panel chart-panel">
          <ResponsiveContainer width="100%" height={isFamily ? 300 : 230}>
            <BarChart
              data={rows.slice(0, 8)}
              layout={isFamily ? "vertical" : "horizontal"}
            >
              <CartesianGrid
                stroke="#28333a"
                vertical={isFamily}
                horizontal={!isFamily}
              />
              {isFamily ? (
                <>
                  <XAxis type="number" stroke="#81918f" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="opening"
                    width={180}
                    stroke="#81918f"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    tickFormatter={(name: string) =>
                      name.length > 26 ? `${name.slice(0, 25)}…` : name
                    }
                  />
                </>
              ) : (
                <>
                  <XAxis dataKey="eco" stroke="#81918f" />
                  <YAxis stroke="#81918f" allowDecimals={false} />
                </>
              )}
              <Tooltip />
              <Bar
                name="样本"
                dataKey="total"
                fill="#81aa91"
                radius={isFamily ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="panel table-wrap">
        <div className="table-title">
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
        {rows.length === 0 && <div className="empty">暂无可统计的对局。</div>}
      </div>
    </>
  );
}
