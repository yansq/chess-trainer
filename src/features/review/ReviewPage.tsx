import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { api } from "../../shared/api";
import type { Puzzle } from "../../shared/types";
import { tryMove } from "../../shared/chess/moves";
import { scheduleReview, type Rating } from "./scheduler";
function clockNow() {
  return Date.now();
}
export default function ReviewPage() {
  const [queue, setQueue] = useState<Puzzle[]>([]);
  const [attempt, setAttempt] = useState<{
    uci: string;
    san: string;
    fen: string;
  } | null>(null);
  const [revealed, setRevealed] = useState(false);
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
    setRevealed(true);
    setMessage(
      current.expectedMoves.includes(played.uci)
        ? "正确！请选择复习评级。"
        : "再想想。你可以查看正确答案并给本题评级。",
    );
    return true;
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
      setRevealed(false);
      setSolutionStep(0);
      setStarted(clockNow());
      setMessage("复习记录已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">SPACED REVIEW</div>
          <h1>今日训练</h1>
          <p>到期 {queue.length} 道 · 在棋盘上走出你认为正确的一步。</p>
        </div>
      </div>
      {message && <div className="notice">{message}</div>}
      {!current ? (
        <div className="panel empty full">
          今天没有待复习的题目。你可以在复盘中继续创建题目。
        </div>
      ) : (
        <div className="training-layout">
          <div className="board-frame">
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
                darkSquareStyle: { backgroundColor: "#65847d" },
                lightSquareStyle: { backgroundColor: "#e8dfca" },
              }}
            />
          </div>
          <div className="panel training-info">
            <div className="eyebrow">PUZZLE {queue.length} REMAINING</div>
            <h2>{current.title}</h2>
            <p>{current.description || "找到当前局面的最佳走法。"}</p>
            {revealed && (
              <div className="answer">
                <strong>{correct ? "回答正确" : "本题答案"}</strong>
                <div>标准走法：{current.expectedMoves.join("、")}</div>
                {current.solutionLine.length > 0 && (
                  <>
                    <div>参考变化：{current.solutionLine.join(" ")}</div>
                    <button
                      className="secondary"
                      onClick={() =>
                        setSolutionStep(
                          (v) => (v + 1) % (current.solutionLine.length + 1),
                        )
                      }
                    >
                      播放变化 {solutionStep}/{current.solutionLine.length}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="rating-row">
              {(["Again", "Hard", "Good", "Easy"] as const).map((r) => (
                <button
                  key={r}
                  disabled={!revealed}
                  className={r === "Good" ? "" : "secondary"}
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
