import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  Copy,
  RotateCcw,
} from "lucide-react";
import { api } from "../../shared/api";
import {
  startPositionAnalysis,
  type PositionAnalysis,
} from "./engine-analysis";
import {
  PUZZLE_CATEGORIES,
  type Game,
  type Puzzle,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";
import { uciLineToSan } from "../../shared/chess/moves";
import { playMoveSound, playSound } from "../../shared/audio/move-sound";
import { classifyMove, type Candidate } from "./blunders";
import NotePanel from "./NotePanel";
import {
  qualityBadges,
  startMoveQualityAnalysis,
  type MoveQuality,
} from "./move-quality";
import MoveList from "./MoveList";
import { startGameAnalysis, type GameAnalysis } from "./game-analysis";
import { puzzleContinuation } from "./puzzle-continuation";
import { parsePuzzleAnswers } from "../puzzles/answers";
import {
  createReviewTree,
  currentReviewMove,
  moveNumber,
  navigateReview,
  playReviewMove,
  returnToMainline,
  reviewLineEnd,
  selectReviewMove,
  type ReviewTree,
} from "./review-tree";

function playReviewSound(previous: ReviewTree, next: ReviewTree) {
  if (previous.currentId === next.currentId) return;
  const destination = currentReviewMove(next);
  const undo =
    previous.currentId !== null &&
    currentReviewMove(previous)?.parentId === next.currentId;
  if (undo || !destination) void playSound("move");
  else playMoveSound(destination.san);
}

export default function AnalysisPage() {
  const { id } = useParams();
  const navigateTo = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState(() => createReviewTree([]));
  const [selectedSquare, setSelectedSquare] = useState<{
    fen: string;
    square: string;
  } | null>(null);
  const [promotion, setPromotion] = useState<{
    fen: string;
    from: string;
    to: string;
  } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [copiedFen, setCopiedFen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [showPuzzle, setShowPuzzle] = useState(false);
  const [activeTool, setActiveTool] = useState<"position" | "batch" | "puzzle">(
    "position",
  );
  const [title, setTitle] = useState("");
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [puzzleCategory, setPuzzleCategory] =
    useState<PuzzleCategory>("opening");
  const titleRequest = useRef(0);
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState("");
  const [puzzleOrigin, setPuzzleOrigin] = useState<{
    moveId: string | null;
    sourceMoveId: string | null;
    fen: string;
  } | null>(null);
  const syncPuzzleAnswers = useCallback(
    (next: ReviewTree) => {
      if (activeTool !== "puzzle" || !puzzleOrigin) return;
      const text = puzzleContinuation(next, puzzleOrigin.moveId);
      if (text !== null) setAnswers(text);
    },
    [activeTool, puzzleOrigin],
  );
  const [positionAnalysis, setPositionAnalysis] =
    useState<PositionAnalysis | null>(null);
  const [moveQualities, setMoveQualities] = useState<{
    gameId: string;
    values: Record<string, MoveQuality>;
  }>({ gameId: "", values: {} });
  const [gameAnalysis, setGameAnalysis] = useState<
    (GameAnalysis & { gameId: string }) | null
  >(null);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const gameId = game?.id;
  const gameMoves = game?.moves;
  useEffect(() => {
    if (!gameId || !gameMoves) return;
    return startGameAnalysis(
      gameMoves,
      gameMoves[0]?.fenBefore ?? new Chess().fen(),
      (result) => setGameAnalysis({ ...result, gameId }),
    );
  }, [gameId, gameMoves, analysisRetry]);
  const batchCancelled = useRef(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batchProgress, setBatchProgress] = useState("");
  useEffect(() => {
    if (!copiedFen) return;
    const timer = window.setTimeout(() => setCopiedFen(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedFen]);
  useEffect(() => {
    if (!id) return;
    api
      .getGame(id)
      .then((g) => {
        setGame(g);
        setReview(createReviewTree(g.moves));
        setNotes({});
        setFlipped(g.userColor === "black");
        return api.getAnnotations(id);
      })
      .then((rows) => {
        const map: Record<string, string> = {};
        for (const [moveId, content] of rows)
          map[moveId ?? "summary"] = content;
        setNotes(map);
      })
      .catch((e) => setMessage(String(e)));
  }, [id]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedSquare(null);
        setPromotion(null);
        const next = navigateReview(
          review,
          e.key === "ArrowLeft" ? "back" : "next",
        );
        playReviewSound(review, next);
        syncPuzzleAnswers(next);
        setReview(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [review, syncPuzzleAnswers]);
  const currentMove = currentReviewMove(review);
  const ply = currentMove?.ply ?? 0;
  const fen = currentMove?.fenAfter ?? review.initialFen;
  const inBranch = !!currentMove && currentMove.sourceMoveId === null;
  const preanalysis = gameAnalysis?.gameId === game?.id ? gameAnalysis : null;
  const engine = inBranch
    ? positionAnalysis?.fen === fen
      ? positionAnalysis.analysis
      : null
    : (preanalysis?.positions[fen] ?? null);
  const engineStatus = inBranch
    ? positionAnalysis?.fen === fen
      ? positionAnalysis.status
      : "分析中…"
    : engine
      ? ""
      : (preanalysis?.status ?? "准备整局预分析…");
  const lineLength = reviewLineEnd(review)?.ply ?? 0;
  const selected = selectedSquare?.fen === fen ? selectedSquare.square : null;
  const noteKey = currentMove?.id ?? "summary";
  const qualities = {
    ...preanalysis?.qualities,
    ...(moveQualities.gameId === game?.id ? moveQualities.values : {}),
  };
  const moveQuality = currentMove ? qualities[currentMove.id] : null;
  const quality = moveQuality?.fen === fen ? moveQuality : null;
  const badge = quality?.category ? qualityBadges[quality.category] : null;
  const markedSquare = badge ? currentMove?.uci.slice(2, 4) : null;
  function changeReview(next: ReviewTree) {
    playReviewSound(review, next);
    syncPuzzleAnswers(next);
    setSelectedSquare(null);
    setPromotion(null);
    setReview(next);
  }
  function navigate(direction: "start" | "back" | "next" | "end") {
    changeReview(navigateReview(review, direction));
  }
  useEffect(() => {
    if (inBranch) return startPositionAnalysis(fen, setPositionAnalysis);
  }, [fen, inBranch]);
  useEffect(() => {
    if (!game || !inBranch || !currentMove || !engine || engineStatus) return;
    return startMoveQualityAnalysis(
      { ...currentMove, gameId: game.id },
      engine,
      (result) =>
        setMoveQualities((previous) => ({
          gameId: game.id,
          values: {
            ...(previous.gameId === game.id ? previous.values : {}),
            [result.moveId]: result,
          },
        })),
    );
  }, [game, inBranch, currentMove, engine, engineStatus]);
  function playMove(from: string, to: string, piece?: string): boolean {
    const next = playReviewMove(review, from, to, piece);
    if (!next) return false;
    if (
      !piece &&
      new Chess(fen).get(from as Square)?.type === "p" &&
      /^[a-h][18]$/.test(to)
    ) {
      setPromotion({ fen, from, to });
      setSelectedSquare(null);
      return false;
    }
    changeReview(next);
    return true;
  }
  function clickSquare(square: string) {
    const chess = new Chess(fen);
    const piece = chess.get(square as Square);
    if (piece?.color === chess.turn()) {
      setSelectedSquare(selected === square ? null : { fen, square });
      return;
    }
    if (selected) playMove(selected, square);
  }
  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fen);
      setCopiedFen(fen);
    } catch {
      setMessage("复制 FEN 失败，请重试");
    }
  }
  async function completeOrNextGame() {
    if (!game || reviewBusy) return;
    setReviewBusy(true);
    setMessage("");
    try {
      if (!game.reviewStatus) {
        await api.setReviewed(game.id, true);
        setGame({ ...game, reviewStatus: true });
      } else {
        const next = await api.listGames({
          opponentType: "all",
          color: null,
          result: null,
          speed: null,
          reviewed: false,
          opening: null,
          limit: 1,
          offset: 0,
        });
        if (next.items[0]) {
          navigateTo(`/analysis/${encodeURIComponent(next.items[0].id)}`);
        } else {
          setMessage("所有对局均已复盘完成，暂无下一盘未复盘的对局。");
        }
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setReviewBusy(false);
    }
  }
  async function detectBlunders() {
    if (!game?.userColor) {
      setMessage(
        "无法判断你的执棋颜色。请在设置中填写与棋谱一致的用户名后重新导入。",
      );
      return;
    }
    const path = await api.getSetting("engine_path");
    if (!path) {
      setMessage("请先在设置中配置 Stockfish");
      return;
    }
    const depth = Number((await api.getSetting("engine_depth")) ?? 14);
    const thresholds = {
      inaccuracy: Number((await api.getSetting("loss_inaccuracy")) ?? 0.12),
      mistake: Number((await api.getSetting("loss_mistake")) ?? 0.25),
      blunder: Number((await api.getSetting("loss_blunder")) ?? 0.4),
    };
    batchCancelled.current = false;
    setCandidates([]);
    const found: Candidate[] = [];
    const own = game.moves.filter(
      (m) => (m.ply % 2 === 1 ? "white" : "black") === game.userColor,
    );
    for (let i = 0; i < own.length; i++) {
      if (batchCancelled.current) break;
      setBatchProgress(`分析中 ${i + 1} / ${own.length}`);
      try {
        const before = await api.engineAnalyze(path, own[i].fenBefore, depth);
        if (batchCancelled.current) break;
        const after = await api.engineAnalyze(path, own[i].fenAfter, depth);
        const candidate = classifyMove(
          own[i],
          game.userColor,
          before,
          after,
          thresholds,
        );
        if (candidate) {
          found.push(candidate);
          setCandidates([...found]);
        }
      } catch (e) {
        if (!batchCancelled.current) {
          setMessage(`批量分析中断：${e}`);
          break;
        }
      }
    }
    setBatchProgress(
      batchCancelled.current
        ? "已取消"
        : `分析完成，发现 ${found.length} 个候选`,
    );
  }
  async function confirmCandidate(c: Candidate) {
    if (!game) return;
    const puzzle: Puzzle = {
      id: `auto:${c.move.id}`,
      sourceType: "auto",
      category: "opening",
      sourceGameId: game.id,
      sourceMoveId: c.move.id,
      fen: c.move.fenBefore,
      sideToMove: game.userColor ?? "white",
      title: "",
      description: `原招法 ${c.move.san}，胜率损失约 ${(c.loss * 100).toFixed(0)}%。请重新选择。`,
      originalMove: c.move.uci,
      expectedMoves: [c.bestMove],
      solutionLine: c.solutionLine,
      errorCategory: c.category,
    };
    try {
      const savedTitle = await api.savePuzzle(puzzle);
      setCandidates((v) => v.filter((x) => x.move.id !== c.move.id));
      setMessage(`题目「${savedTitle}」已加入题库`);
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function openPuzzleForm() {
    if (showPuzzle) {
      setActiveTool("puzzle");
      return;
    }
    setPuzzleOrigin({
      moveId: review.currentId,
      sourceMoveId: currentMove?.sourceMoveId ?? null,
      fen,
    });
    setAnswers("");
    setTitle("");
    setGeneratedTitle("");
    setShowPuzzle(true);
    setActiveTool("puzzle");
    await changePuzzleCategory(puzzleCategory);
  }
  async function changePuzzleCategory(category: PuzzleCategory) {
    if (!game) return;
    setPuzzleCategory(category);
    const request = ++titleRequest.current;
    try {
      const name = await api.nextPuzzleTitle(game.id, category);
      if (request !== titleRequest.current) return;
      setTitle(name);
      setGeneratedTitle(name);
      setShowPuzzle(true);
      setActiveTool("puzzle");
    } catch (error) {
      if (request === titleRequest.current) setMessage(String(error));
    }
  }
  async function createPuzzle() {
    if (!game || !puzzleOrigin) return;
    let parsed: ReturnType<typeof parsePuzzleAnswers>;
    try {
      parsed = parsePuzzleAnswers(puzzleOrigin.fen, answers, true);
    } catch (error) {
      setMessage(String(error));
      return;
    }
    const puzzle: Puzzle = {
      id: crypto.randomUUID(),
      sourceType: "manual",
      category: puzzleCategory,
      sourceGameId: game.id,
      sourceMoveId: puzzleOrigin.sourceMoveId,
      fen: puzzleOrigin.fen,
      sideToMove: puzzleOrigin.fen.split(" ")[1] === "w" ? "white" : "black",
      title: title.trim() === generatedTitle ? "" : title.trim(),
      description,
      originalMove: null,
      ...parsed,
      errorCategory: null,
    };
    try {
      const savedTitle = await api.savePuzzle(puzzle);
      setShowPuzzle(false);
      setActiveTool("position");
      setAnswers("");
      setMessage(`题目「${savedTitle}」已加入题库`);
    } catch (e) {
      setMessage(String(e));
    }
  }
  if (!id)
    return (
      <div className="px-5 py-15 text-center text-empty grid min-h-70 place-items-center">
        请从「对局」列表选择一局开始复盘。
      </div>
    );
  if (!game)
    return (
      <div className="px-5 py-15 text-center text-empty grid min-h-70 place-items-center">
        {message || "加载对局…"}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 flex items-center justify-between gap-3 [&_h1]:truncate [&_p]:truncate [&_h1]:my-1 [&_h1]:text-2xl [&>button]:shrink-0 [&>button]:px-3 [&>button]:py-2 [&>button]:text-xs [&_p]:m-0 [&_p]:text-sm [&_p]:text-description">
        <div className="min-w-0">
          <div className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            GAME REVIEW
          </div>
          <h1>
            {game.whitePlayer} <span className="text-muted">vs</span>{" "}
            {game.blackPlayer}
          </h1>
          <p>
            {game.playedAt?.slice(0, 10) ?? "未知日期"} ·{" "}
            {game.userColor === "white" ? "执白" : "执黑"} ·{" "}
            {game.openingName ?? "未知开局"}
          </p>
        </div>
        <button
          className="border-control-edge bg-secondary text-secondary-ink"
          disabled={reviewBusy}
          onClick={() => void completeOrNextGame()}
        >
          {game.reviewStatus ? "下一盘" : "标记复盘完成"}
        </button>
      </div>
      <div className="mb-2 h-7 shrink-0" role="status" aria-live="polite">
        {message && (
          <div className="h-full overflow-auto rounded-md border border-notice-edge bg-notice px-3 py-1 text-xs text-notice-ink">
            {message}
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-analysis gap-4">
        <section className="grid min-h-0 min-w-0 grid-rows-analysis gap-3">
          <div className="relative min-h-0 min-w-0 container-size">
            <div className="mx-auto w-analysis-board">
              <div className="w-full overflow-hidden rounded-lg border-8 border-board-frame shadow-board">
                <Chessboard
                  options={{
                    position: fen,
                    boardOrientation: flipped ? "black" : "white",
                    allowDragging: true,
                    dragActivationDistance: 5,
                    canDragPiece: ({ piece }) =>
                      piece.pieceType[0] === fen.split(" ")[1],
                    onPieceDrag: () => setSelectedSquare(null),
                    onPieceDrop: ({ sourceSquare, targetSquare }) =>
                      targetSquare
                        ? playMove(sourceSquare, targetSquare)
                        : false,
                    onSquareClick: ({ square }) => clickSquare(square),
                    squareStyles: selected
                      ? {
                          [selected]: {
                            backgroundColor: "var(--color-board-selected)",
                          },
                        }
                      : {},
                    squareRenderer: ({ square, children }) => (
                      <div
                        className={`relative h-full w-full ${selected === square ? "bg-board-selected" : ""}`}
                        title={
                          square === markedSquare && badge
                            ? `${badge.label} · ${quality?.category}`
                            : undefined
                        }
                      >
                        {children}
                        {square === markedSquare && badge && (
                          <span
                            className={` pointer-events-none absolute right-0.5 top-0.5 z-10 flex size-move-badge items-center justify-center rounded-full text-move-badge font-extrabold leading-none shadow-md ring-1 ring-black/20 ${badge.color}`}
                            aria-label={`${badge.label}：${currentMove?.san}`}
                            data-square={square}
                            data-category={quality?.category}
                          >
                            {badge.symbol}
                          </span>
                        )}
                      </div>
                    ),
                    boardStyle: { borderRadius: 4 },
                    darkSquareStyle: {
                      backgroundColor: "var(--color-board-dark)",
                    },
                    lightSquareStyle: {
                      backgroundColor: "var(--color-board-light)",
                    },
                  }}
                />
              </div>
              {promotion?.fen === fen && (
                <div
                  className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 bg-panel p-3"
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
                      onClick={() =>
                        playMove(promotion.from, promotion.to, piece)
                      }
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
              <div className="flex items-center justify-center gap-1 rounded-b-nav border border-panel-edge bg-panel px-2 py-1.5 [&_span]:min-w-12 [&_span]:text-center [&_span]:text-body-sm [&_span]:text-coordinate">
                <button
                  className="border-none border-current bg-transparent p-1 text-fen [&_svg]:size-4"
                  onClick={() => navigate("start")}
                  aria-label="回到开局"
                >
                  <ChevronsLeft />
                </button>
                <button
                  className="border-none border-current bg-transparent p-1 text-fen [&_svg]:size-4"
                  onClick={() => navigate("back")}
                  aria-label="上一步"
                >
                  <ChevronLeft />
                </button>
                <span>
                  {inBranch ? "分支 · " : ""}
                  {ply} / {lineLength}
                </span>
                <button
                  className="border-none border-current bg-transparent p-1 text-fen [&_svg]:size-4"
                  onClick={() => navigate("next")}
                  aria-label="下一步"
                >
                  <ChevronRight />
                </button>
                <button
                  className="border-none border-current bg-transparent p-1 text-fen [&_svg]:size-4"
                  onClick={() => navigate("end")}
                  aria-label="跳到终局"
                >
                  <ChevronsRight />
                </button>
                <button
                  className="border-none border-current bg-transparent p-1 text-fen [&_svg]:size-4"
                  onClick={() => setFlipped((v) => !v)}
                  aria-label="翻转棋盘"
                >
                  <RotateCcw />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                {quality?.status && (
                  <span
                    role="status"
                    className="min-w-0 truncate text-caption text-muted"
                    title={quality.status}
                  >
                    {quality.status}
                  </span>
                )}
                <button
                  className="border-control-edge bg-secondary text-secondary-ink min-w-22.5 shrink-0 px-2 py-1.5 text-caption"
                  onClick={() => void copyFen()}
                  aria-label="复制当前局面 FEN"
                >
                  {copiedFen === fen ? <Check size={14} /> : <Copy size={14} />}
                  <span aria-live="polite">
                    {copiedFen === fen ? "已复制" : "复制 FEN"}
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div className="min-h-0">
            <NotePanel
              key={noteKey}
              gameId={game.id}
              moveId={currentMove?.sourceMoveId ?? null}
              temporary={inBranch}
              heading={
                currentMove
                  ? `${moveNumber(currentMove)} ${currentMove.san} · ${inBranch ? "分支笔记" : "招法笔记"}`
                  : "对局总结"
              }
              content={notes[noteKey] ?? ""}
              onSaved={(content) => {
                setNotes((n) => ({ ...n, [noteKey]: content }));
                setMessage(
                  inBranch ? "分支笔记已暂存于当前复盘" : "笔记已保存",
                );
              }}
              onError={setMessage}
            />
          </div>
        </section>
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <div
            className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-panel-edge bg-panel p-1"
            aria-label="复盘工具"
          >
            {(
              [
                ["position", "局面与招法"],
                ["batch", "整局分析"],
                ["puzzle", "创建题目"],
              ] as const
            ).map(([tool, label]) => (
              <button
                key={tool}
                aria-pressed={activeTool === tool}
                className={`border-0 px-2 py-2 text-xs ${activeTool === tool ? "bg-selected text-selected-ink" : "bg-transparent text-muted"}`}
                onClick={() =>
                  tool === "puzzle"
                    ? void openPuzzleForm()
                    : setActiveTool(tool)
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={
              activeTool === "position"
                ? "flex min-h-0 flex-1 flex-col gap-3"
                : "hidden"
            }
          >
            <div className="shrink-0 overflow-hidden rounded-xl border border-panel-edge bg-panel">
              <div className="section-title border-b border-panel-edge px-3 py-2.5 text-body-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
                Stockfish 分析{" "}
                <span>
                  {engineStatus && engine ? ` · ${engineStatus}` : ""}
                </span>
              </div>
              <div className="h-47 overflow-auto overscroll-contain p-1.5 text-body-sm">
                {engine && engine.fen === fen ? (
                  <ol
                    className="m-0 w-full list-none p-0 divide-y divide-control-edge"
                    aria-label="推荐招法"
                  >
                    {engine.variations.slice(0, 3).map((variation) => {
                      const sanLine = uciLineToSan(engine.fen, variation.pv);
                      const uci = variation.pv[0];
                      return (
                        <li key={variation.rank}>
                          <button
                            type="button"
                            className="block w-full rounded-md border border-transparent bg-transparent px-2 py-2 text-left whitespace-normal text-inherit font-inherit enabled:hover:border-candidate-edge enabled:hover:bg-candidate-hover enabled:hover:filter-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-2"
                            aria-label={`走推荐 ${variation.rank}：${sanLine[0] ?? "无可用招法"}`}
                            title={
                              sanLine[0]
                                ? `在棋盘上走 ${sanLine[0]}`
                                : undefined
                            }
                            disabled={!sanLine.length}
                            onClick={() =>
                              playMove(uci.slice(0, 2), uci.slice(2, 4), uci[4])
                            }
                          >
                            <div className="mb-1 flex items-center gap-3">
                              <div>
                                {variation.rank} · {sanLine[0] ?? "—"}
                              </div>
                              <strong className="tabular-nums text-accent-ink">
                                {variation.scoreType === "mate"
                                  ? `M${variation.scoreValue}`
                                  : (variation.scoreValue / 100).toFixed(2)}
                              </strong>
                              <span className="ml-auto text-caption text-engine-muted">
                                深度 {variation.depth}
                              </span>
                            </div>
                            <small
                              className="block truncate font-chess-mono text-caption font-normal text-engine-muted"
                              title={sanLine.join(" ")}
                            >
                              {sanLine.join(" ")}
                            </small>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <span className="block px-2 py-3 text-muted">
                    {engineStatus || "请在设置中配置 Stockfish 路径"}
                  </span>
                )}
              </div>
            </div>
            <MoveList
              tree={review}
              qualities={qualities}
              analysisStatus={preanalysis?.status}
              onRetry={
                preanalysis?.failed
                  ? () => setAnalysisRetry((value) => value + 1)
                  : undefined
              }
              onSelect={(moveId) =>
                changeReview(selectReviewMove(review, moveId))
              }
              onMainline={() => changeReview(returnToMainline(review))}
            />
          </div>
          <div
            className={
              activeTool === "batch"
                ? "  flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel"
                : "hidden"
            }
          >
            <div className="shrink-0 border-b border-panel-edge px-3 py-2.5 text-body-sm font-bold">
              整局失误分析
              {candidates.length > 0 && ` · ${candidates.length} 个候选`}
              {batchProgress && (
                <span className="ml-2 text-xs font-normal text-engine-muted">
                  {batchProgress}
                </span>
              )}
            </div>
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-candidate-ink [&_button]:px-2.25 [&_button]:py-1.5 [&_button]:text-xs">
              <button
                className="border-control-edge bg-secondary text-secondary-ink"
                onClick={() => void detectBlunders()}
              >
                分析整局失误
              </button>
              <button
                className="border-control-edge bg-secondary text-secondary-ink"
                onClick={() => {
                  batchCancelled.current = true;
                  void api.engineStop();
                }}
              >
                停止
              </button>
              <span>{batchProgress}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              {!candidates.length && (
                <p className="px-4 text-body-sm text-muted">
                  分析己方招法，确认失误后可直接加入题库。
                </p>
              )}
              {candidates.map((c) => (
                <div
                  className="candidate flex flex-wrap items-center justify-between gap-2 border-t border-panel-edge px-4 py-3 text-xs text-candidate-ink [&_button]:px-2.25 [&_button]:py-1.5 [&_button]:text-xs"
                  key={c.move.id}
                >
                  <span>
                    {c.category} · {Math.ceil(c.move.ply / 2)}
                    {c.move.ply % 2 ? "．" : "…"} {c.move.san} · 胜率损失{" "}
                    {(c.loss * 100).toFixed(0)}%
                  </span>
                  <button onClick={() => void confirmCandidate(c)}>
                    确认入题
                  </button>
                </div>
              ))}
            </div>
          </div>
          {showPuzzle && (
            <div
              className={`${activeTool === "puzzle" ? "flex" : "hidden"} min-h-0 flex-1 flex-col   overflow-hidden rounded-xl border border-panel-edge bg-panel [&_textarea]:mx-3 [&_textarea]:my-1.5 [&_textarea]:w-editor-field [&_textarea]:resize-none [&_input]:mx-3 [&_input]:my-1.5 [&_input]:w-editor-field [&_input]:py-2 [&_input]:text-body-sm [&_textarea]:py-2 [&_textarea]:text-body-sm [&_p]:mx-3 [&_p]:my-2 [&_p]:text-xs [&_p]:text-help`}
            >
              <div className="section-title shrink-0 border-b border-panel-edge px-3 py-2.5 text-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
                创建训练题目
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                <p>
                  出题起点由
                  {puzzleOrigin?.fen.split(" ")[1] === "w" ? "白方" : "黑方"}
                  走棋。在棋盘上走棋会自动填入后续招法，退回或改走时同步更新；也可手动填写。
                </p>
                <div className="mx-3 mb-2 grid gap-2">
                  <div className="grid gap-1">
                    <span className="text-body-sm text-engine-muted">
                      题目分类
                    </span>
                    <Select<PuzzleCategory>
                      label="题目分类"
                      value={puzzleCategory}
                      options={PUZZLE_CATEGORIES}
                      onValueChange={(category) =>
                        void changePuzzleCategory(category)
                      }
                    />
                  </div>
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="题目标题"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="题目说明"
                  rows={2}
                />
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="后续招法"
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  placeholder="连续走法，如 e4 e5 Nf3 或 e2e4 e7e5 g1f3"
                />
              </div>
              <div className="flex shrink-0 justify-end gap-2.25 border-t border-panel-edge px-4 py-3">
                <button onClick={() => void createPuzzle()}>保存题目</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
