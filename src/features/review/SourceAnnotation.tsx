import { Box, Button } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { Puzzle } from "../../shared/types";
import { findSourceAnnotation } from "./source-annotation";

type State =
  | { status: "loading" }
  | { status: "loaded"; content: string | null }
  | { status: "error" };

export default function SourceAnnotation({ puzzle }: { puzzle: Puzzle }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!puzzle.sourceGameId) return;
    let active = true;
    Promise.all([
      api.getGame(puzzle.sourceGameId),
      api.getAnnotations(puzzle.sourceGameId),
    ])
      .then(([game, annotations]) => {
        if (active)
          setState({
            status: "loaded",
            content: findSourceAnnotation(puzzle, game, annotations),
          });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [puzzle, retry]);
  if (!puzzle.sourceGameId || (state.status === "loaded" && !state.content))
    return null;
  return (
    <section
      className="mt-5 border-t border-control-edge pt-4 [&_h3]:mb-2 [&_h3]:mt-0 [&_h3]:text-sm [&_h3]:font-control"
      aria-label="来源局面注释"
    >
      <h3>来源局面注释</h3>
      {state.status === "loading" && (
        <p className="text-muted" role="status">
          正在加载注释…
        </p>
      )}
      {state.status === "loaded" && (
        <Box className="whitespace-pre-wrap wrap-anywhere text-body-sm leading-annotation text-move">
          {state.content}
        </Box>
      )}
      {state.status === "error" && (
        <>
          <p className="text-muted">来源注释暂时无法加载。</p>
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              setState({ status: "loading" });
              setRetry((value) => value + 1);
            }}
          >
            重试加载注释
          </Button>
        </>
      )}
    </section>
  );
}
