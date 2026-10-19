import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
} from "lucide-react";
import { api } from "../../shared/api";
import {
  PUZZLE_CATEGORIES,
  type Puzzle,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";
import {
  preparePuzzleUpdate,
  puzzleAnswerText,
  puzzlePreview,
  usesAnswerSequence,
} from "./editor";

const secondary = "border-control-edge bg-secondary text-secondary-ink";
export default function PuzzleEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState("");
  const [step, setStep] = useState(0);
  const [alternative, setAlternative] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteCancel = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    if (id)
      void api
        .getPuzzle(id)
        .then((p) => {
          if (!active) return;
          setPuzzle(p);
          setAnswers(puzzleAnswerText(p));
          setFlipped(p.sideToMove === "black");
        })
        .catch((error) => {
          if (active) setMessage(`读取题目失败：${String(error)}`);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (confirmDelete) deleteCancel.current?.focus();
  }, [confirmDelete]);
  function cancelDelete() {
    setConfirmDelete(false);
    deleteButton.current?.focus();
  }
  async function save() {
    if (!puzzle || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const updated = preparePuzzleUpdate(puzzle, answers);
      const title = await api.savePuzzle(updated);
      setPuzzle({ ...updated, title });
      setMessage("题目已更新");
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!puzzle || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await api.deletePuzzle(puzzle.id);
      navigate("/puzzles", { replace: true });
    } catch (error) {
      setMessage(`删除失败：${String(error)}`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!puzzle)
    return (
      <div className="grid gap-4 p-4">
        <p role="status">{loading ? "加载题目中…" : message || "题目不存在"}</p>
        <button className={secondary} onClick={() => navigate("/puzzles")}>
          返回题库
        </button>
      </div>
    );
  let preview = {
    positions: [puzzle.fen],
    sans: [] as string[],
    alternatives: [] as string[],
  };
  let answerError = "";
  try {
    preview = puzzlePreview(puzzle, answers, alternative);
  } catch (error) {
    answerError = String(error).replace(/^Error: /, "");
  }
  const currentStep = Math.min(step, preview.sans.length);
  return (
    <div className="puzzle-edit-page flex h-full min-h-0 flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-accent-ink">
            PUZZLE EDITOR
          </div>
          <h1 className="!text-[26px]">编辑题目</h1>
        </div>
        <button
          className={secondary}
          disabled={busy}
          onClick={() => navigate("/puzzles")}
        >
          返回题库
        </button>
      </header>
      <div
        className="min-h-6 shrink-0 text-[13px] text-accent-ink"
        role="status"
        aria-live="polite"
      >
        {message}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,0.95fr)] gap-5">
        <section
          className="puzzle-preview flex min-h-0 min-w-0 flex-col gap-3"
          aria-label="题目棋盘预览"
        >
          <div className="flex shrink-0 justify-between text-[13px] text-engine-muted">
            <span>{puzzle.sideToMove === "white" ? "白方" : "黑方"}走棋</span>
            <span>答案预览</span>
          </div>
          <div className="min-h-0 flex-1 [container-type:size]">
            <div className="puzzle-edit-board mx-auto w-[min(100cqw,100cqh)] rounded-lg border border-panel-edge bg-panel p-2">
              <Chessboard
                options={{
                  id: "puzzle-editor-board",
                  position: preview.positions[currentStep],
                  boardOrientation: flipped ? "black" : "white",
                  allowDragging: false,
                  darkSquareStyle: {
                    backgroundColor: "var(--color-board-dark)",
                  },
                  lightSquareStyle: {
                    backgroundColor: "var(--color-board-light)",
                  },
                }}
              />
            </div>
          </div>
          <div
            className="flex shrink-0 flex-wrap justify-center gap-2"
            aria-label="预览控制"
          >
            <button
              className={secondary}
              aria-label="回到题目局面"
              disabled={currentStep === 0}
              onClick={() => setStep(0)}
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              className={secondary}
              aria-label="上一步"
              disabled={currentStep === 0}
              onClick={() => setStep(currentStep - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="flex items-center text-[13px] text-engine-muted">
              {currentStep} / {preview.sans.length}
            </span>
            <button
              className={secondary}
              aria-label="下一步"
              disabled={currentStep >= preview.sans.length}
              onClick={() => setStep(currentStep + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <button
              className={secondary}
              aria-label="答案末尾"
              disabled={currentStep >= preview.sans.length}
              onClick={() => setStep(preview.sans.length)}
            >
              <ChevronsRight size={16} />
            </button>
            <button
              className={secondary}
              aria-label="翻转棋盘"
              onClick={() => setFlipped((v) => !v)}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <p className="m-0 shrink-0 text-center text-[12px] text-engine-muted">
            修改答案后，可逐步查看棋盘上的走法。
          </p>
        </section>
        <form
          className="puzzle-editor flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy || confirmDelete}
            className="m-0 grid min-h-0 flex-1 content-start gap-3 overflow-auto border-0 p-4 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[13px] [&_input]:min-w-0 [&_textarea]:min-w-0 [&_textarea]:resize-none"
          >
            <label>
              分类
              <Select<PuzzleCategory>
                label="编辑题目分类"
                value={puzzle.category}
                options={PUZZLE_CATEGORIES}
                onValueChange={(category) =>
                  setPuzzle((p) => p && { ...p, category })
                }
              />
            </label>
            <label>
              标题
              <input
                value={puzzle.title}
                onChange={(e) =>
                  setPuzzle((p) => p && { ...p, title: e.target.value })
                }
              />
            </label>
            <label>
              说明
              <textarea
                rows={2}
                value={puzzle.description}
                onChange={(e) =>
                  setPuzzle((p) => p && { ...p, description: e.target.value })
                }
              />
            </label>
            <label>
              {usesAnswerSequence(puzzle)
                ? "连续走法（双方依次走棋）"
                : "正确招法（多个答案用逗号分隔）"}
              <textarea
                rows={2}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={answers}
                aria-invalid={!!answerError}
                aria-describedby="answer-help"
                onChange={(e) => {
                  setAnswers(e.target.value);
                  setStep(0);
                  setAlternative(0);
                }}
              />
            </label>
            <p
              id="answer-help"
              className={`m-0 text-[12px] ${answerError ? "text-red-300" : "text-engine-muted"}`}
            >
              {answerError ||
                (usesAnswerSequence(puzzle)
                  ? "支持 SAN 或 UCI，以空格分隔，如 e4 e5 Nf3。"
                  : "支持 SAN 或 UCI，如 Nf3, d2d4。")}
            </p>
            {preview.alternatives.length > 1 && (
              <div className="flex flex-wrap gap-2" aria-label="选择预览答案">
                {preview.alternatives.map((san, index) => (
                  <button
                    type="button"
                    key={index}
                    className={
                      index === alternative
                        ? "bg-selected text-selected-ink"
                        : secondary
                    }
                    aria-pressed={index === alternative}
                    onClick={() => {
                      setAlternative(index);
                      setStep(1);
                    }}
                  >
                    {san}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
          <footer className="shrink-0 border-t border-panel-edge p-4">
            {confirmDelete ? (
              <div
                role="alertdialog"
                aria-modal="false"
                aria-labelledby="delete-title"
                aria-describedby="delete-description"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !busy) cancelDelete();
                }}
              >
                <p id="delete-title" className="mt-0 font-bold">
                  删除这道题目？
                </p>
                <p
                  id="delete-description"
                  className="text-[13px] text-engine-muted"
                >
                  题目及其复习记录会一并删除，此操作无法撤销。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="border-red-700 bg-red-950 text-red-200"
                    onClick={() => void remove()}
                  >
                    {busy ? "删除中…" : "确认删除"}
                  </button>
                  <button
                    ref={deleteCancel}
                    type="button"
                    disabled={busy}
                    className={secondary}
                    onClick={cancelDelete}
                  >
                    取消删除
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" disabled={busy || !!answerError}>
                  {busy ? "保存中…" : "保存修改"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={secondary}
                  onClick={() => navigate("/puzzles")}
                >
                  取消
                </button>
                <button
                  ref={deleteButton}
                  type="button"
                  disabled={busy}
                  className="ml-auto border-red-900 bg-transparent text-red-300"
                  onClick={() => setConfirmDelete(true)}
                >
                  删除题目
                </button>
              </div>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}
