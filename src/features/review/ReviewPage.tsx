import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { api } from "../../shared/api";
import type { Puzzle } from "../../shared/types";
import { tryMove } from "../../shared/chess/moves";
import { playMoveSound } from "../../shared/audio/move-sound";
import { scheduleReview, type Rating } from "./scheduler";
import SourceAnnotation from "./SourceAnnotation";
function clockNow() {
  return Date.now();
}
export default function ReviewPage() {
  const [queue, setQueue] = useState<Puzzle[]>([]);
  const [attempt, setAttempt] = useState<ReturnType<typeof tryMove>>(null);
  const revealed = attempt !== null;
  const [solutionStep, setSolutionStep] = useState(0);
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState(() => clockNow());
  useEffect(() => {
    api
      .listPuzzles(true)
      .then(setQueue)
      .catch((e) => setMessage(String(e)));
  }, []);
  const current = queue[0];
  const correct = attempt
    ? current?.expectedMoves.includes(attempt.uci)
    : false;
  let solutionFen = current?.fen;
  for (let i = 0; i < solutionStep; i++) {
    const u = current?.solutionLine[i];
    if (!u || !solutionFen) break;
    solutionFen =
      tryMove(solutionFen, u.slice(0, 2), u.slice(2, 4), u[4] ?? "q")?.fen ??
      solutionFen;
  }
  function move(from: string, to: string) {
    if (!current || revealed) return false;
    const played = tryMove(current.fen, from, to);
    if (!played) {
      setMessage("这一步不合法，请重试");
      return false;
    }
    setAttempt(played);
    playMoveSound(played.san);
    setMessage(
      current.expectedMoves.includes(played.uci)
        ? "正确！请选择复习评级。"
        : "再想想。你可以查看正确答案并给本题评级。",
    );
    return true;
  }
  function advanceSolution() {
    if (!current) return;
    const next = (solutionStep + 1) % (current.solutionLine.length + 1);
    if (next > 0 && solutionFen) {
      const uci = current.solutionLine[solutionStep];
      const played = tryMove(
        solutionFen,
        uci.slice(0, 2),
        uci.slice(2, 4),
        uci[4] ?? "q",
      );
      if (played) playMoveSound(played.san);
    }
    setSolutionStep(next);
  }
  async function rate(rating: Rating) {
    if (!current) return;
    try {
      const schedule = await api.getSchedule(current.id);
      await api.recordReview({
        schedule: scheduleReview(schedule, rating),
        playedMove: attempt?.uci ?? null,
        isCorrect: !!correct,
        rating,
        timeSpentMs: clockNow() - started,
      });
      setQueue((q) => q.slice(1));
      setAttempt(null);
      setSolutionStep(0);
      setStarted(clockNow());
      setMessage("复习记录已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <>
      <div className="page-head mb-7 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-[14px] [&_p]:text-[#8d9e9b]">
        <div>
          <div className="eyebrow text-[10px] font-[750] tracking-[0.2em] text-[#81ad94]">
            SPACED REVIEW
          </div>
          <h1>今日训练</h1>
          <p>到期 {queue.length} 道 · 在棋盘上走出你认为正确的一步。</p>
        </div>
      </div>
      {message && (
        <div className="notice mb-[18px] rounded-lg border border-[#456457] bg-[#22392e] px-[15px] py-3 text-[13px] text-[#cce9d4]">
          {message}
        </div>
      )}
      {!current ? (
        <div className="panel empty full rounded-xl border border-panel-edge bg-panel px-5 py-[60px] text-center text-[#829591] grid min-h-[280px] place-items-center">
          今天没有待复习的题目。你可以在复盘中继续创建题目。
        </div>
      ) : (
        <div className="training-layout grid grid-cols-[minmax(400px,620px)_minmax(300px,1fr)] gap-6 max-[1150px]:grid-cols-[minmax(320px,1fr)_minmax(320px,1fr)] max-[900px]:grid-cols-1">
          <div className="board-frame w-full overflow-hidden rounded-lg border-8 border-[#223033] shadow-[0_16px_35px_#0004]">
            <Chessboard
              options={{
                position:
                  solutionStep > 0
                    ? solutionFen
                    : (attempt?.fen ?? current.fen),
                boardOrientation: current.sideToMove,
                allowDragging: !revealed,
                onPieceDrop: ({ sourceSquare, targetSquare }) =>
                  targetSquare ? move(sourceSquare, targetSquare) : false,
                darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
                lightSquareStyle: {
                  backgroundColor: "var(--color-board-light)",
                },
              }}
            />
          </div>
          <div className="panel training-info rounded-xl border border-panel-edge bg-panel p-7 [&_h2]:text-[23px] [&_p]:text-[#9baea5]">
            <div className="eyebrow text-[10px] font-[750] tracking-[0.2em] text-[#81ad94]">
              PUZZLE {queue.length} REMAINING
            </div>
            <h2>{current.title}</h2>
            <p>{current.description || "找到当前局面的最佳走法。"}</p>
            {revealed && (
              <>
                <div className="answer my-[30px] rounded-lg bg-[#233b32] p-[15px] leading-[1.8]">
                  <strong>{correct ? "回答正确" : "本题答案"}</strong>
                  <div>标准走法：{current.expectedMoves.join("、")}</div>
                  {current.solutionLine.length > 0 && (
                    <>
                      <div>参考变化：{current.solutionLine.join(" ")}</div>
                      <button
                        className="secondary border-control-edge bg-secondary text-secondary-ink"
                        onClick={advanceSolution}
                      >
                        播放变化 {solutionStep}/{current.solutionLine.length}
                      </button>
                    </>
                  )}
                </div>
                <SourceAnnotation key={current.id} puzzle={current} />
              </>
            )}
            <div className="rating-row mt-[30px] flex flex-wrap gap-2">
              {(["Again", "Hard", "Good", "Easy"] as const).map((r) => (
                <button
                  key={r}
                  disabled={!revealed}
                  className={
                    r === "Good"
                      ? ""
                      : "secondary border-control-edge bg-secondary text-secondary-ink"
                  }
                  onClick={() => void rate(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
