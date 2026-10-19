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
      <div className="page-head mb-7 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-[14px] [&_p]:text-[#8d9e9b]">
        <div>
          <div className="eyebrow text-[10px] font-[750] tracking-[0.2em] text-[#81ad94]">
            YOUR GAMES
          </div>
          <h1>对局</h1>
        </div>
        <div className="head-actions flex gap-2.5">
          <label className="button secondary inline-flex items-center justify-center gap-2 rounded-lg border border-accent-edge bg-accent px-[14px] py-[9px] font-[650] whitespace-nowrap text-accent-dark cursor-pointer hover:brightness-[1.12] border-control-edge bg-secondary text-secondary-ink">
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
            className="sync-button w-36 shrink-0"
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
      {message && (
        <div className="notice mb-[18px] rounded-lg border border-[#456457] bg-[#22392e] px-[15px] py-3 text-[13px] text-[#cce9d4]">
          {message}
        </div>
      )}
      {sync.message && (
        <div
          className="notice mb-[18px] rounded-lg border border-[#456457] bg-[#22392e] px-[15px] py-3 text-[13px] text-[#cce9d4]"
          role="status"
        >
          {sync.message}
        </div>
      )}
      <div className="panel filters rounded-xl border border-panel-edge bg-panel mb-[18px] flex flex-wrap gap-2.5 p-[14px] [&>*]:min-w-[125px] [&>*]:flex-1">
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
      <div className="panel table-wrap rounded-xl border border-panel-edge bg-panel overflow-hidden">
        <div className="table-title border-b border-panel-edge px-5 py-[17px] text-[15px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
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
                    className={`result rounded-[5px] px-2 py-1 ${resultLabel(g.result, g.userColor) === "胜" ? "win bg-[#244736] text-[#acd4b8]" : resultLabel(g.result, g.userColor) === "负" ? "loss bg-[#492b2d] text-[#f0a5a5]" : "bg-[#3b3d33] text-[#e8dfbd]"}`}
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
          <div className="empty px-5 py-[60px] text-center text-[#829591]">
            当前筛选下暂无对局。可调整筛选、导入 PGN 或同步 Lichess。
          </div>
        )}
        <div className="pager flex items-center justify-end gap-[14px] border-t border-panel-edge px-[18px] py-[13px] text-[12px] text-[#8a9d96] [&_button]:px-2.5 [&_button]:py-[5px]">
          <button
            className="secondary border-control-edge bg-secondary text-secondary-ink"
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
            className="secondary border-control-edge bg-secondary text-secondary-ink"
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
