import { Fragment, useEffect, useRef } from "react";
import { moveNumber, type ReviewMove, type ReviewTree } from "./review-tree";

type Props = {
  tree: ReviewTree;
  onSelect: (id: string | null) => void;
  onMainline: () => void;
};

export default function MoveList({ tree, onSelect, onMainline }: Props) {
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
    return (
      <button
        ref={tree.currentId === move.id ? selectedRef : undefined}
        className={`${compact ? "pgn-move" : ""} ${tree.currentId === move.id ? "selected" : ""}`}
        onClick={() => onSelect(move.id)}
        aria-label={`${move.sourceMoveId ? "主线" : "分支"} ${moveNumber(move)} ${move.san}`}
        aria-current={tree.currentId === move.id ? "step" : undefined}
      >
        {(numbered || move.fenBefore.split(" ")[1] === "w") && (
          <small>{moveNumber(move)}</small>
        )}
        {move.san}
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
    return <span className="pgn-variation">({moves})</span>;
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
            <div className="move-branches">
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
          <div className="move-branches" key={move.id}>
            {variation(move)}
          </div>,
        );
        break;
      }
    }
    return <div className="moves-grid">{rows}</div>;
  }
  const first = children.get(null)?.[0];
  const hasBranches = tree.moves.some((move) => move.sourceMoveId === null);
  return (
    <div className="panel moves-panel">
      <div className="section-title moves-heading">
        <div>
          招法{" "}
          <span
            title={hasBranches ? "试走分支仅在当前复盘页面保留" : undefined}
          >
            {hasBranches ? "主线与试走分支" : "主线"}
          </span>
        </div>
        {hasBranches && (
          <button className="secondary" onClick={onMainline}>
            返回主线
          </button>
        )}
      </div>
      <div className="moves-list" ref={listRef}>
        <button
          ref={tree.currentId === null ? selectedRef : undefined}
          className={`initial-position ${tree.currentId === null ? "selected" : ""}`}
          onClick={() => onSelect(null)}
        >
          初始局面
        </button>
        {first && line(first)}
      </div>
    </div>
  );
}
