import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  IconButton,
  TextArea,
  TextField,
} from "@radix-ui/themes";
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
  let preview = {
    positions: [puzzle?.fen ?? ""],
    sans: [] as string[],
    alternatives: [] as string[],
  };
  let answerError = "";
  try {
    if (puzzle) preview = puzzlePreview(puzzle, answers, alternative);
  } catch (error) {
    answerError = String(error).replace(/^Error: /, "");
  }
  const previewLength = preview.sans.length;
  useEffect(() => {
    if (!puzzle || busy || confirmDelete) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="option"]',
        )
      )
        return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      setStep((previous) =>
        Math.max(
          0,
          Math.min(
            previewLength,
            Math.min(previous, previewLength) + direction,
          ),
        ),
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [puzzle, previewLength, busy, confirmDelete]);
  if (!puzzle)
    return (
      <Grid gap="4" p="4">
        <p role="status">{loading ? "加载题目中…" : message || "题目不存在"}</p>
        <Button size="1" variant="soft" onClick={() => navigate("/puzzles")}>
          返回题库
        </Button>
      </Grid>
    );
  const currentStep = Math.min(step, previewLength);
  return (
    <Flex direction="column" gap="3" className="h-full min-h-0">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <Box>
          <Box className="text-eyebrow font-bold tracking-eyebrow text-accent-ink">
            PUZZLE EDITOR
          </Box>
          <Heading as="h1" size="6" className="!text-editor-title">
            编辑题目
          </Heading>
        </Box>
        <Button
          size="1"
          variant="soft"
          disabled={busy}
          onClick={() => navigate("/puzzles")}
        >
          返回题库
        </Button>
      </header>
      <Box
        className="min-h-6 shrink-0 text-body-sm text-accent-ink"
        role="status"
        aria-live="polite"
      >
        {message}
      </Box>
      <Grid gap="5" className="min-h-0 flex-1 grid-cols-puzzle">
        <section
          className="flex min-h-0 min-w-0 flex-col gap-3"
          aria-label="题目棋盘预览"
        >
          <Flex
            justify="between"
            className="shrink-0 text-body-sm text-engine-muted"
          >
            <span>{puzzle.sideToMove === "white" ? "白方" : "黑方"}走棋</span>
            <span>答案预览</span>
          </Flex>
          <Box className="min-h-0 flex-1 container-size">
            <Card className="mx-auto w-puzzle-board p-2">
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
            </Card>
          </Box>
          <Flex
            wrap="wrap"
            justify="center"
            gap="2"
            className="shrink-0"
            aria-label="预览控制"
          >
            <IconButton
              size="1"
              variant="soft"
              aria-label="回到题目局面"
              disabled={currentStep === 0}
              onClick={() => setStep(0)}
            >
              <ChevronsLeft size={16} />
            </IconButton>
            <IconButton
              size="1"
              variant="soft"
              aria-label="上一步"
              aria-keyshortcuts="ArrowLeft"
              title="上一步（←）"
              disabled={currentStep === 0}
              onClick={() => setStep(currentStep - 1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="flex items-center text-body-sm text-engine-muted">
              {currentStep} / {preview.sans.length}
            </span>
            <IconButton
              size="1"
              variant="soft"
              aria-label="下一步"
              aria-keyshortcuts="ArrowRight"
              title="下一步（→）"
              disabled={currentStep >= preview.sans.length}
              onClick={() => setStep(currentStep + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
            <IconButton
              size="1"
              variant="soft"
              aria-label="答案末尾"
              disabled={currentStep >= preview.sans.length}
              onClick={() => setStep(preview.sans.length)}
            >
              <ChevronsRight size={16} />
            </IconButton>
            <IconButton
              size="1"
              variant="soft"
              aria-label="翻转棋盘"
              onClick={() => setFlipped((v) => !v)}
            >
              <RotateCcw size={16} />
            </IconButton>
          </Flex>
          <p className="m-0 shrink-0 text-center text-xs text-engine-muted">
            使用 ← / → 方向键或按钮，逐步查看棋盘上的走法。
          </p>
        </section>
        <form
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy || confirmDelete}
            className="m-0 grid min-h-0 flex-1 content-start gap-3 overflow-auto border-0 p-4 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-body-sm [&_input]:min-w-0 [&_textarea]:min-w-0 [&_textarea]:resize-none"
          >
            <label>
              分类
              <Select<PuzzleCategory>
                disabled={busy || confirmDelete}
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
              <TextField.Root
                value={puzzle.title}
                onChange={(e) =>
                  setPuzzle((p) => p && { ...p, title: e.target.value })
                }
              />
            </label>
            <label>
              说明
              <TextArea
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
              <TextArea
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
              className={`m-0 text-xs ${answerError ? "text-danger" : "text-engine-muted"}`}
            >
              {answerError ||
                (usesAnswerSequence(puzzle)
                  ? "支持 SAN 或 UCI，以空格分隔，如 e4 e5 Nf3。"
                  : "支持 SAN 或 UCI，如 Nf3, d2d4。")}
            </p>
            {preview.alternatives.length > 1 && (
              <Flex wrap="wrap" gap="2" aria-label="选择预览答案">
                {preview.alternatives.map((san, index) => (
                  <Button
                    size="1"
                    type="button"
                    key={index}
                    variant={index === alternative ? "solid" : "soft"}
                    aria-pressed={index === alternative}
                    onClick={() => {
                      setAlternative(index);
                      setStep(1);
                    }}
                  >
                    {san}
                  </Button>
                ))}
              </Flex>
            )}
          </fieldset>
          <footer className="shrink-0 border-t border-panel-edge p-4">
            {confirmDelete ? (
              <Box
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
                  className="text-body-sm text-engine-muted"
                >
                  题目及其复习记录会一并删除，此操作无法撤销。
                </p>
                <Flex gap="2">
                  <Button
                    size="1"
                    variant="solid"
                    color="red"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {busy ? "删除中…" : "确认删除"}
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    ref={deleteCancel}
                    type="button"
                    disabled={busy}
                    onClick={cancelDelete}
                  >
                    取消删除
                  </Button>
                </Flex>
              </Box>
            ) : (
              <Flex wrap="wrap" align="center" gap="2">
                <Button
                  size="1"
                  variant="solid"
                  type="submit"
                  disabled={busy || !!answerError}
                >
                  {busy ? "保存中…" : "保存修改"}
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  type="button"
                  disabled={busy}
                  onClick={() => navigate("/puzzles")}
                >
                  取消
                </Button>
                <Button
                  size="1"
                  variant="ghost"
                  ref={deleteButton}
                  type="button"
                  disabled={busy}
                  color="red"
                  className="ml-auto"
                  onClick={() => setConfirmDelete(true)}
                >
                  删除题目
                </Button>
              </Flex>
            )}
          </footer>
        </form>
      </Grid>
    </Flex>
  );
}
