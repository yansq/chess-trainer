import {
  Heading,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { api } from "../../shared/api";
import type { Puzzle, Schedule } from "../../shared/types";
import { uciLineToSan } from "../../shared/chess/moves";
import { playMoveSound } from "../../shared/audio/move-sound";
import {
  scheduleReview,
  previewNextIntervals,
  type Rating,
} from "./scheduler";
import DueForecast from "./DueForecast";
import SourceAnnotation from "./SourceAnnotation";
import { isMultiMovePuzzle } from "../puzzles/answers";
import {
  isWaitingForReply,
  playPuzzleMove,
  schedulePuzzleReply,
  type PuzzleAttempt,
} from "./attempt";
import { buildSolutionSteps, calculateNextStep } from "./solution";
function clockNow() {
  return Date.now();
}
function formatInterval(days: number | undefined): string {
  if (days === undefined) return "";
  if (days <= 1) return "1天";
  if (days < 30) return `${days}天`;
  if (days < 365) return `${Math.round(days / 30)}月`;
  return `${(days / 365).toFixed(1)}年`;
}
export default function ReviewPage() {
  const [forecastRefresh, setForecastRefresh] = useState(0);
  const [queue, setQueue] = useState<Puzzle[]>([]);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
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
  useEffect(() => {
    let active = true;
    if (current) {
      api
        .getSchedule(current.id)
        .then((s) => {
          if (active) setCurrentSchedule(s);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [current]);
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
  const intervals = useMemo(
    () =>
      revealed && currentSchedule
        ? previewNextIntervals(currentSchedule)
        : null,
    [revealed, currentSchedule],
  );
  const solutionSteps = useMemo(() => {
    return buildSolutionSteps(current?.fen, current?.solutionLine);
  }, [current]);

  const stepSolution = useCallback(
    (delta: number) => {
      if (!current || solutionSteps.length === 0) return;
      const maxSteps = solutionSteps.length;
      setSolutionStep((prev) => {
        const next = calculateNextStep(prev, delta, maxSteps);
        if (next === prev) return prev;
        if (delta > 0 && next > 0) {
          const stepInfo = solutionSteps[next - 1];
          playMoveSound(stepInfo?.san ?? "");
        } else {
          playMoveSound("");
        }
        return next;
      });
    },
    [current, solutionSteps],
  );

  const advanceSolution = useCallback(() => {
    if (!current || solutionSteps.length === 0) return;
    const maxSteps = solutionSteps.length;
    setSolutionStep((prev) => {
      const next = (prev + 1) % (maxSteps + 1);
      if (next > 0) {
        const stepInfo = solutionSteps[next - 1];
        playMoveSound(stepInfo?.san ?? "");
      } else {
        playMoveSound("");
      }
      return next;
    });
  }, [current, solutionSteps]);

  useEffect(() => {
    if (!current || !revealed || solutionSteps.length === 0) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="option"], [role="dialog"], [role="alertdialog"]',
        )
      ) {
        return;
      }

      event.preventDefault();
      stepSolution(event.key === "ArrowLeft" ? -1 : 1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [current, revealed, solutionSteps.length, stepSolution]);

  const isReviewingSolution = answerShown || solutionStep > 0;
  const boardPosition = isReviewingSolution
    ? solutionStep === 0
      ? (current?.fen ?? fen)
      : (solutionSteps[solutionStep - 1]?.fen ?? current?.fen ?? fen)
    : fen;

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
  async function rate(rating: Rating) {
    if (!current || !revealed) return;
    try {
      const schedule = currentSchedule ?? (await api.getSchedule(current.id));
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
      setCurrentSchedule(null);
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
      <Flex
        align="center"
        justify="between"
        mb="3"
        gap="5"
        className="[&_p]:m-0 [&_p]:text-sm [&_p]:text-description"
      >
        <Box>
          <Heading as="h1" size="7">
            今日训练
          </Heading>
          <p>到期 {queue.length} 题</p>
        </Box>
      </Flex>
      <DueForecast refreshKey={forecastRefresh} />
      {message && !current && (
        <Callout.Root size="1" className="mb-5">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      {!current ? (
        <Card className="px-5 py-15 text-center text-empty grid min-h-70 place-items-center">
          今天没有待复习的题目。你可以在复盘中继续创建题目。
        </Card>
      ) : (
        <Grid
          align="start"
          gap="6"
          className="grid-cols-training max-[1150px]:grid-cols-training-compact max-[900px]:grid-cols-1"
        >
          <Box className="w-full overflow-hidden rounded-lg border-8 border-board-frame shadow-board">
            <Chessboard
              options={{
                position: boardPosition,
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
          </Box>
          <Card className="p-7 [&_h2]:text-panel-title [&_p]:text-training-description">
            <Box className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
              剩余 {queue.length} 道题目
            </Box>
            <Heading size="6" mt="2" mb="3">
              {current.title}
            </Heading>
            <p>找到当前局面的最佳走法。</p>
            <Box role="status" aria-live="polite">
              {message && (
                <Callout.Root size="1" className="my-4">
                  <Callout.Text>{message}</Callout.Text>
                </Callout.Root>
              )}
            </Box>
            {promotion && (
              <Flex
                wrap="wrap"
                align="center"
                my="4"
                gap="2"

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
                  <Button
                    size="1"
                    variant="solid"
                    key={piece}
                    onClick={() => move(promotion.from, promotion.to, piece)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  size="1"
                  variant="soft"
                  onClick={() => setPromotion(null)}
                >
                  取消
                </Button>
              </Flex>
            )}
            {multiMove && (
              <p>
                连续多步 · 已走 {Math.ceil((attempt?.moves.length ?? 0) / 2)} /{" "}
                {Math.ceil(current.solutionLine.length / 2)} 步
              </p>
            )}
            {!revealed && (
              <Button
                size="1"
                variant="soft"
                className="mt-4"
                onClick={showAnswer}
              >
                显示答案
              </Button>
            )}
            {revealed && (
              <>
                <Box className="my-8 rounded-lg bg-answer p-4 leading-answer">
                  <strong>{correct ? "回答正确" : "本题答案"}</strong>
                  {current.description && (
                    <p className="whitespace-pre-wrap wrap-anywhere">
                      {current.description}
                    </p>
                  )}
                  <Box>
                    标准走法：
                    {current.expectedMoves
                      .map((uci) => uciLineToSan(current.fen, [uci])[0] ?? uci)
                      .join("、")}
                  </Box>
                  {solutionSteps.length > 0 && (
                    <>
                      <Box>
                        {multiMove ? "完整答案" : "参考变化"}：
                        {solutionSteps.map((step) => step.san).join(" ")}
                      </Box>
                      <Flex align="center" gap="2" mt="2" wrap="wrap">
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => stepSolution(-1)}
                          disabled={solutionStep <= 0}
                          aria-label="上一步"
                          aria-keyshortcuts="ArrowLeft"
                          title="上一步 (← 方向键)"
                        >
                          <ChevronLeft size={14} />
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          onClick={advanceSolution}
                          title="循环播放下一步 (或使用左右方向键)"
                        >
                          播放变化 {solutionStep}/{solutionSteps.length}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => stepSolution(1)}
                          disabled={solutionStep >= solutionSteps.length}
                          aria-label="下一步"
                          aria-keyshortcuts="ArrowRight"
                          title="下一步 (→ 方向键)"
                        >
                          <ChevronRight size={14} />
                        </Button>
                        {solutionSteps.length > 1 && (
                          <span className="text-xs text-engine-muted select-none">
                            支持按 ← / → 方向键导航
                          </span>
                        )}
                      </Flex>
                    </>
                  )}
                </Box>
                <SourceAnnotation key={current.id} puzzle={current} />
              </>
            )}
            <Flex wrap="wrap" gap="2" className="mt-8">
              {(["Again", "Hard", "Good", "Easy"] as const).map((r) => {
                const interval = intervals?.[r];
                const intervalText =
                  interval !== undefined ? ` · ${formatInterval(interval)}` : "";
                const isRecommended =
                  hadMistake || answerShown ? r === "Again" : r === "Good";
                return (
                  <Button
                    size="2"
                    variant={isRecommended ? "solid" : "soft"}
                    key={r}
                    disabled={!revealed}
                    onClick={() => void rate(r)}
                  >
                    {r}
                    {intervalText}
                  </Button>
                );
              })}
            </Flex>
          </Card>
        </Grid>
      )}
    </>
  );
}
