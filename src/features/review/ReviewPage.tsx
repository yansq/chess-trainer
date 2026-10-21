import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { api } from "../../shared/api";
import type { Puzzle } from "../../shared/types";
import { tryMove, uciLineToSan } from "../../shared/chess/moves";
import { playMoveSound } from "../../shared/audio/move-sound";
import { scheduleReview, type Rating } from "./scheduler";
import DueForecast from "./DueForecast";
import SourceAnnotation from "./SourceAnnotation";
import { isMultiMovePuzzle } from "../puzzles/answers";
import {
  isWaitingForReply,
  playPuzzleMove,
  schedulePuzzleReply,
  type PuzzleAttempt,
} from "./attempt";
function clockNow() {
  return Date.now();
}
export default function ReviewPage() {
  const [forecastRefresh, setForecastRefresh] = useState(0);
  const [queue, setQueue] = useState<Puzzle[]>([]);
  const [attempt, setAttempt] = useState<PuzzleAttempt | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<{
    puzzleId: string;
    fen: string;
    square: string;
  } | null>(null);
  const [promotion, setPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [answerShown, setAnswerShown] = useState(false);
  const [hadMistake, setHadMistake] = useState(false);
  const revealed = answerShown || (attempt?.complete ?? false);
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
  const waitingForReply = isWaitingForReply(attempt);
  const fen = attempt?.fen ?? current?.fen;
  const selected =
    selectedSquare?.puzzleId === current?.id &&
    selectedSquare?.fen === fen &&
    !revealed &&
    !waitingForReply &&
    !promotion
      ? selectedSquare?.square
      : null;
  const correct = !answerShown && (attempt?.correct ?? false);
  const multiMove = current ? isMultiMovePuzzle(current) : false;
  useEffect(() => {
    if (!current || !attempt || !waitingForReply || revealed) return;
    return schedulePuzzleReply(
      current,
      attempt,
      (reply) => {
        setAttempt(reply);
        playMoveSound(reply.san);
        setMessage(
          reply.complete
            ? "正确！请选择复习评级。"
            : `正确，对手已走 ${reply.san}，请继续。`,
        );
      },
      setMessage,
    );
  }, [current, attempt, waitingForReply, revealed]);
  let solutionFen = current?.fen;
  for (let i = 0; i < solutionStep; i++) {
    const u = current?.solutionLine[i];
    if (!u || !solutionFen) break;
    solutionFen =
      tryMove(solutionFen, u.slice(0, 2), u.slice(2, 4), u[4] ?? "q")?.fen ??
      solutionFen;
  }
  function move(from: string, to: string, piece?: string) {
    if (!current || revealed || waitingForReply) return false;
    try {
      const played = playPuzzleMove(current, attempt, from, to, piece);
      if (!played) {
        setMessage("这一步不合法，请重试");
        return false;
      }
      if (!piece && played.san.includes("=")) {
        setSelectedSquare(null);
        setPromotion({ from, to });
        return false;
      }
      setPromotion(null);
      setSelectedSquare(null);
      setAttempt(played);
      if (!played.correct) setHadMistake(true);
      else playMoveSound(played.san);
      setMessage(
        !played.correct
          ? "这一步不对，请继续尝试；需要帮助时可点击「显示答案」。"
          : played.complete
            ? "正确！请选择复习评级。"
            : "正确，等待对手走棋…",
      );
      return played.correct;
    } catch (error) {
      setMessage(String(error));
      return false;
    }
  }
  function clickSquare(square: string) {
    if (!current || !fen || revealed || promotion || waitingForReply) return;
    const chess = new Chess(fen);
    const piece = chess.get(square as Square);
    if (piece?.color === chess.turn()) {
      setSelectedSquare(
        selected === square ? null : { puzzleId: current.id, fen, square },
      );
      return;
    }
    if (selected) move(selected, square);
  }
  function showAnswer() {
    setAnswerShown(true);
    setSelectedSquare(null);
    setPromotion(null);
    setSolutionStep(0);
    setMessage("已显示答案，请查看正确走法后选择复习评级。");
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
    if (!current || !revealed) return;
    try {
      const schedule = await api.getSchedule(current.id);
      await api.recordReview({
        schedule: scheduleReview(schedule, rating),
        playedMove:
          attempt?.moves.filter((_, index) => index % 2 === 0).join(" ") ??
          null,
        isCorrect: !!correct && !hadMistake,
        rating,
        timeSpentMs: clockNow() - started,
      });
      setForecastRefresh((value) => value + 1);
      setQueue((q) => q.slice(1));
      setAttempt(null);
      setAnswerShown(false);
      setHadMistake(false);
      setSelectedSquare(null);
      setPromotion(null);
      setSolutionStep(0);
      setStarted(clockNow());
      setMessage("复习记录已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-sm [&_p]:text-description">
        <div>
          <div className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            SPACED REVIEW
          </div>
          <h1>今日训练</h1>
          <p>
            到期 {queue.length} 道 ·
            拖动棋子，或依次点击起点和终点走棋；多步题会自动走出对手应手。
          </p>
        </div>
      </div>
      <DueForecast refreshKey={forecastRefresh} />
      {message && !current && (
        <div className="mb-4.5 rounded-lg border border-notice-edge bg-notice px-3.75 py-3 text-body-sm text-notice-ink">
          {message}
        </div>
      )}
      {!current ? (
        <div className="rounded-xl border border-panel-edge bg-panel px-5 py-15 text-center text-empty grid min-h-70 place-items-center">
          今天没有待复习的题目。你可以在复盘中继续创建题目。
        </div>
      ) : (
        <div className="grid grid-cols-training items-start gap-6 max-[1150px]:grid-cols-training-compact max-[900px]:grid-cols-1">
          <div className="w-full overflow-hidden rounded-lg border-8 border-board-frame shadow-board">
            <Chessboard
              options={{
                position: solutionStep > 0 ? solutionFen : fen,
                boardOrientation: current.sideToMove,
                allowDragging: !revealed && !promotion && !waitingForReply,
                dragActivationDistance: 5,
                canDragPiece: ({ piece }) =>
                  piece.pieceType[0] ===
                  (current.sideToMove === "white" ? "w" : "b"),
                onPieceDrag: () => setSelectedSquare(null),
                onPieceDrop: ({ sourceSquare, targetSquare }) =>
                  targetSquare ? move(sourceSquare, targetSquare) : false,
                onSquareClick: ({ square }) => clickSquare(square),
                squareStyles: selected
                  ? {
                      [selected]: {
                        backgroundColor: "var(--color-board-selected)",
                      },
                    }
                  : {},
                darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
                lightSquareStyle: {
                  backgroundColor: "var(--color-board-light)",
                },
              }}
            />
          </div>
          <div className="rounded-xl border border-panel-edge bg-panel p-7 [&_h2]:text-panel-title [&_p]:text-training-description">
            <div className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
              PUZZLE {queue.length} REMAINING
            </div>
            <h2>{current.title}</h2>
            <p>{current.description || "找到当前局面的最佳走法。"}</p>
            <div role="status" aria-live="polite">
              {message && (
                <div className="my-4 rounded-lg border border-notice-edge bg-notice px-3.75 py-3 text-body-sm text-notice-ink">
                  {message}
                </div>
              )}
            </div>
            {promotion && (
              <div
                className="my-4 flex flex-wrap items-center gap-2"
                role="group"
                aria-label="选择升变棋子"
              >
                <span>升变为</span>
                {(
                  [
                    ["q", "后"],
                    ["r", "车"],
                    ["b", "象"],
                    ["n", "马"],
                  ] as const
                ).map(([piece, label]) => (
                  <button
                    key={piece}
                    onClick={() => move(promotion.from, promotion.to, piece)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="border-control-edge bg-secondary text-secondary-ink"
                  onClick={() => setPromotion(null)}
                >
                  取消
                </button>
              </div>
            )}
            {multiMove && (
              <p>
                连续多步 · 已走 {Math.ceil((attempt?.moves.length ?? 0) / 2)} /{" "}
                {Math.ceil(current.solutionLine.length / 2)} 步
              </p>
            )}
            {!revealed && (
              <button
                className="mt-4 border-control-edge bg-secondary text-secondary-ink"
                onClick={showAnswer}
              >
                显示答案
              </button>
            )}
            {revealed && (
              <>
                <div className="my-7.5 rounded-lg bg-answer p-3.75 leading-answer">
                  <strong>{correct ? "回答正确" : "本题答案"}</strong>
                  <div>
                    标准走法：
                    {current.expectedMoves
                      .map((uci) => uciLineToSan(current.fen, [uci])[0] ?? uci)
                      .join("、")}
                  </div>
                  {current.solutionLine.length > 0 && (
                    <>
                      <div>
                        {multiMove ? "完整答案" : "参考变化"}：
                        {uciLineToSan(current.fen, current.solutionLine).join(
                          " ",
                        )}
                      </div>
                      <button
                        className="border-control-edge bg-secondary text-secondary-ink"
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
            <div className="mt-7.5 flex flex-wrap gap-2">
              {(["Again", "Hard", "Good", "Easy"] as const).map((r) => (
                <button
                  key={r}
                  disabled={!revealed}
                  className={
                    r === "Good"
                      ? ""
                      : " border-control-edge bg-secondary text-secondary-ink"
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
