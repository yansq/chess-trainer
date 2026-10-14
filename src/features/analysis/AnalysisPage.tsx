import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
} from "lucide-react";
import { api, type EngineAnalysis } from "../../shared/api";
import type { Game, Puzzle } from "../../shared/types";
import { normalizeAnswer } from "../../shared/chess/moves";
import { classifyMove, type Candidate } from "./blunders";
import NotePanel from "./NotePanel";
export default function AnalysisPage() {
  const { id } = useParams();
  const [game, setGame] = useState<Game | null>(null);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
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
    if (!id) return;
    api
      .getGame(id)
      .then((g) => {
        setGame(g);
        setPly(0);
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
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight")
        setPly((p) => Math.min(game?.moves.length ?? 0, p + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [game]);
  const currentMove = ply ? game?.moves[ply - 1] : null;
  const fen =
    ply === 0
      ? (game?.moves[0]?.fenBefore ?? new Chess().fen())
      : (currentMove?.fenAfter ?? new Chess().fen());
  const noteKey = currentMove?.id ?? "summary";
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
      sourceMoveId: currentMove?.id ?? null,
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
                allowDragging: false,
                boardStyle: { borderRadius: 4 },
                darkSquareStyle: { backgroundColor: "#65847d" },
                lightSquareStyle: { backgroundColor: "#e8dfca" },
              }}
            />
          </div>
          <div className="board-controls">
            <button
              className="icon-button"
              onClick={() => setPly(0)}
              aria-label="回到开局"
            >
              <ChevronsLeft />
            </button>
            <button
              className="icon-button"
              onClick={() => setPly(Math.max(0, ply - 1))}
              aria-label="上一步"
            >
              <ChevronLeft />
            </button>
            <span>
              {ply} / {game.moves.length}
            </span>
            <button
              className="icon-button"
              onClick={() => setPly(Math.min(game.moves.length, ply + 1))}
              aria-label="下一步"
            >
              <ChevronRight />
            </button>
            <button
              className="icon-button"
              onClick={() => setPly(game.moves.length)}
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
          <div className="fen">{fen}</div>
        </section>
        <section className="review-col">
          <div className="panel moves-panel">
            <div className="section-title">
              招法 <span>主线</span>
            </div>
            <div className="moves-grid">
              <button
                className={ply === 0 ? "selected" : ""}
                onClick={() => setPly(0)}
              >
                初始局面
              </button>
              {game.moves.map((m) => (
                <button
                  key={m.id}
                  className={ply === m.ply ? "selected" : ""}
                  onClick={() => setPly(m.ply)}
                >
                  <small>
                    {Math.ceil(m.ply / 2)}
                    {m.ply % 2 ? "．" : "…"}
                  </small>
                  {m.san}
                </button>
              ))}
            </div>
          </div>
          <div className="panel batch-panel">
            <div className="section-title">
              失误候选
            </div>
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
                <>
                  <strong>
                    {engine.scoreType === "mate"
                      ? `M${engine.scoreValue}`
                      : `${(engine.scoreValue / 100).toFixed(2)}`}
                  </strong>
                  <span>深度 {engine.depth}</span>
                  <div>推荐 {engine.bestMove ?? "—"}</div>
                  <small>{engine.pv.join(" ")}</small>
                </>
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
            moveId={currentMove?.id ?? null}
            heading={
              currentMove
                ? `${Math.ceil(ply / 2)}${ply % 2 ? "．" : "…"} ${currentMove.san} · 招法笔记`
                : "对局总结"
            }
            content={notes[noteKey] ?? ""}
            onSaved={(content) => {
              setNotes((n) => ({ ...n, [noteKey]: content }));
              setMessage("笔记已保存");
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
