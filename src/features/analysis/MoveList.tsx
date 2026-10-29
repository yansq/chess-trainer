import { Box, Button, Card, ContextMenu, Flex, Grid } from "@radix-ui/themes";
import { Fragment, useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { moveNumber, type ReviewMove, type ReviewTree } from "./review-tree";

import { qualityBadges, type MoveQuality } from "./move-quality";

type Props = {
  tree: ReviewTree;
  analysisStatus?: string;
  onRetry?: () => void;
  qualities?: Record<string, MoveQuality>;
  notes?: Record<string, string>;
  onSelect: (id: string | null) => void;
  onMainline: () => void;
  onDelete: (id: string) => void;
  deleting?: boolean;
};

export default function MoveList({
  tree,
  qualities = {},
  notes = {},
  analysisStatus,
  onRetry,
  onSelect,
  onMainline,
  onDelete,
  deleting = false,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const selected = selectedRef.current;
    if (!list || !selected) return;
    const box = list.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.top < box.top) list.scrollTop -= box.top - item.top;
    else if (item.bottom > box.bottom)
      list.scrollTop += item.bottom - box.bottom;
  }, [tree.currentId]);

  const children = new Map<string | null, ReviewMove[]>();
  for (const move of tree.moves) {
    const siblings = children.get(move.parentId) ?? [];
    siblings.push(move);
    children.set(move.parentId, siblings);
  }
  function button(
    move: ReviewMove | undefined,
    compact = false,
    numbered = false,
  ) {
    if (!move) return <span />;
    const quality = qualities[move.id];
    const category =
      quality?.fen === move.fenAfter && !quality.status
        ? quality.category
        : null;
    const badge = category ? qualityBadges[category] : null;
    const moveButton = (
      <Button
        disabled={deleting}
        size="1"
        variant={tree.currentId === move.id ? "soft" : "ghost"}
        color="gray"
        ref={tree.currentId === move.id ? selectedRef : undefined}
        className={
          compact
            ? "m-0 box-border inline-flex h-auto w-28 min-w-0 gap-1 px-1 py-0 align-baseline font-normal"
            : "m-0 box-border h-6 min-w-0 justify-start px-2 py-0 font-normal"
        }
        onClick={() => onSelect(move.id)}
        aria-label={`${move.sourceMoveId ? "主线" : "分支"} ${moveNumber(move)} ${move.san}`}
        aria-current={tree.currentId === move.id ? "step" : undefined}
      >
        {(numbered || move.fenBefore.split(" ")[1] === "w") && (
          <small
            className={`text-move-number ${compact ? "m-0 text-inherit-size" : "w-6 shrink-0 text-left"}`}
          >
            {moveNumber(move)}
          </small>
        )}
        <span className="min-w-0 flex-1 truncate text-left" title={move.san}>
          {move.san}
        </span>
        {notes[move.id]?.trim() && (
          <span
            role="img"
            aria-label="有招法笔记"
            title="有招法笔记"
            className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-note-badge px-0.5 text-eyebrow font-bold leading-none text-quality-ink"
          >
            <FileText
              className="size-2.5"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </span>
        )}
        <span
          className="inline-flex h-4 w-5 shrink-0 items-center justify-center"
          data-quality-slot
        >
          {badge && (
            <span
              className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-eyebrow font-bold leading-none ${badge.color}`}
              data-category={category}
              title={`${category} · ${badge.label}`}
              aria-label={badge.label}
            >
              {badge.symbol}
            </span>
          )}
        </span>
      </Button>
    );
    if (move.sourceMoveId !== null) return moveButton;
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger>{moveButton}</ContextMenu.Trigger>
        <ContextMenu.Content size="1">
          <ContextMenu.Label>包含后续招法和笔记</ContextMenu.Label>
          <ContextMenu.Item
            color="red"
            disabled={deleting}
            onSelect={() => onDelete(move.id)}
          >
            删除分支
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    );
  }
  function variation(first: ReviewMove) {
    const moves = [];
    let move: ReviewMove | undefined = first;
    let numbered = true;
    while (move) {
      const siblings = children.get(move.parentId) ?? [];
      const alternatives = siblings[0]?.id === move.id ? siblings.slice(1) : [];
      moves.push(
        <Fragment key={move.id}>
          {moves.length > 0 && " "}
          {button(move, true, numbered)}
          {alternatives.map((alternative) => (
            <Fragment key={alternative.id}> {variation(alternative)}</Fragment>
          ))}
        </Fragment>,
      );
      numbered = alternatives.length > 0;
      move = children.get(move.id)?.[0];
    }
    return <span className="text-engine-muted">({moves})</span>;
  }
  function line(first: ReviewMove) {
    const rows = [];
    let move: ReviewMove | undefined = first;
    while (move) {
      const white: ReviewMove | undefined =
        move.fenBefore.split(" ")[1] === "w" ? move : undefined;
      const blackCandidate: ReviewMove | undefined = white
        ? children.get(white.id)?.[0]
        : move;
      const black: ReviewMove | undefined =
        white?.sourceMoveId && blackCandidate?.sourceMoveId === null
          ? undefined
          : blackCandidate;
      const rowMoves = [white, black].filter(
        (node): node is ReviewMove => !!node,
      );
      const branches = rowMoves.flatMap((node) => {
        const siblings = children.get(node.parentId) ?? [];
        return siblings[0]?.id === node.id ? siblings.slice(1) : [];
      });
      rows.push(
        <Fragment key={move.id}>
          {button(white)}
          {button(black)}
          {branches.length > 0 && (
            <Box className="col-span-full min-w-0 px-2 pb-0.75 text-xs leading-answer">
              {branches.map((branch) => (
                <Fragment key={branch.id}>{variation(branch)} </Fragment>
              ))}
            </Box>
          )}
        </Fragment>,
      );
      const last: ReviewMove = (black ?? white)!;
      move = children.get(last.id)?.[0];
      if (last.sourceMoveId && move?.sourceMoveId === null) {
        rows.push(
          <Box
            className="col-span-full min-w-0 px-2 pb-0.75 text-xs leading-answer"
            key={move.id}
          >
            {variation(move)}
          </Box>,
        );
        break;
      }
    }
    return (
      <Grid gap="1" className="grid-cols-2">
        {rows}
      </Grid>
    );
  }
  const first = children.get(null)?.[0];
  const hasBranches = tree.moves.some((move) => move.sourceMoveId === null);
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <Flex
        align="center"
        justify="between"
        px="3"
        gap="2"
        className="section-title shrink-0 border-b border-panel-edge py-2.5 text-body-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink"
      >
        <Box className="min-w-0 truncate" title={analysisStatus}>
          招法{" "}
          <span
            title={
              hasBranches
                ? "分支招法自动保存，重新打开对局可继续复盘"
                : undefined
            }
          >
            {analysisStatus ?? (hasBranches ? "主线与试走分支" : "主线")}
          </span>
        </Box>
        {onRetry && (
          <Button
            size="1"
            variant="soft"
            className="shrink-0"
            onClick={onRetry}
          >
            重试
          </Button>
        )}
        {hasBranches && (
          <Button
            size="1"
            variant="soft"
            disabled={deleting}
            onClick={onMainline}
          >
            返回主线
          </Button>
        )}
      </Flex>
      <Box
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain p-2"
        ref={listRef}
      >
        <Button
          size="1"
          variant={tree.currentId === null ? "soft" : "ghost"}
          color="gray"
          ref={tree.currentId === null ? selectedRef : undefined}
          className="m-0 mb-1 box-border h-6 w-full justify-start px-2 py-0 font-normal"
          onClick={() => onSelect(null)}
        >
          初始局面
        </Button>
        {first && line(first)}
      </Box>
    </Card>
  );
}
