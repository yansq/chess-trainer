export const coordinateSquares = Array.from(
  { length: 64 },
  (_, index) => `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`,
);
export const coordinateDuration = 30_000;
export interface CoordinateSession {
  status: "idle" | "running" | "finished";
  deadline: number;
  remaining: number;
  score: number;
  target: string;
  wrong: string | null;
}
export const initialCoordinateSession: CoordinateSession = {
  status: "idle",
  deadline: 0,
  remaining: coordinateDuration,
  score: 0,
  target: "",
  wrong: null,
};
type Action =
  | { type: "start"; now: number; random: number }
  | { type: "tick"; now: number }
  | { type: "answer"; now: number; square: string; random: number };
function nextSquare(previous: string, random: number) {
  const choices = coordinateSquares.filter((square) => square !== previous);
  return choices[
    Math.min(
      choices.length - 1,
      Math.max(0, Math.floor(random * choices.length)),
    )
  ];
}
export function coordinateSession(
  state: CoordinateSession,
  action: Action,
): CoordinateSession {
  if (action.type === "start")
    return {
      ...initialCoordinateSession,
      status: "running",
      deadline: action.now + coordinateDuration,
      target: nextSquare("", action.random),
    };
  if (state.status !== "running") return state;
  const remaining = Math.max(0, state.deadline - action.now);
  if (!remaining)
    return { ...state, status: "finished", remaining, wrong: null };
  if (action.type === "tick") return { ...state, remaining };
  if (action.square !== state.target)
    return { ...state, remaining, wrong: action.square };
  return {
    ...state,
    remaining,
    score: state.score + 1,
    target: nextSquare(state.target, action.random),
    wrong: null,
  };
}
