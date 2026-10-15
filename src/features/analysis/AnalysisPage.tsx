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
import { api, type EngineAnalysis } from "../../shared/api";
import type { Game, Puzzle } from "../../shared/types";
import { normalizeAnswer, uciLineToSan } from "../../shared/chess/moves";
import { playMoveSound, playSound } from "../../shared/audio/move-sound";
import { classifyMove, type Candidate } from "./blunders";
import NotePanel from "./NotePanel";
import MoveList from "./MoveList";
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
  const [title, setTitle] = useState("从当前局面找出好棋");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState("");
  const [engine, setEngine] = useState<EngineAnalysis | null>(null);
  const [engineStatus, setEngineStatus] = useState("");
  const requestId = useRef(0);
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
  useEffect(() => {
    let active = true;
    const seq = ++requestId.current;
    void api.engineStop().catch(() => {});
    api
      .getSetting("engine_path")
      .then((path) => {
        if (!active || !path) return;
        setEngineStatus("分析中…");
        return api
          .getSetting("engine_depth")
          .then((d) => api.engineAnalyze(path, fen, Number(d ?? 14)))
          .then((result) => {
            if (active && seq === requestId.current && result)
              setEngine(result);
            if (active) setEngineStatus("");
          });
      })
      .catch((e) => {
        if (active && seq === requestId.current) setEngineStatus(String(e));
      });
    return () => {
      active = false;
      void api.engineStop().catch(() => {});
    };
  }, [fen]);
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
      sourceGameId: game.id,
      sourceMoveId: c.move.id,
      fen: c.move.fenBefore,
      sideToMove: game.userColor ?? "white",
      title: `${c.category} · 第 ${Math.ceil(c.move.ply / 2)} 回合`,
      description: `原招法 ${c.move.san}，胜率损失约 ${(c.loss * 100).toFixed(0)}%。请重新选择。`,
      originalMove: c.move.uci,
      expectedMoves: [c.before.bestMove!],
      solutionLine: c.before.pv,
      errorCategory: c.category,
    };
    try {
      await api.savePuzzle(puzzle);
      setCandidates((v) => v.filter((x) => x.move.id !== c.move.id));
      setMessage("候选题已加入题库");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function createPuzzle() {
    if (!game) return;
    const raw = answers.split(/[,，\s]+/).filter(Boolean);
    const expected = raw.map((a) => normalizeAnswer(fen, a));
    if (!raw.length || expected.some((a) => !a)) {
      setMessage("请输入合法的 SAN 或 UCI 答案");
      return;
    }
    const puzzle: Puzzle = {
      id: crypto.randomUUID(),
      sourceType: "manual",
      sourceGameId: game.id,
      sourceMoveId: currentMove?.sourceMoveId ?? null,
      fen,
      sideToMove: fen.split(" ")[1] === "w" ? "white" : "black",
      title,
      description,
      originalMove: null,
      expectedMoves: expected as string[],
      solutionLine: [],
      errorCategory: null,
    };
    try {
      await api.savePuzzle(puzzle);
      setShowPuzzle(false);
      setAnswers("");
      setMessage("题目已加入题库");
    } catch (e) {
      setMessage(String(e));
    }
  }
  if (!id)
    return <div className="empty full">请从「对局」列表选择一局开始复盘。</div>;
  if (!game) return <div className="empty full">{message || "加载对局…"}</div>;
  return (
    <>
      <div className="page-head compact">
        <div>
          <div className="eyebrow">GAME REVIEW</div>
          <h1>
            {game.whitePlayer} <span className="muted">vs</span>{" "}
            {game.blackPlayer}
          </h1>
          <p>
            {game.playedAt?.slice(0, 10) ?? "未知日期"} ·{" "}
            {game.userColor === "white" ? "执白" : "执黑"} ·{" "}
            {game.openingName ?? "未知开局"}
          </p>
        </div>
        <button
          className="secondary"
          onClick={async () => {
            await api.setReviewed(game.id, !game.reviewStatus);
            setGame({ ...game, reviewStatus: !game.reviewStatus });
          }}
        >
          {game.reviewStatus ? "取消完成" : "标记复盘完成"}
        </button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="analysis-layout">
        <section className="board-col">
          <div className="board-frame">
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
                  ? { [selected]: { backgroundColor: "#b6a45f" } }
                  : {},
                boardStyle: { borderRadius: 4 },
                darkSquareStyle: { backgroundColor: "#65847d" },
                lightSquareStyle: { backgroundColor: "#e8dfca" },
              }}
            />
          </div>
          {promotion?.fen === fen && (
            <div
              className="promotion-picker"
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
              <button className="secondary" onClick={() => setPromotion(null)}>
                取消
              </button>
            </div>
          )}
          <div className="board-controls">
            <button
              className="icon-button"
              onClick={() => navigate("start")}
              aria-label="回到开局"
            >
              <ChevronsLeft />
            </button>
            <button
              className="icon-button"
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
              className="icon-button"
              onClick={() => navigate("next")}
              aria-label="下一步"
            >
              <ChevronRight />
            </button>
            <button
              className="icon-button"
              onClick={() => navigate("end")}
              aria-label="跳到终局"
            >
              <ChevronsRight />
            </button>
            <button
              className="icon-button"
              onClick={() => setFlipped((v) => !v)}
              aria-label="翻转棋盘"
            >
              <RotateCcw />
            </button>
          </div>
          <div className="board-hint">拖动棋子或点击起点、终点，可试走分支</div>
          <div className="fen-row">
            <div className="fen">{fen}</div>
            <button
              className="secondary fen-copy"
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
        <section className="review-col">
          <MoveList
            tree={review}
            onSelect={(moveId) =>
              changeReview(selectReviewMove(review, moveId))
            }
            onMainline={() => changeReview(returnToMainline(review))}
          />
          <div className="panel batch-panel">
            <div className="section-title">失误候选</div>
            <div className="batch-body">
              <button
                className="secondary"
                onClick={() => void detectBlunders()}
              >
                分析整局失误
              </button>
              <button
                className="secondary"
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
              <div className="candidate" key={c.move.id}>
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
          <div className="panel engine-panel">
            <div className="section-title">
              Stockfish 分析 <span>白方视角</span>
            </div>
            <div className="engine-content">
              {engine && engine.fen === fen ? (
                <ol className="engine-variations" aria-label="推荐招法">
                  {engine.variations.slice(0, 3).map((variation) => {
                    const sanLine = uciLineToSan(engine.fen, variation.pv);
                    return (
                      <li key={variation.rank}>
                        <div className="engine-variation-head">
                          <div>
                            推荐 {variation.rank} · {sanLine[0] ?? "—"}
                          </div>
                          <strong>
                            {variation.scoreType === "mate"
                              ? `M${variation.scoreValue}`
                              : (variation.scoreValue / 100).toFixed(2)}
                          </strong>
                          <span>深度 {variation.depth}</span>
                        </div>
                        <small>{sanLine.join(" ")}</small>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <span className="muted">
                  {engineStatus || "请在设置中配置 Stockfish 路径"}
                </span>
              )}
            </div>
          </div>
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
            onCreatePuzzle={() => setShowPuzzle((v) => !v)}
          />
          {showPuzzle && (
            <div className="panel puzzle-form">
              <div className="section-title">创建训练题目</div>
              <p>
                当前局面由{fen.split(" ")[1] === "w" ? "白方" : "黑方"}
                走棋。答案可填 SAN 或 UCI，多个答案用逗号隔开。
              </p>
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
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                placeholder="正确走法，如 Nf3, d2d4"
              />
              <div className="row-end">
                <button onClick={() => void createPuzzle()}>保存题目</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
