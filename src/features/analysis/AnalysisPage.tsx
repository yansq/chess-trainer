import { getEngineDepth } from "./engine-settings";
import {
  Box,
  Button,
  SegmentedControl,
  Switch,
  Text,
  Card,
  Flex,
  Grid,
  Heading,
  IconButton,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import {
  ArrowLeft,
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
import EvaluationBar from "./EvaluationBar";
import { positionEvaluation } from "./evaluation";
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
  deleteReviewBranch,
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

function cancelBatch(batch: { generation: number; requestId: string | null }) {
  batch.generation++;
  if (batch.requestId) {
    void api.engineStop(batch.requestId).catch(() => {});
    batch.requestId = null;
  }
}

export default function AnalysisPage() {
  const { id } = useParams();
  const navigateTo = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState(false);
  const deletePending = useRef(false);
  const reviewWrites = useRef(Promise.resolve());
  const reviewGeneration = useRef(0);
  function enqueueReviewWrite(write: () => Promise<void>) {
    const pending = reviewWrites.current.catch(() => {}).then(write);
    reviewWrites.current = pending;
    return pending;
  }
  const [engineEnabled, setEngineEnabled] = useState(true);
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
  const [branchSaveError, setBranchSaveError] = useState<{
    gameId: string;
    message: string;
  } | null>(null);
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
  const batch = useRef({ generation: 0, requestId: null as string | null });
  useEffect(() => {
    const current = batch.current;
    return () => cancelBatch(current);
  }, []);
  function changeEngineEnabled(enabled: boolean) {
    if (!enabled) {
      cancelBatch(batch.current);
      setBatchProgress("已取消");
    }
    setEngineEnabled(enabled);
  }
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batchProgress, setBatchProgress] = useState("");
  useEffect(() => {
    if (!copiedFen) return;
    const timer = window.setTimeout(() => setCopiedFen(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedFen]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    reviewGeneration.current++;
    Promise.all([
      api.getGame(id),
      api.getReviewVariations(id),
      api.getAnnotations(id),
    ])
      .then(([g, variations, rows]) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const [moveId, content] of rows)
          map[moveId ?? "summary"] = content;
        setReview(createReviewTree(g.moves, variations));
        setNotes(map);
        setFlipped(g.userColor === "black");
        setMessage("");
        setGame(g);
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        deletePending.current ||
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
  const currentPosition =
    positionAnalysis?.fen === fen ? positionAnalysis : null;
  const engine =
    currentPosition?.analysis ?? preanalysis?.positions[fen] ?? null;
  const evaluation = positionEvaluation(fen, engine);
  const engineStatus = currentPosition?.status ?? "分析中…";
  const lineLength = reviewLineEnd(review)?.ply ?? 0;
  const selected = selectedSquare?.fen === fen ? selectedSquare.square : null;
  const noteKey = currentMove?.id ?? "summary";
  const qualities = engineEnabled
    ? {
        ...preanalysis?.qualities,
        ...(moveQualities.gameId === game?.id ? moveQualities.values : {}),
      }
    : {};
  const moveQuality = currentMove ? qualities[currentMove.id] : null;
  const quality = moveQuality?.fen === fen ? moveQuality : null;
  const badge = quality?.category ? qualityBadges[quality.category] : null;
  const markedSquare = badge ? currentMove?.uci.slice(2, 4) : null;
  function changeReview(next: ReviewTree) {
    if (deletePending.current) return;
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
    if (engineEnabled && gameId)
      return startPositionAnalysis(fen, setPositionAnalysis);
  }, [fen, gameId, engineEnabled]);
  useEffect(() => {
    if (
      !engineEnabled ||
      !game ||
      !inBranch ||
      !currentMove ||
      !engine ||
      engineStatus
    )
      return;
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
  }, [game, inBranch, currentMove, engine, engineStatus, engineEnabled]);
  async function persistBranches(tree: ReviewTree) {
    if (!game) throw new Error("对局尚未加载");
    if (deletePending.current) return;
    try {
      await enqueueReviewWrite(() =>
        api.saveReviewVariations(
          game.id,
          tree.moves.filter((move) => move.sourceMoveId === null),
        ),
      );
      setBranchSaveError((error) => (error?.gameId === game.id ? null : error));
    } catch (error) {
      setBranchSaveError({ gameId: game.id, message: String(error) });
      throw error;
    }
  }
  async function deleteBranch(moveId: string) {
    if (!game || deletePending.current) return;
    const next = deleteReviewBranch(review, moveId);
    if (next === review) return;
    const generation = reviewGeneration.current;
    deletePending.current = true;
    setDeletingBranch(true);
    try {
      await enqueueReviewWrite(async () => {
        // Finish pending saves before deleting, so late writes cannot restore the branch.
        await api.saveReviewVariations(
          game.id,
          review.moves.filter((move) => move.sourceMoveId === null),
        );
        await api.deleteReviewVariation(game.id, moveId);
      });
      if (generation !== reviewGeneration.current) return;
      deletePending.current = false;
      changeReview(next);
      const remaining = new Set(next.moves.map((move) => move.id));
      setNotes((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(
            ([id]) => id === "summary" || remaining.has(id),
          ),
        ),
      );
      setBranchSaveError((error) => (error?.gameId === game.id ? null : error));
      setMessage("");
      if (puzzleOrigin?.moveId && !remaining.has(puzzleOrigin.moveId)) {
        setPuzzleOrigin(null);
        setActiveTool("position");
        setAnswers("");
      }
    } catch (error) {
      if (generation === reviewGeneration.current)
        setMessage(`删除分支失败：${error}`);
    } finally {
      deletePending.current = false;
      setDeletingBranch(false);
    }
  }
  function playMove(from: string, to: string, piece?: string): boolean {
    if (deletePending.current) return false;
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
    if (next.moves !== review.moves) {
      void persistBranches(next).catch(() => {});
    }
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
    if (!engineEnabled) return;
    if (!game?.userColor) {
      setMessage(
        "无法判断你的执棋颜色。请在设置中填写与棋谱一致的用户名后重新导入。",
      );
      return;
    }
    cancelBatch(batch.current);
    const generation = batch.current.generation;
    const cancelled = () => generation !== batch.current.generation;
    setCandidates([]);
    setBatchProgress("准备分析…");
    try {
      const [path, depth, inaccuracy, mistake, blunder] = await Promise.all([
        api.getSetting("engine_path"),
        getEngineDepth("preanalysis", api),
        api.getSetting("loss_inaccuracy"),
        api.getSetting("loss_mistake"),
        api.getSetting("loss_blunder"),
      ]);
      if (cancelled()) return;
      if (!path) {
        setMessage("请先在设置中配置 Stockfish");
        setBatchProgress("");
        return;
      }
      const thresholds = {
        inaccuracy: Number(inaccuracy ?? 0.12),
        mistake: Number(mistake ?? 0.25),
        blunder: Number(blunder ?? 0.4),
      };
      const analyze = async (position: string) => {
        const requestId = crypto.randomUUID();
        batch.current.requestId = requestId;
        try {
          return await api.engineAnalyze(path, position, depth, requestId);
        } finally {
          if (batch.current.requestId === requestId)
            batch.current.requestId = null;
        }
      };
      const found: Candidate[] = [];
      const own = game.moves.filter(
        (m) => (m.ply % 2 === 1 ? "white" : "black") === game.userColor,
      );
      for (let i = 0; i < own.length; i++) {
        if (cancelled()) return;
        setBatchProgress(`分析中 ${i + 1} / ${own.length}`);
        const before = await analyze(own[i].fenBefore);
        if (cancelled()) return;
        const after = await analyze(own[i].fenAfter);
        if (cancelled()) return;
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
      }
      if (!cancelled())
        setBatchProgress(`分析完成，发现 ${found.length} 个候选`);
    } catch (error) {
      if (!cancelled()) {
        setMessage(`批量分析中断：${error}`);
        setBatchProgress("分析中断");
      }
    }
  }
  async function confirmCandidate(c: Candidate) {
    if (!engineEnabled || !game) return;
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
    if (puzzleOrigin) {
      setActiveTool("puzzle");
      return;
    }
    setPuzzleOrigin({
      moveId: review.currentId,
      sourceMoveId: currentMove?.sourceMoveId ?? null,
      fen,
    });
    setAnswers("");
    setDescription(currentMove ? (notes[noteKey] ?? "") : "");
    setTitle("");
    setGeneratedTitle("");
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
      setPuzzleOrigin(null);
      setActiveTool("position");
      setAnswers("");
      setMessage(`题目「${savedTitle}」已加入题库`);
    } catch (e) {
      setMessage(String(e));
    }
  }
  if (!id)
    return (
      <Grid
        px="5"
        className="py-15 text-center text-empty min-h-70 place-items-center"
      >
        请从「对局」列表选择一局开始复盘。
      </Grid>
    );
  if (!game || game.id !== id)
    return (
      <Grid
        px="5"
        className="py-15 text-center text-empty min-h-70 place-items-center"
      >
        {message || "加载对局…"}
      </Grid>
    );
  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        align="center"
        justify="between"
        mb="3"
        gap="3"
        className="shrink-0 [&_h1]:truncate [&_p]:truncate [&_h1]:my-1 [&_h1]:text-2xl [&_p]:m-0 [&_p]:text-sm [&_p]:text-description"
      >
        <Box className="min-w-0">
          <Box className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            GAME REVIEW
          </Box>
          <Heading as="h1" size="5">
            {game.whitePlayer} <span className="text-muted">vs</span>{" "}
            {game.blackPlayer}
          </Heading>
          <p>
            {game.playedAt?.slice(0, 10) ?? "未知日期"} ·{" "}
            {game.userColor === "white" ? "执白" : "执黑"} ·{" "}
            {game.openingName ?? "未知开局"}
          </p>
        </Box>
        <Flex align="center" gap="3" className="shrink-0">
          <Button size="1" variant="soft" onClick={() => navigateTo("/games")}>
            <ArrowLeft size={14} />
            返回对局列表
          </Button>
          <Button
            size="1"
            variant="soft"
            disabled={reviewBusy}
            onClick={() => void completeOrNextGame()}
          >
            {game.reviewStatus ? "下一盘" : "标记复盘完成"}
          </Button>{" "}
        </Flex>
      </Flex>
      {branchSaveError?.gameId === game.id && (
        <Flex align="center" gap="2" mb="2" className="shrink-0" role="alert">
          <Text size="2" color="red">
            分支保存失败：{branchSaveError.message}
          </Text>
          <Button
            size="1"
            variant="soft"
            onClick={() => void persistBranches(review).catch(() => {})}
          >
            重试保存分支
          </Button>
        </Flex>
      )}
      <Box className="mb-2 h-7 shrink-0" role="status" aria-live="polite">
        {(message || quality?.status) && (
          <Box className="h-full overflow-auto rounded-md border border-notice-edge bg-notice px-3 py-1 text-xs text-notice-ink">
            {message || quality?.status}
          </Box>
        )}
      </Box>
      <Grid gap="4" className="min-h-0 flex-1 grid-cols-analysis">
        <section className="grid min-h-0 min-w-0 grid-rows-analysis gap-3">
          <Box className="relative min-h-0 min-w-0 container-size">
            <Box
              className={`mx-auto ${engineEnabled ? "w-analysis-board-evaluation" : "w-analysis-board"}`}
            >
              <Flex align="stretch" gap="2">
                {engineEnabled && (
                  <EvaluationBar
                    fen={fen}
                    analysis={engine}
                    flipped={flipped}
                  />
                )}
                <Box className="min-w-0 flex-1 overflow-hidden rounded-lg border-8 border-board-frame shadow-board">
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
                        <Box
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
                        </Box>
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
                </Box>
              </Flex>
              {promotion?.fen === fen && (
                <Flex
                  wrap="wrap"
                  align="center"
                  gap="2"
                  p="3"
                  className="absolute inset-x-0 bottom-0 z-10 bg-panel"
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
                      onClick={() =>
                        playMove(promotion.from, promotion.to, piece)
                      }
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
              <Flex
                align="center"
                justify="center"
                gap="1"
                px="2"
                className="rounded-b-nav border border-panel-edge bg-panel py-1.5 [&_span]:min-w-12 [&_span]:text-center [&_span]:text-body-sm [&_span]:text-coordinate"
              >
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => navigate("start")}
                  aria-label="回到开局"
                >
                  <ChevronsLeft />
                </IconButton>
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => navigate("back")}
                  aria-label="上一步"
                >
                  <ChevronLeft />
                </IconButton>
                <span>
                  {inBranch ? "分支 · " : ""}
                  {ply} / {lineLength}
                </span>
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => navigate("next")}
                  aria-label="下一步"
                >
                  <ChevronRight />
                </IconButton>
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => navigate("end")}
                  aria-label="跳到终局"
                >
                  <ChevronsRight />
                </IconButton>
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => setFlipped((v) => !v)}
                  aria-label="翻转棋盘"
                >
                  <RotateCcw />
                </IconButton>
                <IconButton
                  size="1"
                  variant="ghost"
                  className="[&_svg]:size-4"
                  onClick={() => void copyFen()}
                  aria-label="复制当前局面 FEN"
                  title={copiedFen === fen ? "已复制 FEN" : "复制 FEN"}
                >
                  {copiedFen === fen ? <Check /> : <Copy />}
                </IconButton>
              </Flex>
            </Box>
          </Box>
          <Box className="min-h-0">
            <NotePanel
              key={noteKey}
              disabled={deletingBranch}
              onSave={(content) =>
                enqueueReviewWrite(async () => {
                  if (inBranch)
                    await api.saveReviewVariations(
                      game.id,
                      review.moves.filter((move) => move.sourceMoveId === null),
                    );
                  await api.saveAnnotation(
                    game.id,
                    currentMove?.id ?? null,
                    content,
                  );
                })
              }
              heading={
                currentMove
                  ? `${moveNumber(currentMove)} ${currentMove.san} · ${inBranch ? "分支笔记" : "招法笔记"}`
                  : "对局总结"
              }
              content={notes[noteKey] ?? ""}
              onSaved={(content) => {
                setNotes((n) => ({ ...n, [noteKey]: content }));
                setMessage("");
              }}
              onError={setMessage}
            />
          </Box>
        </section>
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <SegmentedControl.Root
            value={activeTool}
            onValueChange={(tool) =>
              tool === "puzzle"
                ? void openPuzzleForm()
                : setActiveTool(tool as "position" | "batch")
            }
            aria-label="复盘工具"
            className="shrink-0"
          >
            <SegmentedControl.Item value="position">
              局面与招法
            </SegmentedControl.Item>
            <SegmentedControl.Item value="batch">
              整局分析
            </SegmentedControl.Item>
            <SegmentedControl.Item value="puzzle">
              创建题目
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          <Flex
            direction="column"
            gap="3"
            className={activeTool === "position" ? "min-h-0 flex-1" : "hidden"}
          >
            <Card className="shrink-0 overflow-hidden p-0">
              <Flex
                align="center"
                gap="2"
                px="3"
                py="2"
                className="border-b border-panel-edge text-body-sm font-bold"
              >
                <span className="shrink-0">Stockfish 分析</span>
                <Switch
                  size="1"
                  aria-label="启用引擎分析"
                  checked={engineEnabled}
                  onCheckedChange={changeEngineEnabled}
                />
                {engineEnabled && (
                  <span
                    className="shrink-0 tabular-nums text-accent-ink"
                    aria-label="当前局面评分"
                    title={evaluation?.description ?? "当前局面暂无引擎评分"}
                  >
                    {evaluation?.label ?? "—"}
                  </span>
                )}
                {engineEnabled && engineStatus && engine && (
                  <span className="min-w-0 truncate text-xs font-normal text-engine-muted">
                    {engineStatus}
                  </span>
                )}
              </Flex>
              {engineEnabled && (
                <Box
                  p="2"
                  className="h-47 overflow-auto overscroll-contain text-body-sm"
                >
                  {engine && engine.fen === fen ? (
                    <ol
                      className="m-0 w-full list-none divide-y divide-control-edge p-0"
                      aria-label="推荐招法"
                    >
                      {engine.variations.slice(0, 3).map((variation) => {
                        const sanLine = uciLineToSan(engine.fen, variation.pv);
                        const uci = variation.pv[0];
                        return (
                          <li key={variation.rank}>
                            <Button
                              size="1"
                              variant="ghost"
                              className="m-0 box-border h-auto w-full min-w-0 flex-col items-stretch gap-1 p-2 text-left whitespace-normal"
                              aria-label={`走推荐 ${variation.rank}：${sanLine[0] ?? "无可用招法"}`}
                              title={
                                sanLine[0]
                                  ? `在棋盘上走 ${sanLine[0]}`
                                  : undefined
                              }
                              disabled={!sanLine.length}
                              onClick={() =>
                                playMove(
                                  uci.slice(0, 2),
                                  uci.slice(2, 4),
                                  uci[4],
                                )
                              }
                            >
                              <Flex align="center" gap="3" className="min-w-0">
                                <Box>
                                  {variation.rank} · {sanLine[0] ?? "—"}
                                </Box>
                                <strong className="tabular-nums text-accent-ink">
                                  {variation.scoreType === "mate"
                                    ? `M${variation.scoreValue}`
                                    : (variation.scoreValue / 100).toFixed(2)}
                                </strong>
                                <span className="ml-auto shrink-0 text-caption text-engine-muted">
                                  深度 {variation.depth}
                                </span>
                              </Flex>
                              <small
                                className="block truncate font-chess-mono text-caption font-normal text-engine-muted"
                                title={sanLine.join(" ")}
                              >
                                {sanLine.join(" ")}
                              </small>
                            </Button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <span className="block px-2 py-3 text-muted">
                      {engineStatus || "请在设置中配置 Stockfish 路径"}
                    </span>
                  )}
                </Box>
              )}
            </Card>
            <MoveList
              tree={review}
              qualities={qualities}
              notes={notes}
              deleting={deletingBranch}
              onDelete={(moveId) => void deleteBranch(moveId)}
              analysisStatus={
                deletingBranch
                  ? "正在删除分支…"
                  : engineEnabled
                    ? preanalysis?.status
                    : undefined
              }
              onRetry={
                engineEnabled && preanalysis?.failed
                  ? () => setAnalysisRetry((value) => value + 1)
                  : undefined
              }
              onSelect={(moveId) =>
                changeReview(selectReviewMove(review, moveId))
              }
              onMainline={() => changeReview(returnToMainline(review))}
            />
          </Flex>
          <Card
            className={
              activeTool === "batch"
                ? "flex min-h-0 flex-1 flex-col overflow-hidden p-0"
                : "hidden"
            }
          >
            {!engineEnabled ? (
              <Text size="2" color="gray" as="p" m="4">
                引擎已关闭，开启后可分析整局。
              </Text>
            ) : (
              <>
                <Box
                  px="3"
                  py="2"
                  className="shrink-0 border-b border-panel-edge text-body-sm font-bold"
                >
                  整局失误分析{" "}
                  {candidates.length > 0 && ` · ${candidates.length} 个候选`}
                  {batchProgress && (
                    <span className="ml-2 text-xs font-normal text-engine-muted">
                      {batchProgress}
                    </span>
                  )}
                </Box>
                <Flex
                  wrap="wrap"
                  align="center"
                  gap="2"
                  px="4"
                  py="3"
                  className="shrink-0 text-xs text-candidate-ink"
                >
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => void detectBlunders()}
                  >
                    分析整局失误
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => {
                      cancelBatch(batch.current);
                      setBatchProgress("已取消");
                    }}
                  >
                    停止
                  </Button>
                  <span>{batchProgress}</span>
                </Flex>
                <Box className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  {!candidates.length && (
                    <p className="px-4 text-body-sm text-muted">
                      分析己方招法，确认失误后可直接加入题库。
                    </p>
                  )}
                  {candidates.map((c) => (
                    <Flex
                      wrap="wrap"
                      align="center"
                      justify="between"
                      gap="2"
                      px="4"
                      py="3"
                      key={c.move.id}
                      className="border-t border-panel-edge text-xs text-candidate-ink"
                    >
                      <span>
                        {c.category} · {Math.ceil(c.move.ply / 2)}
                        {c.move.ply % 2 ? "．" : "…"} {c.move.san} · 胜率损失{" "}
                        {(c.loss * 100).toFixed(0)}%
                      </span>
                      <Button size="1" onClick={() => void confirmCandidate(c)}>
                        确认入题
                      </Button>
                    </Flex>
                  ))}
                </Box>
              </>
            )}
          </Card>
          {puzzleOrigin && (
            <Card
              className={
                activeTool === "puzzle"
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden p-0"
                  : "hidden"
              }
            >
              <Box
                px="3"
                py="2"
                className="shrink-0 border-b border-panel-edge text-sm font-bold"
              >
                创建训练题目
              </Box>
              <Flex
                direction="column"
                gap="3"
                p="3"
                className="min-h-0 flex-1 overflow-auto overscroll-contain"
              >
                <p className="m-0 text-xs text-help">
                  出题起点由
                  {puzzleOrigin?.fen.split(" ")[1] === "w" ? "白方" : "黑方"}
                  走棋。在棋盘上走棋会自动填入后续招法，退回或改走时同步更新；也可手动填写。
                </p>
                <Grid gap="1">
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
                </Grid>

                <TextField.Root
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="题目标题"
                />
                <TextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="题目说明"
                  rows={2}
                />
                <TextField.Root
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="后续招法"
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  placeholder="连续走法，如 e4 e5 Nf3 或 e2e4 e7e5 g1f3"
                />
              </Flex>
              <Flex
                justify="end"
                px="4"
                py="3"
                className="shrink-0 gap-2.25 border-t border-panel-edge"
              >
                <Button
                  size="1"
                  variant="solid"
                  onClick={() => void createPuzzle()}
                >
                  保存题目
                </Button>
              </Flex>
            </Card>
          )}
        </section>
      </Grid>
    </Flex>
  );
}
