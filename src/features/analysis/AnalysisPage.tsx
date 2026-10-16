import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
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
import MoveList from "./MoveList";
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
  const [game, setGame] = useState<Game | null>(null);
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
  const [title, setTitle] = useState("");
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [puzzleCategory, setPuzzleCategory] =
    useState<PuzzleCategory>("opening");
  const titleRequest = useRef(0);
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState("");
  const [multiMove, setMultiMove] = useState(false);
  const [positionAnalysis, setPositionAnalysis] =
    useState<PositionAnalysis | null>(null);
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
        setReview(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [review]);
  const currentMove = currentReviewMove(review);
  const ply = currentMove?.ply ?? 0;
  const fen = currentMove?.fenAfter ?? review.initialFen;
  const engine =
    positionAnalysis?.fen === fen ? positionAnalysis.analysis : null;
  const engineStatus =
    positionAnalysis?.fen === fen ? positionAnalysis.status : "分析中…";
  const inBranch = !!currentMove && currentMove.sourceMoveId === null;
  const lineLength = reviewLineEnd(review)?.ply ?? 0;
  const selected = selectedSquare?.fen === fen ? selectedSquare.square : null;
  const noteKey = currentMove?.id ?? "summary";
  function changeReview(next: ReviewTree) {
    playReviewSound(review, next);
    setSelectedSquare(null);
    setPromotion(null);
    setReview(next);
  }
  function navigate(direction: "start" | "back" | "next" | "end") {
    changeReview(navigateReview(review, direction));
  }
  useEffect(() => startPositionAnalysis(fen, setPositionAnalysis), [fen]);
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
    if (selected && selected !== square && playMove(selected, square)) return;
    const chess = new Chess(fen);
    const piece = chess.get(square as Square);
    setSelectedSquare(
      piece?.color === chess.turn() && selected !== square
        ? { fen, square }
        : null,
    );
  }
  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fen);
      setCopiedFen(fen);
    } catch {
      setMessage("复制 FEN 失败，请重试");
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
  async function togglePuzzleForm() {
    if (showPuzzle) {
      titleRequest.current++;
      setShowPuzzle(false);
      return;
    }
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
    } catch (error) {
      if (request === titleRequest.current) setMessage(String(error));
    }
  }
  async function createPuzzle() {
    if (!game) return;
    let parsed: ReturnType<typeof parsePuzzleAnswers>;
    try {
      parsed = parsePuzzleAnswers(fen, answers, multiMove);
    } catch (error) {
      setMessage(String(error));
      return;
    }
    const puzzle: Puzzle = {
      id: crypto.randomUUID(),
      sourceType: "manual",
      category: puzzleCategory,
      sourceGameId: game.id,
      sourceMoveId: currentMove?.sourceMoveId ?? null,
      fen,
      sideToMove: fen.split(" ")[1] === "w" ? "white" : "black",
      title: title.trim() === generatedTitle ? "" : title.trim(),
      description,
      originalMove: null,
      ...parsed,
      errorCategory: null,
    };
    try {
      const savedTitle = await api.savePuzzle(puzzle);
      setShowPuzzle(false);
      setAnswers("");
      setMessage(`题目「${savedTitle}」已加入题库`);
    } catch (e) {
      setMessage(String(e));
    }
  }
  if (!id)
    return (
      <div className="empty full px-5 py-[60px] text-center text-[#829591] grid min-h-[280px] place-items-center">
        请从「对局」列表选择一局开始复盘。
      </div>
    );
  if (!game)
    return (
      <div className="empty full px-5 py-[60px] text-center text-[#829591] grid min-h-[280px] place-items-center">
        {message || "加载对局…"}
      </div>
    );
  return (
    <>
      <div className="page-head compact mb-3 flex items-center justify-between gap-3 [&_h1]:my-1 [&_h1]:text-[24px] [&>button]:shrink-0 [&>button]:px-3 [&>button]:py-2 [&>button]:text-[12px] [&_p]:m-0 [&_p]:text-[14px] [&_p]:text-[#8d9e9b]">
        <div>
          <div className="eyebrow text-[10px] font-[750] tracking-[0.2em] text-[#81ad94]">
            GAME REVIEW
          </div>
          <h1>
            {game.whitePlayer} <span className="muted text-muted">vs</span>{" "}
            {game.blackPlayer}
          </h1>
          <p>
            {game.playedAt?.slice(0, 10) ?? "未知日期"} ·{" "}
            {game.userColor === "white" ? "执白" : "执黑"} ·{" "}
            {game.openingName ?? "未知开局"}
          </p>
        </div>
        <button
          className="secondary border-control-edge bg-secondary text-secondary-ink"
          onClick={async () => {
            await api.setReviewed(game.id, !game.reviewStatus);
            setGame({ ...game, reviewStatus: !game.reviewStatus });
          }}
        >
          {game.reviewStatus ? "取消完成" : "标记复盘完成"}
        </button>
      </div>
      {message && (
        <div className="notice mb-3 rounded-lg border border-[#456457] bg-[#22392e] px-[15px] py-3 text-[13px] text-[#cce9d4]">
          {message}
        </div>
      )}
      <div className="analysis-layout grid grid-cols-[minmax(0,1.15fr)_minmax(300px,1fr)] items-start gap-4 max-[760px]:grid-cols-1">
        <section className="board-col min-w-0 w-full max-w-[min(590px,calc(100dvh-210px))] justify-self-center min-[760px]:sticky min-[760px]:top-0 max-[760px]:max-w-[min(100%,max(240px,calc(100dvh-490px)))]">
          <div className="board-frame w-full overflow-hidden rounded-lg border-8 border-[#223033] shadow-[0_16px_35px_#0004]">
            <Chessboard
              options={{
                position: fen,
                boardOrientation: flipped ? "black" : "white",
                allowDragging: true,
                canDragPiece: ({ piece }) =>
                  piece.pieceType[0] === fen.split(" ")[1],
                onPieceDrop: ({ sourceSquare, targetSquare }) =>
                  targetSquare ? playMove(sourceSquare, targetSquare) : false,
                onSquareClick: ({ square }) => clickSquare(square),
                squareStyles: selected
                  ? {
                      [selected]: {
                        backgroundColor: "var(--color-board-selected)",
                      },
                    }
                  : {},
                boardStyle: { borderRadius: 4 },
                darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
                lightSquareStyle: {
                  backgroundColor: "var(--color-board-light)",
                },
              }}
            />
          </div>
          {promotion?.fen === fen && (
            <div
              className="promotion-picker flex flex-wrap items-center gap-2 bg-panel p-3"
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
                  onClick={() => playMove(promotion.from, promotion.to, piece)}
                >
                  {label}
                </button>
              ))}
              <button
                className="secondary border-control-edge bg-secondary text-secondary-ink"
                onClick={() => setPromotion(null)}
              >
                取消
              </button>
            </div>
          )}
          <div className="board-controls flex items-center justify-center gap-2.5 rounded-b-[9px] border border-panel-edge bg-panel px-2 py-1.5 [&_span]:min-w-[60px] [&_span]:text-center [&_span]:text-[13px] [&_span]:text-[#8da39a]">
            <button
              className="icon-button border-none border-current bg-transparent p-[7px] text-[#b7c9c1] [&_svg]:size-5"
              onClick={() => navigate("start")}
              aria-label="回到开局"
            >
              <ChevronsLeft />
            </button>
            <button
              className="icon-button border-none border-current bg-transparent p-[7px] text-[#b7c9c1] [&_svg]:size-5"
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
              className="icon-button border-none border-current bg-transparent p-[7px] text-[#b7c9c1] [&_svg]:size-5"
              onClick={() => navigate("next")}
              aria-label="下一步"
            >
              <ChevronRight />
            </button>
            <button
              className="icon-button border-none border-current bg-transparent p-[7px] text-[#b7c9c1] [&_svg]:size-5"
              onClick={() => navigate("end")}
              aria-label="跳到终局"
            >
              <ChevronsRight />
            </button>
            <button
              className="icon-button border-none border-current bg-transparent p-[7px] text-[#b7c9c1] [&_svg]:size-5"
              onClick={() => setFlipped((v) => !v)}
              aria-label="翻转棋盘"
            >
              <RotateCcw />
            </button>
          </div>
          <div className="fen-row mt-2 flex items-center gap-2.5">
            <div className="fen min-w-0 flex-1 font-chess-mono text-[11px] leading-[normal] text-[#657c77] [overflow-wrap:anywhere]">
              {fen}
            </div>
            <button
              className="secondary fen-copy border-control-edge bg-secondary text-secondary-ink min-w-[90px] shrink-0 px-2 py-1.5 text-[11px]"
              onClick={() => void copyFen()}
              aria-label="复制当前局面 FEN"
            >
              {copiedFen === fen ? <Check size={14} /> : <Copy size={14} />}
              <span aria-live="polite">
                {copiedFen === fen ? "已复制" : "复制 FEN"}
              </span>
            </button>
          </div>
        </section>
        <section className="review-col grid min-w-0 gap-3">
          <div className="panel engine-panel overflow-hidden rounded-xl border border-panel-edge bg-panel">
            <div className="section-title border-b border-panel-edge px-3 py-2.5 text-[13px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
              Stockfish 分析{" "}
              <span>{engineStatus && engine ? ` · ${engineStatus}` : ""}</span>
            </div>
            <div className="engine-content min-h-[188px] p-1.5 text-[13px]">
              {engine && engine.fen === fen ? (
                <ol
                  className="engine-variations m-0 w-full list-none p-0 divide-y divide-control-edge"
                  aria-label="推荐招法"
                >
                  {engine.variations.slice(0, 3).map((variation) => {
                    const sanLine = uciLineToSan(engine.fen, variation.pv);
                    const uci = variation.pv[0];
                    return (
                      <li key={variation.rank}>
                        <button
                          type="button"
                          className="engine-candidate block w-full rounded-md border border-transparent bg-transparent px-2 py-2 text-left whitespace-normal text-inherit [font:inherit] enabled:hover:border-[#3b5a4c] enabled:hover:bg-[#22352d] enabled:hover:filter-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-2"
                          aria-label={`走推荐 ${variation.rank}：${sanLine[0] ?? "无可用招法"}`}
                          title={
                            sanLine[0] ? `在棋盘上走 ${sanLine[0]}` : undefined
                          }
                          disabled={!sanLine.length}
                          onClick={() =>
                            playMove(uci.slice(0, 2), uci.slice(2, 4), uci[4])
                          }
                        >
                          <div className="engine-variation-head mb-1 flex items-center gap-3">
                            <div>
                              {variation.rank} · {sanLine[0] ?? "—"}
                            </div>
                            <strong className="ml-auto tabular-nums text-accent-ink">
                              {variation.scoreType === "mate"
                                ? `M${variation.scoreValue}`
                                : (variation.scoreValue / 100).toFixed(2)}
                            </strong>
                            <span className="text-[11px] text-engine-muted">
                              深度 {variation.depth}
                            </span>
                          </div>
                          <small
                            className="block truncate font-chess-mono text-[11px] font-normal text-engine-muted"
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
                <span className="muted block px-2 py-3 text-muted">
                  {engineStatus || "请在设置中配置 Stockfish 路径"}
                </span>
              )}
            </div>
          </div>
          <MoveList
            tree={review}
            onSelect={(moveId) =>
              changeReview(selectReviewMove(review, moveId))
            }
            onMainline={() => changeReview(returnToMainline(review))}
          />
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
              setMessage(inBranch ? "分支笔记已暂存于当前复盘" : "笔记已保存");
            }}
            onError={setMessage}
            onCreatePuzzle={() => void togglePuzzleForm()}
          />
          <details className="panel batch-panel overflow-hidden rounded-xl border border-panel-edge bg-panel">
            <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-bold marker:text-muted">
              整局失误分析
              {candidates.length > 0 && ` · ${candidates.length} 个候选`}
              {batchProgress && (
                <span className="ml-2 text-[12px] font-normal text-engine-muted">
                  {batchProgress}
                </span>
              )}
            </summary>
            <div className="batch-body flex flex-wrap items-center gap-2 px-4 py-3 text-[12px] text-[#9cac9f] [&_button]:px-[9px] [&_button]:py-1.5 [&_button]:text-[12px]">
              <button
                className="secondary border-control-edge bg-secondary text-secondary-ink"
                onClick={() => void detectBlunders()}
              >
                分析整局失误
              </button>
              <button
                className="secondary border-control-edge bg-secondary text-secondary-ink"
                onClick={() => {
                  batchCancelled.current = true;
                  void api.engineStop();
                }}
              >
                停止
              </button>
              <span>{batchProgress}</span>
            </div>
            {candidates.map((c) => (
              <div
                className="candidate flex flex-wrap items-center justify-between gap-2 border-t border-panel-edge px-4 py-3 text-[12px] text-[#9cac9f] [&_button]:px-[9px] [&_button]:py-1.5 [&_button]:text-[12px]"
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
          </details>
          {showPuzzle && (
            <div className="panel puzzle-form rounded-xl border border-panel-edge bg-panel [&_textarea]:m-[15px] [&_textarea]:w-[calc(100%_-_30px)] [&_input]:m-[15px] [&_input]:w-[calc(100%_-_30px)] [&_p]:px-4 [&_p]:text-[13px] [&_p]:text-[#94a7a0]">
              <div className="section-title border-b border-panel-edge px-[18px] py-4 text-[14px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
                创建训练题目
              </div>
              <p>
                当前局面由{fen.split(" ")[1] === "w" ? "白方" : "黑方"}
                走棋。
                {multiMove
                  ? "按顺序填写双方走法，用空格分隔，如 e4 e5 Nf3。"
                  : "答案可填 SAN 或 UCI，多个可选答案用逗号隔开。"}
              </p>
              <div className="mx-[15px] mb-3 grid gap-2">
                <span className="text-[13px] text-engine-muted">题目分类</span>
                <Select<PuzzleCategory>
                  label="题目分类"
                  value={puzzleCategory}
                  options={PUZZLE_CATEGORIES}
                  onValueChange={(category) =>
                    void changePuzzleCategory(category)
                  }
                />
              </div>
              <div className="mx-[15px] mb-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiMove}
                  className="secondary border-control-edge bg-secondary px-3 py-2 text-[12px] text-secondary-ink"
                  onClick={() => setMultiMove((value) => !value)}
                >
                  连续多步：{multiMove ? "开启" : "关闭"}
                </button>
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
                rows={3}
              />
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                placeholder={
                  multiMove
                    ? "连续走法，如 e4 e5 Nf3 或 e2e4 e7e5 g1f3"
                    : "正确走法，如 Nf3, d2d4"
                }
              />
              <div className="row-end flex justify-end gap-[9px] border-t border-panel-edge px-4 py-3">
                <button onClick={() => void createPuzzle()}>保存题目</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
