import { Fragment, useEffect, useRef } from "react";
import { moveNumber, type ReviewMove, type ReviewTree } from "./review-tree";

import { qualityBadges, type MoveQuality } from "./move-quality";

type Props = {
  tree: ReviewTree;
  analysisStatus?: string;
  onRetry?: () => void;
  qualities?: Record<string, MoveQuality>;
  onSelect: (id: string | null) => void;
  onMainline: () => void;
};

export default function MoveList({
  tree,
  qualities = {},
  analysisStatus,
  onRetry,
  onSelect,
  onMainline,
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
    return (
      <button
        ref={tree.currentId === move.id ? selectedRef : undefined}
        className={`border-none border-current justify-start font-medium ${compact ? " inline-flex gap-0.75 rounded px-1 py-0.5 text-inherit-size leading-compact align-baseline" : "px-2 py-1.5 text-body-sm"} ${tree.currentId === move.id ? " bg-selected text-selected-ink" : "bg-transparent text-move"}`}
        onClick={() => onSelect(move.id)}
        aria-label={`${move.sourceMoveId ? "主线" : "分支"} ${moveNumber(move)} ${move.san}`}
        aria-current={tree.currentId === move.id ? "step" : undefined}
      >
        {(numbered || move.fenBefore.split(" ")[1] === "w") && (
          <small
            className={`text-move-number ${compact ? "m-0 text-inherit-size" : "mr-1"}`}
          >
            {moveNumber(move)}
          </small>
        )}
        {move.san}
        {badge && (
          <span
            className={` ml-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-0.5 text-eyebrow font-bold leading-none ${badge.color}`}
            data-category={category}
            title={`${category} · ${badge.label}`}
            aria-label={badge.label}
          >
            {badge.symbol}
          </span>
        )}
      </button>
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
            <div className="col-span-full min-w-0 px-2 pb-0.75 text-xs leading-answer">
              {branches.map((branch) => (
                <Fragment key={branch.id}>{variation(branch)} </Fragment>
              ))}
            </div>
          )}
        </Fragment>,
      );
      const last: ReviewMove = (black ?? white)!;
      move = children.get(last.id)?.[0];
      if (last.sourceMoveId && move?.sourceMoveId === null) {
        rows.push(
          <div
            className="col-span-full min-w-0 px-2 pb-0.75 text-xs leading-answer"
            key={move.id}
          >
            {variation(move)}
          </div>,
        );
        break;
      }
    }
    return <div className="grid grid-cols-2 gap-1">{rows}</div>;
  }
  const first = children.get(null)?.[0];
  const hasBranches = tree.moves.some((move) => move.sourceMoveId === null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel">
      <div className="section-title shrink-0 border-b border-panel-edge px-3 py-2.5 text-body-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink flex items-center justify-between gap-2 [&_button]:px-2.25 [&_button]:py-1.25 [&_button]:text-caption">
        <div className="min-w-0 truncate" title={analysisStatus}>
          招法{" "}
          <span
            title={hasBranches ? "试走分支仅在当前复盘页面保留" : undefined}
          >
            {analysisStatus ?? (hasBranches ? "主线与试走分支" : "主线")}
          </span>
        </div>
        {onRetry && (
          <button
            className="shrink-0 border-control-edge bg-secondary text-secondary-ink"
            onClick={onRetry}
          >
            重试
          </button>
        )}
        {hasBranches && (
          <button
            className="border-control-edge bg-secondary text-secondary-ink"
            onClick={onMainline}
          >
            返回主线
          </button>
        )}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain p-2"
        ref={listRef}
      >
        <button
          ref={tree.currentId === null ? selectedRef : undefined}
          className={` mb-1 w-full justify-start border-none border-current px-2 py-1.5 text-body-sm font-medium ${tree.currentId === null ? " bg-selected text-selected-ink" : "bg-transparent text-move"}`}
          onClick={() => onSelect(null)}
        >
          初始局面
        </button>
        {first && line(first)}
      </div>
    </div>
  );
}
