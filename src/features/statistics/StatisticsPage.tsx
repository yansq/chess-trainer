import { useEffect, useState } from "react";
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
export default function StatisticsPage() {
  const [opponentType, setOpponentType] = useState<OpponentType>("human");
  const [color, setColor] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stats, setStats] = useState<OpeningStat[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .openingStats(
        color,
        speed,
        from || null,
        to ? `${to}T23:59:59Z` : null,
        opponentType,
      )
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, [color, speed, from, to, opponentType]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PERFORMANCE</div>
          <h1>开局统计</h1>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="panel filters">
        <OpponentTypeSelect value={opponentType} onChange={setOpponentType} />
        <select
          value={color ?? ""}
          onChange={(e) => setColor(e.target.value || null)}
        >
          <option value="">全部执棋</option>
          <option value="white">白方</option>
          <option value="black">黑方</option>
        </select>
        <select
          value={speed ?? ""}
          onChange={(e) => setSpeed(e.target.value || null)}
        >
          <option value="">全部时限</option>
          <option value="blitz">Blitz</option>
          <option value="rapid">Rapid</option>
          <option value="classical">Classical</option>
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {stats.length > 0 && (
        <div className="panel chart-panel">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={stats.slice(0, 8)}>
              <CartesianGrid stroke="#28333a" vertical={false} />
              <XAxis dataKey="eco" stroke="#81918f" />
              <YAxis stroke="#81918f" />
              <Tooltip />
              <Bar dataKey="total" fill="#81aa91" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>ECO</th>
              <th>开局</th>
              <th>样本</th>
              <th>胜</th>
              <th>和</th>
              <th>负</th>
              <th>胜率</th>
              <th>得分率</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={`${s.eco}-${i}`}>
                <td>{s.eco}</td>
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
        {stats.length === 0 && <div className="empty">暂无可统计的对局。</div>}
      </div>
    </>
  );
}
