import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button, ContextMenu } from "@radix-ui/themes";
import { CircleSlash, FileText, Minus, Plus } from "lucide-react";
import {
  buildRepertoireChains,
  chainMoveLabel,
  moveLabel,
  pathTo,
  positionKey,
  type Repertoire,
  type RepertoireChain,
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

function collectDefaultOpenIds(chains: RepertoireChain[]) {
  const all: string[] = [];
  const roots: string[] = [];
  function walk(list: RepertoireChain[], isRoot: boolean) {
    for (const chain of list) {
      if (chain.children.length > 0) {
        all.push(chain.tail.id);
        if (isRoot) roots.push(chain.tail.id);
        walk(chain.children, false);
      }
    }
  }
  walk(chains, true);
  return all.length <= 200 ? all : roots;
}

export default memo(function RepertoireTree({
  book,
  currentId,
  busy,
  select,
  toggle,
  promote,
  remove,
}: Props) {
  const chains = useMemo(() => buildRepertoireChains(book), [book]);
  const defaultOpenIds = useMemo(() => collectDefaultOpenIds(chains), [chains]);
  const [opened, setOpened] = useState<Set<string> | null>(() =>
    defaultOpenIds.length ? new Set(defaultOpenIds) : null,
  );
  const [collapsed, setCollapsed] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  const effectiveOpened = useMemo(
    () => opened ?? new Set(defaultOpenIds),
    [opened, defaultOpenIds],
  );
  const selected = useRef<HTMLButtonElement>(null);
  const path = useMemo(
    () =>
      new Set(
        pathTo(book, currentId)
          .slice(0, -1)
          .map((n) => n.id),
      ),
    [book, currentId],
  );

  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  function renderChains(
    list: RepertoireChain[],
    inactive = false,
    isRoot = true,
  ): React.ReactNode {
    return list.map((chain) => {
      const hasChildren = chain.children.length > 0;
      const tailId = chain.tail.id;
      const open =
        hasChildren &&
        !(collapsed.has(tailId) && collapsed.get(tailId) === currentId) &&
        (effectiveOpened.has(tailId) ||
          path.has(tailId) ||
          tailId === currentId);

      let branchDisabled = inactive;
      const moveItems = chain.nodes.map((node, nodeIndex) => {
        const nodeDisabled = branchDisabled || node.disabled;
        branchDisabled = nodeDisabled;
        const previous = nodeIndex > 0 ? chain.nodes[nodeIndex - 1] : undefined;
        const label = chainMoveLabel(node, previous);
        const nags = node.nags
          .map((nag) => annotationSymbols[nag] ?? "")
          .join("");
        const hasNote = Boolean(book.notes[positionKey(node.fenAfter)]);
        const isSelected = currentId === node.id;

        return (
          <ContextMenu.Root key={node.id}>
            <ContextMenu.Trigger>
              <button
                ref={isSelected ? selected : undefined}
                type="button"
                disabled={busy}
                onClick={() => select(node.id)}
                aria-current={isSelected ? "step" : undefined}
                title={moveLabel(node)}
                className={`inline-flex items-center gap-0.5 rounded-control-sm px-0.5 py-0.5 text-left text-body-sm leading-compact transition-colors hover:bg-nav-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 ${
                  isSelected
                    ? "bg-selected font-semibold text-accent-ink"
                    : nodeDisabled
                      ? "text-muted"
                      : "font-normal text-move"
                }`}
              >
                <span>
                  {label}
                  {nags}
                </span>
                {nodeDisabled && (
                  <CircleSlash
                    size={11}
                    className="shrink-0"
                    aria-label="已禁用"
                  />
                )}
                {hasNote && (
                  <FileText
                    size={11}
                    className="shrink-0"
                    aria-label="有局面评注"
                  />
                )}
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Content size="1">
              <ContextMenu.Item
                disabled={
                  busy || (nodeIndex === 0 ? chain.siblingIndex === 0 : true)
                }
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
        );
      });

      const branchClass = isRoot
        ? "cv-row"
        : hasChildren
          ? "repertoire-chain-branch repertoire-chain-branch-parent"
          : "repertoire-chain-branch";

      return (
        <div key={chain.head.id} className={branchClass}>
          <div
            className={
              open
                ? "repertoire-chain-row repertoire-chain-row-open"
                : "repertoire-chain-row"
            }
          >
            {hasChildren && (
              <button
                type="button"
                className="repertoire-tree-toggle"
                aria-label={`${open ? "折叠" : "展开"} ${moveLabel(chain.tail)}`}
                aria-expanded={open}
                onClick={() => {
                  setCollapsed((prior) => {
                    const next = new Map(prior);
                    if (open) next.set(tailId, currentId);
                    else next.delete(tailId);
                    return next;
                  });
                  setOpened((prior) => {
                    const next = new Set(prior ?? defaultOpenIds);
                    if (open) next.delete(tailId);
                    else next.add(tailId);
                    return next;
                  });
                }}
              >
                {open ? <Minus size={10} /> : <Plus size={10} />}
              </button>
            )}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-0.5 gap-y-0.5">
              {moveItems}
            </div>
          </div>
          {open && (
            <div>{renderChains(chain.children, branchDisabled, false)}</div>
          )}
          {chain.truncated && (
            <p className="py-0.5 text-xs text-muted">
              线路过深，请使用棋盘导航查看。
            </p>
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
      {renderChains(chains)}
      {!book.nodes.length && (
        <p className="p-2 text-sm text-muted">
          在棋盘上走棋，或导入 PGN 添加线路。
        </p>
      )}
    </div>
  );
});
