import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  Download,
  Upload,
  Plus,
} from "lucide-react";
import { Select } from "../../shared/ui/select";
import { classifyOpening } from "../../shared/chess/openings";
import { repertoireApi } from "./api";
import RepertoireTree from "./Tree";
import {
  addMove,
  childrenOf,
  deleteBranch,
  exportRepertoirePgn,
  moveLabel,
  newRepertoire,
  pathTo,
  positionKey,
  promoteNode,
  type Repertoire,
  type RepertoireSummary,
} from "./model";

export default function RepertoirePage() {
  const navigateTo = useNavigate();
  const [books, setBooks] = useState<RepertoireSummary[]>([]);
  const [book, setBook] = useState<Repertoire | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const working = useRef(true);
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [dialog, setDialog] = useState<"new" | "import" | "rename" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [side, setSide] = useState<"white" | "black">("white");
  const [initialFen, setInitialFen] = useState("");
  const [pgn, setPgn] = useState("");
  const [confirmation, setConfirmation] = useState<
    { nodeId: string } | { book: true } | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [rightTab, setRightTab] = useState<"line" | "note">("line");
  const current = book?.nodes.find((n) => n.id === currentId);
  const lastMoveTarget =
    current && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(current.uci)
      ? current.uci.slice(2, 4)
      : null;
  const fen = current?.fenAfter ?? book?.initialFen ?? new Chess().fen();
  const key = positionKey(fen);
  const draft = drafts[key] ?? book?.notes[key] ?? "";
  const dirty = Object.keys(drafts).some(
    (k) =>
      drafts[k] !== book?.notes[k] && !(drafts[k] === "" && !book?.notes[k]),
  );
  const path = book ? pathTo(book, currentId) : [];
  const opening = classifyOpening(
    path.length
      ? path
      : book
        ? [{ fenBefore: book.initialFen, fenAfter: book.initialFen }]
        : [],
  );
  useEffect(() => {
    let active = true;
    void repertoireApi
      .list()
      .then(async (list) => {
        if (!active) return;
        setBooks(list);
        if (list[0]) {
          const loaded = await repertoireApi.get(list[0].id);
          if (active) {
            setBook(loaded);
            setFlipped(loaded.side === "black");
          }
        }
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      })
      .finally(() => {
        if (active) {
          working.current = false;
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!dirty || !book) return;
    const leave = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest("a[href]");
      const href = link?.getAttribute("href");
      if (!href?.startsWith("/") || href === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      void save(book).then((saved) => {
        if (saved) navigateTo(href);
      });
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  });
  function withDrafts(next: Repertoire) {
    return { ...next, notes: { ...next.notes, ...drafts } };
  }
  async function save(
    next: Repertoire,
    includeDrafts = true,
  ): Promise<Repertoire | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      const saved = await repertoireApi.save(
        includeDrafts && next.id === book?.id ? withDrafts(next) : next,
      );
      setBook(saved);
      setDrafts({});
      setBooks((prior) =>
        [
          ...prior.filter((b) => b.id !== saved.id),
          {
            id: saved.id,
            name: saved.name,
            side: saved.side,
            count: saved.nodes.length,
            revision: saved.revision,
          },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return saved;
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
      return null;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function go(id: string | null) {
    if (working.current) return;
    if (dirty && book && !(await save(book))) return;
    setCurrentId(id);
    setSelected(null);
    setPromotion(null);
  }
  async function switchBook(id: string) {
    if (working.current || !id || id === book?.id) return;
    if (dirty && book && !(await save(book))) return;
    working.current = true;
    setBusy(true);
    try {
      const loaded = await repertoireApi.get(id);
      setBook(loaded);
      setDrafts({});
      setCurrentId(null);
      setSelected(null);
      setPromotion(null);
      setFlipped(loaded.side === "black");
      setMessage("");
    } catch (e) {
      setMessage(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function navigate(direction: "start" | "back" | "next" | "end") {
    if (!book) return;
    let id = currentId;
    if (direction === "start") id = null;
    if (direction === "back") id = current?.parentId ?? null;
    if (direction === "next")
      id = childrenOf(book, currentId)[0]?.id ?? currentId;
    if (direction === "end")
      while (childrenOf(book, id).length) id = childrenOf(book, id)[0].id;
    void go(id);
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        dialog ||
        confirmation ||
        busy
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="combobox"]',
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate(event.key === "ArrowLeft" ? "back" : "next");
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  function play(from: string, to: string, promote = "q") {
    if (!book || working.current) return false;
    const chess = new Chess(fen);
    const candidate = chess
      .moves({ verbose: true })
      .filter((m) => m.from === from && m.to === to);
    if (!candidate.length) return false;
    if (candidate.some((m) => m.promotion) && !promotion) {
      setPromotion({ from, to });
      return false;
    }
    try {
      const next = addMove(book, currentId, from, to, promote);
      const previousId = currentId;
      setCurrentId(next.node.id);
      setSelected(null);
      setPromotion(null);
      if (next.book === book) {
        if (dirty)
          void save(book).then((saved) => {
            if (!saved) setCurrentId(previousId);
          });
        return true;
      }
      // Accept the move immediately. The board must not snap back while a
      // large repertoire is persisted, or animate the same drop a second time.
      setBook(next.book);
      working.current = true;
      setBusy(true);
      setMessage("");
      void repertoireApi
        .addMove(book.id, book.revision, next.node, drafts)
        .then((revision) => {
          setBook({
            ...next.book,
            notes: { ...next.book.notes, ...drafts },
            revision,
          });
          setDrafts({});
          setBooks((prior) =>
            prior.map((item) =>
              item.id === book.id
                ? { ...item, count: next.book.nodes.length, revision }
                : item,
            ),
          );
        })
        .catch((error) => {
          setBook(book);
          setCurrentId(previousId);
          setMessage(`保存失败，已回退此步：${String(error)}`);
        })
        .finally(() => {
          working.current = false;
          setBusy(false);
        });
      return true;
    } catch (e) {
      setMessage(String(e));
    }
    return false;
  }
  function click(square: string) {
    if (!book || busy || working.current) return;
    if (selected && square !== selected) {
      void play(selected, square);
      setSelected(null);
      return;
    }
    const piece = new Chess(fen).get(square as Square);
    setSelected(piece?.color === fen.split(" ")[1] ? square : null);
  }
  function openDialog(kind: "new" | "import" | "rename") {
    if (dirty) {
      setMessage("请先保存当前局面评注，再进行此操作。");
      return;
    }
    setMessage("");
    setName(kind === "rename" ? (book?.name ?? "") : "");
    setSide(book?.side ?? "white");
    setPgn("");
    setInitialFen("");
    setDialog(kind);
  }
  function parseInWorker(base: Repertoire, text: string) {
    return new Promise<Repertoire>((resolve, reject) => {
      const worker = new Worker(
        new URL("./import.worker.ts", import.meta.url),
        { type: "module" },
      );
      const timer = window.setTimeout(() => {
        worker.terminate();
        reject(Error("PGN 解析超时，请拆分文件后重试"));
      }, 30000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        if (event.data.error) reject(Error(event.data.error));
        else resolve(event.data.book);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(Error(event.message));
      };
      worker.postMessage({ book: base, text });
    });
  }
  async function submitDialog() {
    if (working.current) return;
    const kind = dialog;
    try {
      if (kind === "rename" && book) {
        if (await save({ ...book, name: name.trim(), side })) setDialog(null);
        return;
      }
      let next =
        kind === "new"
          ? newRepertoire(name, side, initialFen || undefined)
          : book;
      if (!next) return;
      if (pgn.trim()) {
        working.current = true;
        setBusy(true);
        try {
          next = await parseInWorker(next, pgn);
        } finally {
          working.current = false;
          setBusy(false);
        }
      }
      const saved = await save(next);
      if (saved) {
        setCurrentId(null);
        setSelected(null);
        setFlipped(saved.side === "black");
        setDialog(null);
      }
    } catch (e) {
      setMessage(`导入或创建失败：${String(e)}`);
    }
  }
  async function removeConfirmed() {
    if (!book || !confirmation || working.current) return;
    if ("nodeId" in confirmation) {
      const node = book.nodes.find((n) => n.id === confirmation.nodeId);
      const next = deleteBranch(withDrafts(book), confirmation.nodeId);
      if (await save(next, false)) {
        setSelected(null);
        setPromotion(null);
        if (currentId !== null && !next.nodes.some((n) => n.id === currentId))
          setCurrentId(node?.parentId ?? null);
        setConfirmation(null);
      }
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      await repertoireApi.delete(book.id, book.revision);
      const remaining = books.filter((b) => b.id !== book.id);
      setBooks(remaining);
      setBook(null);
      const loaded = remaining[0]
        ? await repertoireApi.get(remaining[0].id)
        : null;
      setBook(loaded);
      setFlipped(loaded?.side === "black");
      setPromotion(null);
      setCurrentId(null);
      setDrafts({});
      setSelected(null);
      setConfirmation(null);
      setMessage("");
    } catch (e) {
      setMessage(`删除失败：${String(e)}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function exportPgn() {
    if (!book) return;
    const saved = dirty ? await save(book) : book;
    if (!saved) return;
    try {
      const url = URL.createObjectURL(
        new Blob([exportRepertoirePgn(saved)], {
          type: "application/x-chess-pgn;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${saved.name.replace(/[/\\:*?"<>|]/g, "_")}.pgn`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMessage(`导出失败：${String(error)}`);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Flex
        align="center"
        justify="between"
        wrap="wrap"
        gap="2"
        className="shrink-0"
      >
        <Heading as="h1" size="6">
          开局库
        </Heading>
        <Flex gap="2" wrap="wrap">
          <Button
            size="1"
            variant="soft"
            disabled={busy}
            onClick={() => openDialog("new")}
          >
            <Plus size={14} />
            新建开局库
          </Button>
          <Button
            size="1"
            variant="soft"
            disabled={busy || !book}
            onClick={() => openDialog("import")}
          >
            <Upload size={14} />
            导入 PGN
          </Button>
          <Button
            size="1"
            variant="soft"
            disabled={busy || !book}
            onClick={() => void exportPgn()}
          >
            <Download size={14} />
            导出 PGN
          </Button>
        </Flex>
      </Flex>
      <p
        role="status"
        className="m-0 min-h-5 shrink-0 text-body-sm text-accent-ink"
      >
        {message || (busy ? "正在保存或导入…" : "")}
      </p>
      {!book ? (
        <Card>
          <Text>
            新建一个开局库，或在新建时导入 PGN，开始整理你的开局线路。
          </Text>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-repertoire gap-3">
          <Card className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="shrink-0 border-b border-panel-edge p-2">
              <Select
                label="选择开局库"
                value={book.id}
                disabled={busy}
                options={books.map((b) => ({
                  value: b.id,
                  label: `${b.name} · ${b.side === "white" ? "执白" : "执黑"}`,
                }))}
                onValueChange={(id) => void switchBook(id)}
              />
              <Flex gap="3" align="center" mt="2">
                <Text size="1" color="gray">
                  {book.nodes.length} 个招法
                </Text>
                <Button
                  size="1"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => openDialog("rename")}
                >
                  编辑名称
                </Button>
                <Button
                  size="1"
                  color="red"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (dirty) {
                      setMessage("请先保存评注。");
                      return;
                    }
                    setConfirmation({ book: true });
                  }}
                >
                  删除库
                </Button>
              </Flex>
            </div>
            <RepertoireTree
              key={book.id}
              book={book}
              currentId={currentId}
              busy={busy}
              select={(id) => void go(id)}
              promote={(id) => void save(promoteNode(book, id))}
              toggle={(node) =>
                void save({
                  ...book,
                  nodes: book.nodes.map((n) =>
                    n.id === node.id ? { ...n, disabled: !n.disabled } : n,
                  ),
                })
              }
              remove={(nodeId) => setConfirmation({ nodeId })}
            />
          </Card>
          <section className="min-h-0 min-w-0 container-size">
            <div className="relative mx-auto flex w-repertoire-board flex-col gap-2">
              <div className="overflow-hidden rounded-nav border-4 border-board-frame">
                <Chessboard
                  options={{
                    id: "repertoire-board",
                    position: fen,
                    boardOrientation: flipped ? "black" : "white",
                    allowDragging: !busy,
                    dragActivationDistance: 5,
                    canDragPiece: ({ piece }) =>
                      !busy && piece.pieceType[0] === fen.split(" ")[1],
                    onSquareClick: ({ square }) => click(square),
                    onPieceDrag: () => setSelected(null),
                    onPieceDrop: ({ sourceSquare, targetSquare }) => {
                      return targetSquare
                        ? play(sourceSquare, targetSquare)
                        : false;
                    },
                    squareStyles: {
                      ...(lastMoveTarget
                        ? {
                            [lastMoveTarget]: {
                              backgroundColor: "var(--color-board-selected)",
                            },
                          }
                        : {}),
                      ...(selected
                        ? {
                            [selected]: {
                              backgroundColor: "var(--color-board-selected)",
                            },
                          }
                        : {}),
                    },
                    darkSquareStyle: {
                      backgroundColor: "var(--color-board-dark)",
                    },
                    lightSquareStyle: {
                      backgroundColor: "var(--color-board-light)",
                    },
                  }}
                />
              </div>
              {promotion && (
                <Flex
                  className="absolute inset-x-0 bottom-0 bg-panel p-3"
                  gap="2"
                  wrap="wrap"
                  role="group"
                  aria-label="选择升变棋子"
                >
                  {[
                    ["q", "后"],
                    ["r", "车"],
                    ["b", "象"],
                    ["n", "马"],
                  ].map(([piece, label]) => (
                    <Button
                      key={piece}
                      size="1"
                      onClick={() =>
                        void play(promotion.from, promotion.to, piece)
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
                justify="center"
                align="center"
                gap="2"
                className="shrink-0"
              >
                <IconButton
                  aria-label="回到开局"
                  size="1"
                  variant="soft"
                  disabled={busy}
                  onClick={() => navigate("start")}
                >
                  <ChevronsLeft size={16} />
                </IconButton>
                <IconButton
                  aria-label="上一步"
                  size="1"
                  variant="soft"
                  disabled={busy}
                  onClick={() => navigate("back")}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <Text size="1">
                  {path.filter((node) => node.uci !== "@fen").length} 步
                </Text>
                <IconButton
                  aria-label="下一步"
                  size="1"
                  variant="soft"
                  disabled={busy}
                  onClick={() => navigate("next")}
                >
                  <ChevronRight size={16} />
                </IconButton>
                <IconButton
                  aria-label="到线路末尾"
                  size="1"
                  variant="soft"
                  disabled={busy}
                  onClick={() => navigate("end")}
                >
                  <ChevronsRight size={16} />
                </IconButton>
                <IconButton
                  aria-label="翻转棋盘"
                  size="1"
                  variant="soft"
                  onClick={() => setFlipped((v) => !v)}
                >
                  <RotateCcw size={16} />
                </IconButton>
              </Flex>
              <Text size="1" color="gray" align="center">
                在棋盘上走棋自动保存 · ← / → 导航
              </Text>
            </div>
          </section>
          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <Flex gap="2" className="repertoire-tab-switch shrink-0">
              <Button
                size="1"
                variant={rightTab === "line" ? "solid" : "soft"}
                onClick={() => setRightTab("line")}
              >
                当前线路
              </Button>
              <Button
                size="1"
                variant={rightTab === "note" ? "solid" : "soft"}
                onClick={() => setRightTab("note")}
              >
                局面评注
              </Button>
            </Flex>
            <Card
              className={`repertoire-line-panel min-h-0 overflow-auto ${rightTab !== "line" ? "repertoire-tab-hidden" : ""}`}
            >
              <Heading as="h2" size="3">
                当前线路
              </Heading>
              <div
                className="flex flex-wrap items-center gap-x-1 gap-y-0.5 py-2 text-body-sm"
                aria-label="当前开局线路"
              >
                {path.length
                  ? path.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void go(node.id)}
                        aria-label={`跳转到 ${moveLabel(node)}`}
                        aria-current={
                          node.id === currentId ? "step" : undefined
                        }
                        className={`rounded-nav px-1 py-0.5 hover:bg-nav-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 ${node.id === currentId ? "bg-nav-selected text-nav-selected-ink" : "text-move"}`}
                      >
                        {moveLabel(node)}
                      </button>
                    ))
                  : "初始局面"}
              </div>
              <p className="text-sm text-muted">
                {opening.eco ?? "—"} · {opening.openingName ?? "未知开局"}
              </p>
              {path.some((n) => n.disabled) && (
                <Text size="2" color="gray">
                  当前线路已禁用（仍可浏览与编辑）。
                </Text>
              )}
            </Card>
            <Card
              className={`flex min-h-0 flex-1 flex-col gap-2 ${rightTab !== "note" ? "repertoire-tab-hidden" : ""}`}
            >
              <Heading as="h2" size="3">
                局面评注
              </Heading>
              <Text size="1" color="gray">
                同一开局库内，相同局面共享评注。
              </Text>
              <TextArea
                aria-label="局面评注"
                disabled={busy}
                value={draft}
                onChange={(e) =>
                  setDrafts((prior) => ({ ...prior, [key]: e.target.value }))
                }
                className="min-h-20 flex-1 resize-none"
                placeholder="记录计划、关键招法与注意事项…"
              />
              <Button
                size="1"
                disabled={busy || !dirty}
                onClick={() => void save(book)}
              >
                保存评注
              </Button>
              <Text size="1" color="gray">
                切换局面或开局库时会先保存评注。
              </Text>
            </Card>
          </section>
        </div>
      )}
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <Dialog.Content maxWidth="620px">
          <Dialog.Title>
            {dialog === "new"
              ? "新建开局库"
              : dialog === "rename"
                ? "编辑开局库"
                : "导入 PGN 到当前开局库"}
          </Dialog.Title>
          <Dialog.Description size="2">
            {dialog === "import"
              ? "合并主线、嵌套变例及评注，重复线路不会重复创建。原有评注会保留。"
              : "填写名称与执棋方。可选择导入 PGN，或创建后直接在棋盘录入。"}
          </Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitDialog();
            }}
          >
            <fieldset
              disabled={busy}
              className="m-0 grid gap-3 border-0 p-0 pt-4"
            >
              {dialog !== "import" && (
                <>
                  <label>
                    名称
                    <TextField.Root
                      aria-label="开局库名称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={100}
                    />
                  </label>
                  <Select
                    label="开局库执棋方"
                    value={side}
                    options={[
                      { value: "white", label: "执白" },
                      { value: "black", label: "执黑" },
                    ]}
                    onValueChange={setSide}
                  />
                </>
              )}
              {dialog === "new" && (
                <label>
                  初始 FEN（留空使用标准初始局面，导入 PGN 时自动读取）
                  <TextField.Root
                    aria-label="开局库初始 FEN"
                    value={initialFen}
                    onChange={(e) => setInitialFen(e.target.value)}
                  />
                </label>
              )}
              {dialog !== "rename" && (
                <>
                  <TextArea
                    aria-label="开局库 PGN"
                    rows={8}
                    value={pgn}
                    onChange={(e) => setPgn(e.target.value)}
                    placeholder="粘贴 PGN，支持括号中的嵌套变例和评注"
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pgn,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        if (file.size > 10000000) throw Error("文件超过 10 MB");
                        setPgn(await file.text());
                      } catch (error) {
                        setMessage(String(error));
                      } finally {
                        e.target.value = "";
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="soft"
                    onClick={() => fileInput.current?.click()}
                  >
                    选择 PGN 文件
                  </Button>
                </>
              )}
              <p role="status" className="m-0 text-sm text-danger">
                {message}
              </p>
              <Flex justify="end" gap="2">
                <Button
                  type="button"
                  variant="soft"
                  onClick={() => setDialog(null)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={dialog === "import" ? !pgn.trim() : !name.trim()}
                >
                  {busy ? "处理中…" : dialog === "import" ? "合并导入" : "保存"}
                </Button>
              </Flex>
            </fieldset>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <Dialog.Content maxWidth="460px">
          <Dialog.Title>
            {confirmation && "book" in confirmation
              ? "删除整个开局库？"
              : "删除此分支？"}
          </Dialog.Title>
          <Dialog.Description>
            {confirmation && "book" in confirmation
              ? "将删除此库的全部线路和评注，其他开局库、对局和题库不受影响。"
              : "将删除此招及其后续分支。其他转置线路和仍被使用的局面评注会保留。此操作不可撤销。"}
          </Dialog.Description>
          <p role="status" className="text-sm text-danger">
            {message}
          </p>
          <Flex justify="end" gap="2" mt="4">
            <Button
              variant="soft"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </Button>
            <Button
              color="red"
              disabled={busy}
              onClick={() => void removeConfirmed()}
            >
              确认删除
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
