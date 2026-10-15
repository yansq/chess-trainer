import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, RefreshCw, Pause } from "lucide-react";
import { api } from "../../shared/api";
import type { GameFilter, GamePage } from "../../shared/types";
import { parsePgnCollection } from "./pgn";
import { OpponentTypeSelect } from "../../shared/ui/OpponentTypeSelect";
import { Select } from "../../shared/ui/select";
import { useLichessSync } from "./sync-store";
const initial: GameFilter = {
  opponentType: "human",
  color: null,
  result: null,
  speed: null,
  reviewed: null,
  opening: null,
  limit: 25,
  offset: 0,
};
function resultLabel(result: string, color: string | null) {
  if (result === "draw") return "和";
  if (!color || result === "unknown") return "未知";
  return result === color ? "胜" : "负";
}
export default function GamesPage() {
  const nav = useNavigate();
  const [filter, setFilter] = useState(initial);
  const [page, setPage] = useState<GamePage>({ items: [], total: 0 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sync = useLichessSync();
  const refreshSync = sync.refresh;
  const load = useCallback(
    () =>
      api
        .listGames(filter)
        .then(setPage)
        .catch((e) => setMessage(String(e))),
    [filter],
  );
  useEffect(() => {
    void load();
  }, [load, sync.revision]);
  useEffect(() => {
    void refreshSync();
  }, [refreshSync]);
  async function importFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const username = await api.getSetting("lichess_username");
      const games = parsePgnCollection(text, "local", username ?? undefined);
      const added = await api.importGames(games);
      setMessage(`已读取 ${games.length} 局，新增 ${added} 局`);
      await load();
    } catch (e) {
      setMessage(`导入失败：${e}`);
    } finally {
      setBusy(false);
    }
  }
  const change = (patch: Partial<GameFilter>) =>
    setFilter((f) => ({ ...f, ...patch, offset: 0 }));
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR GAMES</div>
          <h1>对局</h1>
        </div>
        <div className="head-actions">
          <label className="button secondary">
            <Upload size={16} /> 导入 PGN
            <input
              hidden
              disabled={busy || sync.running}
              type="file"
              accept=".pgn,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="sync-button"
            disabled={busy || sync.pausing}
            onClick={() => {
              if (sync.running) sync.pause();
              else void sync.start();
            }}
          >
            {sync.running ? <Pause size={16} /> : <RefreshCw size={16} />}
            {sync.pausing
              ? "正在暂停…"
              : sync.running
                ? "暂停同步"
                : sync.checkpoint?.pending
                  ? "继续同步"
                  : "同步对局"}
          </button>
        </div>
      </div>
      {message && <div className="notice">{message}</div>}
      {sync.message && (
        <div className="notice" role="status">
          {sync.message}
        </div>
      )}
      <div className="panel filters">
        <OpponentTypeSelect
          value={filter.opponentType}
          onChange={(opponentType) => change({ opponentType })}
        />
        <Select
          label="执棋颜色"
          value={filter.color ?? ""}
          onValueChange={(color) => change({ color: color || null })}
          options={[
            { value: "", label: "全部执棋" },
            { value: "white", label: "白方" },
            { value: "black", label: "黑方" },
          ]}
        />
        <Select
          label="对局结果"
          value={filter.result ?? ""}
          onValueChange={(result) => change({ result: result || null })}
          options={[
            { value: "", label: "全部结果" },
            { value: "win", label: "胜" },
            { value: "draw", label: "和" },
            { value: "loss", label: "负" },
          ]}
        />
        <Select
          label="复盘状态"
          value={filter.reviewed === null ? "" : String(filter.reviewed)}
          onValueChange={(reviewed) =>
            change({ reviewed: reviewed === "" ? null : reviewed === "true" })
          }
          options={[
            { value: "", label: "全部状态" },
            { value: "false", label: "未复盘" },
            { value: "true", label: "已复盘" },
          ]}
        />
        <Select
          label="对局时限"
          value={filter.speed ?? ""}
          onValueChange={(speed) => change({ speed: speed || null })}
          options={[
            { value: "", label: "全部时限" },
            { value: "bullet", label: "Bullet" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
          ]}
        />
        <input
          placeholder="搜索 ECO / 开局"
          value={filter.opening ?? ""}
          onChange={(e) => change({ opening: e.target.value || null })}
        />
      </div>
      <div className="panel table-wrap">
        <div className="table-title">
          对局记录 <span>{page.total} 局</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>对手</th>
              <th>执棋</th>
              <th>结果</th>
              <th>开局</th>
              <th>时限</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((g) => (
              <tr
                key={g.id}
                onClick={() => nav(`/analysis/${encodeURIComponent(g.id)}`)}
              >
                <td>{g.playedAt?.slice(0, 10) ?? "—"}</td>
                <td>
                  {g.userColor === "white" ? g.blackPlayer : g.whitePlayer}
                </td>
                <td>{g.userColor === "white" ? "白" : "黑"}</td>
                <td>
                  <span
                    className={`result ${resultLabel(g.result, g.userColor) === "胜" ? "win" : ""}`}
                  >
                    {resultLabel(g.result, g.userColor)}
                  </span>
                </td>
                <td>
                  {g.eco ?? "—"} · {g.openingName ?? "未知开局"}
                </td>
                <td>{g.speed ?? "—"}</td>
                <td>{g.reviewStatus ? "已复盘" : "待复盘"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.items.length === 0 && (
          <div className="empty">
            当前筛选下暂无对局。可调整筛选、导入 PGN 或同步 Lichess。
          </div>
        )}
        <div className="pager">
          <button
            className="secondary"
            disabled={filter.offset === 0}
            onClick={() =>
              setFilter((f) => ({ ...f, offset: f.offset - f.limit }))
            }
          >
            上一页
          </button>
          <span>
            {page.total ? Math.floor(filter.offset / filter.limit) + 1 : 0} /{" "}
            {Math.ceil(page.total / filter.limit)}
          </span>
          <button
            className="secondary"
            disabled={filter.offset + filter.limit >= page.total}
            onClick={() =>
              setFilter((f) => ({ ...f, offset: f.offset + f.limit }))
            }
          >
            下一页
          </button>
        </div>
      </div>
    </>
  );
}
