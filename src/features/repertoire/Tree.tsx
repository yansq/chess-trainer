import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ContextMenu, IconButton } from "@radix-ui/themes";
import { ChevronDown, ChevronRight, FileText, CircleSlash } from "lucide-react";
import {
  moveLabel,
  pathTo,
  positionKey,
  type Repertoire,
  type RepertoireNode,
} from "./model";
const annotationSymbols: Record<string, string> = {
  $1: "!",
  $2: "?",
  $3: "!!",
  $4: "??",
  $5: "!?",
  $6: "?!",
};
interface Props {
  book: Repertoire;
  currentId: string | null;
  busy: boolean;
  select: (id: string | null) => void;
  toggle: (node: RepertoireNode) => void;
  promote: (id: string) => void;
  remove: (id: string) => void;
}
export default function RepertoireTree({
  book,
  currentId,
  busy,
  select,
  toggle,
  promote,
  remove,
}: Props) {
  const [opened, setOpened] = useState<Set<string>>(
    () => new Set(book.nodes.filter((n) => !n.parentId).map((n) => n.id)),
  );
  const [collapsed, setCollapsed] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, RepertoireNode[]>();
    for (const node of book.nodes) {
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    for (const list of map.values())
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return map;
  }, [book.nodes]);
  const selected = useRef<HTMLButtonElement>(null);
  const path = new Set(
    pathTo(book, currentId)
      .slice(0, -1)
      .map((n) => n.id),
  );
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [currentId]);
  function render(
    parentId: string | null,
    inactive = false,
    depth = 0,
  ): React.ReactNode {
    if (depth > 128) return <p>线路过深，请使用棋盘导航查看。</p>;
    return (childrenByParent.get(parentId) ?? []).map((node, index) => {
      const children = childrenByParent.get(node.id) ?? [];
      const open =
        !(collapsed.has(node.id) && collapsed.get(node.id) === currentId) &&
        (opened.has(node.id) ||
          path.has(node.id) ||
          (node.id === currentId && children.length > 1));
      const disabled = inactive || node.disabled;
      return (
        <div key={node.id}>
          <div className="flex min-w-0 items-center gap-1 py-0.5">
            {children.length > 0 ? (
              <IconButton
                size="1"
                variant="ghost"
                aria-label={`${open ? "折叠" : "展开"} ${moveLabel(node)}`}
                onClick={() => {
                  setCollapsed((prior) => {
                    const next = new Map(prior);
                    if (open) next.set(node.id, currentId);
                    else next.delete(node.id);
                    return next;
                  });
                  setOpened((prior) => {
                    const next = new Set(prior);
                    if (open) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                }}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </IconButton>
            ) : (
              <span className="w-6 shrink-0" aria-hidden="true" />
            )}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <Button
                  ref={currentId === node.id ? selected : undefined}
                  size="1"
                  color="gray"
                  variant={currentId === node.id ? "soft" : "ghost"}
                  disabled={busy}
                  onClick={() => select(node.id)}
                  aria-current={currentId === node.id ? "step" : undefined}
                  className={`m-0 h-auto min-w-0 justify-start gap-1 px-1 py-1 font-normal ${disabled ? "text-muted" : "text-move"}`}
                  title={moveLabel(node)}
                >
                  <span className="truncate">
                    {moveLabel(node)}
                    {node.nags
                      .map((nag) => annotationSymbols[nag] ?? "")
                      .join("")}
                  </span>
                  {disabled && <CircleSlash size={12} aria-label="已禁用" />}
                  {book.notes[positionKey(node.fenAfter)] && (
                    <FileText size={12} aria-label="有局面评注" />
                  )}
                </Button>
              </ContextMenu.Trigger>
              <ContextMenu.Content size="1">
                <ContextMenu.Item
                  disabled={busy || index === 0}
                  onSelect={() => promote(node.id)}
                >
                  设为主线
                </ContextMenu.Item>
                <ContextMenu.Item disabled={busy} onSelect={() => toggle(node)}>
                  {node.disabled ? "启用分支" : "禁用分支"}
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item
                  color="red"
                  disabled={busy}
                  onSelect={() => remove(node.id)}
                >
                  删除分支
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          </div>
          {open && children.length > 0 && (
            <div className="ml-3 border-l border-panel-edge pl-2">
              {render(node.id, disabled, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  }
  return (
    <div
      className="min-h-0 overflow-auto overscroll-contain p-2"
      aria-label="开局招法树"
    >
      <Button
        size="1"
        color="gray"
        variant={currentId === null ? "soft" : "ghost"}
        disabled={busy}
        onClick={() => select(null)}
        className="m-0 mb-1"
      >
        初始局面
      </Button>
      {render(null)}
      {!book.nodes.length && (
        <p className="p-2 text-sm text-muted">
          在棋盘上走棋，或导入 PGN 添加线路。
        </p>
      )}
    </div>
  );
}
