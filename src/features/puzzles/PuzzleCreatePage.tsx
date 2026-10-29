import {
  AlertDialog,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  Heading,
  IconButton,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chess, DEFAULT_POSITION, type Square } from "chess.js";
import { Chessboard, defaultPieces } from "react-chessboard";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eraser,
  Hand,
  Plus,
  RotateCcw,
} from "lucide-react";
import { api } from "../../shared/api";
import { tryMove } from "../../shared/chess/moves";
import { playMoveSound } from "../../shared/audio/move-sound";
import {
  PUZZLE_CATEGORIES,
  type Puzzle,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";
import { puzzlePreview, preparePuzzleUpdate } from "./editor";
import {
  CASTLING,
  canCastle,
  placePiece,
  positionError,
  positionFen,
  positionFromFen,
  type PositionDraft,
} from "./position";

const pieceNames: Record<string, string> = {
  K: "王",
  Q: "后",
  R: "车",
  B: "象",
  N: "马",
  P: "兵",
};

export default function PuzzleCreatePage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => positionFromFen(DEFAULT_POSITION));
  const [stage, setStage] = useState<"setup" | "answers">("setup");
  const [tool, setTool] = useState("move");
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [fenInput, setFenInput] = useState("");
  const [category, setCategory] = useState<PuzzleCategory>("opening");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState("");
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [puzzleId] = useState(() => crypto.randomUUID());
  const [promotion, setPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const fen = positionFen(draft);
  const setupError = positionError(fen);
  const puzzle: Puzzle = {
    id: "",
    category,
    sourceType: "manual",
    sourceGameId: null,
    sourceMoveId: null,
    fen,
    sideToMove: draft.turn === "w" ? "white" : "black",
    title: title.trim(),
    description,
    originalMove: null,
    expectedMoves: [],
    solutionLine: [],
    errorCategory: null,
  };
  let preview = {
    positions: [fen],
    sans: [] as string[],
    alternatives: [] as string[],
  };
  let answerError = "";
  if (!setupError && answers.trim()) {
    try {
      preview = puzzlePreview(puzzle, answers, 0);
    } catch (error) {
      answerError = String(error).replace(/^Error: /, "");
    }
  }
  const currentStep = Math.min(step, preview.sans.length);
  const currentFen = preview.positions[currentStep];
  const previewLength = preview.sans.length;
  useEffect(() => {
    if (stage !== "answers" || busy || promotion) return;
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="option"], [role="dialog"], [role="alertdialog"]',
        )
      )
        return;
      event.preventDefault();
      setSelected(null);
      setStep((value) =>
        Math.max(
          0,
          Math.min(
            previewLength,
            Math.min(value, previewLength) +
              (event.key === "ArrowLeft" ? -1 : 1),
          ),
        ),
      );
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [stage, busy, promotion, previewLength]);

  function updatePosition(next: PositionDraft) {
    setDraft(next);
    setSelected(null);
    setMessage("");
  }
  function record(from: string, to: string, promote?: string): boolean {
    if (busy || (promotion && !promote) || answerError) return false;
    const chess = new Chess(currentFen);
    const moves = chess
      .moves({ square: from as Square, verbose: true })
      .filter((move) => move.to === to);
    if (!promote && moves.some((move) => move.promotion)) {
      setPromotion({ from, to });
      return false;
    }
    const move = tryMove(currentFen, from, to, promote);
    if (!move) return false;
    setAnswers([...preview.sans.slice(0, currentStep), move.san].join(" "));
    setStep(currentStep + 1);
    setSelected(null);
    setMessage("");
    playMoveSound(move.san);
    return true;
  }
  function squareClick(square: string) {
    if (busy || promotion) return;
    if (stage === "setup" && tool !== "move") {
      updatePosition(placePiece(draft, square, tool === "erase" ? null : tool));
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    if (selected) {
      if (stage === "setup") {
        const piece = draft.pieces[selected]?.pieceType;
        if (piece) updatePosition(placePiece(draft, square, piece, selected));
        return;
      }
      if (record(selected, square)) return;
    }
    setSelected(
      stage === "setup" ||
        new Chess(currentFen).get(square as Square)?.color ===
          new Chess(currentFen).turn()
        ? square
        : null,
    );
  }
  function importFen() {
    try {
      updatePosition(positionFromFen(fenInput));
      setFenInput("");
      setMessage("已导入初始局面");
    } catch (error) {
      setMessage(String(error).replace(/^Error: /, ""));
    }
  }
  function startAnswers() {
    if (setupError) {
      setMessage(setupError);
      return;
    }
    setStage("answers");
    setSelected(null);
    setFlipped(draft.turn === "b");
    setMessage("");
  }
  function editPosition() {
    setStage("setup");
    setAnswers("");
    setStep(0);
    setSelected(null);
    setMessage("");
  }
  async function save() {
    if (
      saving.current ||
      stage !== "answers" ||
      setupError ||
      answerError ||
      !answers.trim()
    )
      return;
    saving.current = true;
    setBusy(true);
    setMessage("");
    try {
      await api.savePuzzle({
        ...preparePuzzleUpdate(puzzle, answers),
        id: puzzleId,
      });
      navigate(`/puzzles/${encodeURIComponent(puzzleId)}/edit`, {
        replace: true,
      });
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function palette(color: "w" | "b") {
    return (
      <Flex
        justify="center"
        gap="1"
        className="shrink-0"
        aria-label={color === "w" ? "白方棋子" : "黑方棋子"}
      >
        {Object.entries(pieceNames).map(([piece, name]) => {
          const type = color + piece;
          const Piece = defaultPieces[type];
          return (
            <Button
              key={type}
              type="button"
              size="1"
              variant={tool === type ? "solid" : "soft"}
              className="piece-picker h-9 w-10 p-1"
              aria-label={`${color === "w" ? "白" : "黑"}${name}`}
              aria-pressed={tool === type}
              onClick={() => {
                setTool(type);
                setSelected(null);
              }}
            >
              <Box className="size-7">
                <Piece />
              </Box>
            </Button>
          );
        })}
      </Flex>
    );
  }
  return (
    <Flex
      direction="column"
      gap="3"
      className="h-full min-h-0 max-[760px]:h-auto"
    >
      <Flex justify="between" align="center" gap="3" className="shrink-0">
        <Box>
          <Box className="text-eyebrow font-bold tracking-eyebrow text-accent-ink">
            NEW PUZZLE
          </Box>
          <Heading as="h1" size="6">
            新建题目
          </Heading>
        </Box>
        <Button
          size="1"
          variant="soft"
          disabled={busy}
          onClick={() => navigate("/puzzles")}
        >
          <ArrowLeft size={14} />
          返回题库
        </Button>
      </Flex>
      <Box
        role="status"
        aria-live="polite"
        className="min-h-5 shrink-0 text-body-sm text-accent-ink"
      >
        {message}
      </Box>
      <Grid
        gap="5"
        className="min-h-0 flex-1 grid-cols-puzzle max-[760px]:grid-cols-1"
      >
        <section
          aria-label="题目初始局面与答案棋盘"
          className="flex min-h-0 min-w-0 flex-col gap-2 max-[760px]:h-125"
        >
          <Flex
            justify="between"
            align="center"
            className="shrink-0 text-body-sm text-engine-muted"
          >
            <span>{stage === "setup" ? "编辑初始局面" : "录入与预览答案"}</span>
            <Flex gap="2" align="center">
              {stage === "answers" && (
                <span>
                  {currentFen.split(" ")[1] === "w" ? "白方" : "黑方"}走棋
                </span>
              )}
              <IconButton
                size="1"
                variant="soft"
                aria-label="翻转棋盘"
                onClick={() => setFlipped(!flipped)}
              >
                <RotateCcw size={14} />
              </IconButton>
            </Flex>
          </Flex>
          {stage === "setup" && palette(flipped ? "w" : "b")}
          <Box className="min-h-0 flex-1 container-size">
            <Card className="mx-auto w-puzzle-board p-2">
              <Chessboard
                options={{
                  id: "puzzle-create-board",
                  position: stage === "setup" ? draft.pieces : currentFen,
                  boardOrientation: flipped ? "black" : "white",
                  allowDragging: !busy && !promotion && !answerError,
                  allowDragOffBoard: stage === "setup",
                  showAnimations: stage !== "setup",
                  darkSquareStyle: {
                    backgroundColor: "var(--color-board-dark)",
                  },
                  lightSquareStyle: {
                    backgroundColor: "var(--color-board-light)",
                  },
                  squareStyles: selected
                    ? {
                        [selected]: {
                          boxShadow: "inset 0 0 0 3px var(--color-accent)",
                        },
                      }
                    : {},
                  onSquareClick: ({ square }) => squareClick(square),
                  onSquareRightClick: ({ square }) => {
                    if (stage === "setup" && !busy)
                      updatePosition(placePiece(draft, square, null));
                  },
                  onPieceDrop: ({ sourceSquare, targetSquare, piece }) => {
                    if (stage === "setup") {
                      updatePosition(
                        placePiece(
                          draft,
                          targetSquare ?? sourceSquare,
                          targetSquare ? piece.pieceType : null,
                          sourceSquare,
                        ),
                      );
                      return true;
                    }
                    return targetSquare
                      ? record(sourceSquare, targetSquare)
                      : false;
                  },
                }}
              />
            </Card>
          </Box>
          {stage === "setup" ? (
            <>
              {palette(flipped ? "b" : "w")}
              <Flex justify="center" gap="2" className="shrink-0">
                <Button
                  type="button"
                  size="1"
                  variant={tool === "move" ? "solid" : "soft"}
                  aria-pressed={tool === "move"}
                  onClick={() => {
                    setTool("move");
                    setSelected(null);
                  }}
                >
                  <Hand size={14} />
                  移动棋子
                </Button>
                <Button
                  type="button"
                  size="1"
                  variant={tool === "erase" ? "solid" : "soft"}
                  aria-pressed={tool === "erase"}
                  onClick={() => {
                    setTool("erase");
                    setSelected(null);
                  }}
                >
                  <Eraser size={14} />
                  擦除
                </Button>
              </Flex>
              <Text size="1" align="center" color="gray">
                选择棋子后点击棋格放置；拖动移动，右键或拖出棋盘删除。
              </Text>
            </>
          ) : (
            <>
              <Flex
                justify="center"
                align="center"
                gap="2"
                className="shrink-0"
                aria-label="答案预览控制"
              >
                <IconButton
                  size="1"
                  variant="soft"
                  aria-label="答案起点"
                  disabled={!currentStep}
                  onClick={() => {
                    setStep(0);
                    setSelected(null);
                  }}
                >
                  <ChevronsLeft size={16} />
                </IconButton>
                <IconButton
                  size="1"
                  variant="soft"
                  aria-label="上一步"
                  aria-keyshortcuts="ArrowLeft"
                  disabled={!currentStep}
                  onClick={() => {
                    setStep(currentStep - 1);
                    setSelected(null);
                  }}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <Text size="2" color="gray">
                  {currentStep} / {previewLength}
                </Text>
                <IconButton
                  size="1"
                  variant="soft"
                  aria-label="下一步"
                  aria-keyshortcuts="ArrowRight"
                  disabled={currentStep >= previewLength}
                  onClick={() => {
                    setStep(currentStep + 1);
                    setSelected(null);
                  }}
                >
                  <ChevronRight size={16} />
                </IconButton>
                <IconButton
                  size="1"
                  variant="soft"
                  aria-label="答案末尾"
                  disabled={currentStep >= previewLength}
                  onClick={() => {
                    setStep(previewLength);
                    setSelected(null);
                  }}
                >
                  <ChevronsRight size={16} />
                </IconButton>
              </Flex>
              <Text size="1" align="center" color="gray">
                在棋盘上依次走棋，使用 ← / → 预览；退回改走会替换后续答案。
              </Text>
            </>
          )}
        </section>
        <form
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (stage === "setup") startAnswers();
            else void save();
          }}
        >
          <fieldset
            disabled={busy}
            className="m-0 grid min-h-0 flex-1 content-start gap-4 overflow-auto border-0 p-4"
          >
            <Flex gap="2" align="center">
              <Text
                size="2"
                weight="bold"
                color={stage === "setup" ? undefined : "gray"}
              >
                1 · 初始局面
              </Text>
              <Text size="2" color="gray">
                /
              </Text>
              <Text
                size="2"
                weight="bold"
                color={stage === "answers" ? undefined : "gray"}
              >
                2 · 题目与答案
              </Text>
            </Flex>
            {stage === "setup" ? (
              <>
                <label className="grid gap-1.5 text-body-sm">
                  走棋方
                  <Select
                    label="走棋方"
                    value={draft.turn}
                    options={[
                      { value: "w", label: "白方走棋" },
                      { value: "b", label: "黑方走棋" },
                    ]}
                    onValueChange={(turn) =>
                      updatePosition({ ...draft, turn, enPassant: "-" })
                    }
                  />
                </label>
                <Box>
                  <Text as="p" size="2" weight="medium" mb="2">
                    易位权
                  </Text>
                  <Grid columns="2" gap="2">
                    {CASTLING.map((option) => (
                      <Text as="label" size="2" key={option.right}>
                        <Flex align="center" gap="2">
                          <Checkbox
                            checked={draft.castling.includes(option.right)}
                            disabled={!canCastle(draft.pieces, option)}
                            onCheckedChange={(checked) =>
                              updatePosition({
                                ...draft,
                                castling: CASTLING.filter((item) =>
                                  item.right === option.right
                                    ? checked === true
                                    : draft.castling.includes(item.right),
                                )
                                  .map((item) => item.right)
                                  .join(""),
                              })
                            }
                          />
                          {option.label}
                        </Flex>
                      </Text>
                    ))}
                  </Grid>
                </Box>
                <label className="grid gap-1.5 text-body-sm">
                  吃过路兵目标格
                  <Select
                    label="吃过路兵目标格"
                    value={draft.enPassant}
                    options={[
                      { value: "-", label: "无" },
                      ...[..."abcdefgh"].map((file) => ({
                        value: file + (draft.turn === "w" ? "6" : "3"),
                        label: file + (draft.turn === "w" ? "6" : "3"),
                      })),
                    ]}
                    onValueChange={(enPassant) =>
                      updatePosition({ ...draft, enPassant })
                    }
                  />
                </label>
                <Flex wrap="wrap" gap="2">
                  <Button
                    size="1"
                    variant="soft"
                    type="button"
                    onClick={() =>
                      updatePosition(positionFromFen(DEFAULT_POSITION))
                    }
                  >
                    <RotateCcw size={14} />
                    标准初始局面
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    type="button"
                    onClick={() =>
                      updatePosition({
                        pieces: {},
                        turn: "w",
                        castling: "",
                        enPassant: "-",
                        halfmove: "0",
                        fullmove: "1",
                      })
                    }
                  >
                    清空棋盘
                  </Button>
                </Flex>
                <Box className="grid gap-2 border-t border-panel-edge pt-3">
                  <label className="grid gap-1.5 text-body-sm">
                    当前局面 FEN
                    <TextArea
                      aria-label="当前局面 FEN"
                      value={fen}
                      readOnly
                      rows={2}
                      className="font-chess-mono text-xs"
                    />
                  </label>
                  <label className="grid gap-1.5 text-body-sm">
                    通过 FEN 导入
                    <TextArea
                      aria-label="导入 FEN"
                      value={fenInput}
                      rows={2}
                      spellCheck={false}
                      placeholder="粘贴完整 FEN"
                      onChange={(event) => setFenInput(event.target.value)}
                    />
                  </label>
                  <Button
                    size="1"
                    variant="soft"
                    type="button"
                    disabled={!fenInput.trim()}
                    onClick={importFen}
                  >
                    导入局面
                  </Button>
                </Box>
                <Text size="1" color={setupError ? "orange" : "gray"}>
                  {setupError || "局面可用，可以继续录入题目和答案。"}
                </Text>
              </>
            ) : (
              <>
                <Flex justify="between" align="center" gap="2">
                  <Text size="2" color="gray">
                    起点已固定 · {draft.turn === "w" ? "白方" : "黑方"}答题
                  </Text>
                  <AlertDialog.Root>
                    <AlertDialog.Trigger>
                      <Button size="1" variant="soft" type="button">
                        修改初始局面
                      </Button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Content maxWidth="400px">
                      <AlertDialog.Title>修改初始局面？</AlertDialog.Title>
                      <AlertDialog.Description>
                        将清空已录入的走法，分类、标题和说明会保留。
                      </AlertDialog.Description>
                      <Flex justify="end" gap="2" mt="4">
                        <AlertDialog.Cancel>
                          <Button size="1" variant="soft">
                            取消
                          </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                          <Button size="1" onClick={editPosition}>
                            修改局面
                          </Button>
                        </AlertDialog.Action>
                      </Flex>
                    </AlertDialog.Content>
                  </AlertDialog.Root>
                </Flex>
                <label className="grid gap-1.5 text-body-sm">
                  分类
                  <Select<PuzzleCategory>
                    label="题目分类"
                    value={category}
                    options={PUZZLE_CATEGORIES}
                    onValueChange={setCategory}
                  />
                </label>
                <label className="grid gap-1.5 text-body-sm">
                  标题
                  <TextField.Root
                    aria-label="题目标题"
                    value={title}
                    placeholder="留空自动命名"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-body-sm">
                  说明
                  <TextArea
                    aria-label="题目说明"
                    value={description}
                    rows={3}
                    placeholder="答案揭晓时展示的说明"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-body-sm">
                  连续走法（双方依次走棋）
                  <TextArea
                    aria-label="连续走法"
                    value={answers}
                    rows={3}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    aria-invalid={!!answerError}
                    aria-describedby="create-answer-help"
                    placeholder="在棋盘上走棋，或输入 e4 e5 Nf3"
                    onChange={(event) => {
                      setAnswers(event.target.value);
                      setStep(0);
                      setSelected(null);
                    }}
                  />
                </label>
                <Text
                  as="p"
                  id="create-answer-help"
                  size="1"
                  color={answerError ? "red" : "gray"}
                >
                  {answerError ||
                    "支持 SAN 或 UCI，以空格分隔；保存完整的双方连续走法。"}
                </Text>
                <label className="grid gap-1.5 text-body-sm">
                  题目初始 FEN
                  <TextArea
                    aria-label="题目初始 FEN"
                    readOnly
                    value={fen}
                    rows={2}
                    className="font-chess-mono text-xs"
                  />
                </label>
              </>
            )}
          </fieldset>
          <footer className="shrink-0 border-t border-panel-edge p-4">
            <Button
              size="2"
              type="submit"
              disabled={
                busy ||
                !!setupError ||
                (stage === "answers" && (!!answerError || !answers.trim()))
              }
            >
              {stage === "setup" ? (
                "继续：录入题目与走法"
              ) : busy ? (
                "保存中…"
              ) : (
                <>
                  <Plus size={16} />
                  保存题目
                </>
              )}
            </Button>
          </footer>
        </form>
      </Grid>
      <Dialog.Root
        open={!!promotion}
        onOpenChange={(open) => {
          if (!open) setPromotion(null);
        }}
      >
        <Dialog.Content maxWidth="320px">
          <Dialog.Title>选择升变棋子</Dialog.Title>
          <Dialog.Description>选择兵到达底线后升变的棋子。</Dialog.Description>
          <Flex gap="2" mt="4">
            {["q", "r", "b", "n"].map((piece) => (
              <Button
                key={piece}
                onClick={() => {
                  if (promotion) record(promotion.from, promotion.to, piece);
                  setPromotion(null);
                }}
              >
                {pieceNames[piece.toUpperCase()]}
              </Button>
            ))}
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
}
