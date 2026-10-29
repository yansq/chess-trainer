import { Box, Flex, Grid } from "@radix-ui/themes";
import { lazy, Suspense } from "react";
import { NavLink, Route, Routes, Navigate, useMatch } from "react-router-dom";
import {
  ChartColumn,
  ChessKnight,
  Database,
  Settings,
  Target,
  CalendarDays,
} from "lucide-react";
const GamesPage = lazy(() => import("../features/games/GamesPage"));
const AnalysisPage = lazy(() => import("../features/analysis/AnalysisPage"));
const PuzzleCreatePage = lazy(
  () => import("../features/puzzles/PuzzleCreatePage"),
);
const PuzzleEditPage = lazy(() => import("../features/puzzles/PuzzleEditPage"));
const PuzzlesPage = lazy(() => import("../features/puzzles/PuzzlesPage"));
const ReviewPage = lazy(() => import("../features/review/ReviewPage"));
const StatisticsPage = lazy(
  () => import("../features/statistics/StatisticsPage"),
);
const SettingsPage = lazy(() => import("../features/settings/SettingsPage"));
const nav = [
  ["/games", "对局", Database],
  ["/puzzles", "题库", Target],
  ["/review", "今日训练", CalendarDays],
  ["/statistics", "统计", ChartColumn],
  ["/settings", "设置", Settings],
] as const;
export default function App() {
  const reviewingGame = useMatch("/analysis/:id");
  const creatingPuzzle = useMatch("/puzzles/new");
  const editingPuzzle = useMatch("/puzzles/:id/edit");
  return (
    <Grid className="sidebar-wide h-dvh grid-cols-shell overflow-hidden max-[900px]:sidebar-compact">
      <aside className="fixed inset-y-0 left-0 flex h-dvh w-sidebar flex-col overflow-y-auto overscroll-none border-r border-sidebar-edge bg-sidebar px-3.5 py-7">
        <Flex
          align="center"
          gap="3"
          px="3"
          pt="1"
          className="pb-8.5 text-brand-ink [&_strong]:block [&_strong]:text-brand-ink [&_strong]:tracking-brand [&_strong]:text-heading [&_small]:mt-1 [&_small]:block [&_small]:text-micro [&_small]:tracking-label [&_small]:text-brand-muted max-[900px]:px-1.25 max-[900px]:pb-7.5 max-[900px]:[&>div]:hidden"
        >
          <ChessKnight size={24} />
          <Box>
            <strong>Chess Trainer</strong>
          </Box>
        </Flex>
        <nav className="grid gap-1">
          {nav.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-3.25 rounded-nav px-3.75 py-3 text-sm no-underline max-[900px]:justify-center max-[900px]:[&>span]:hidden ${isActive || (path === "/games" && reviewingGame) ? "bg-nav-selected text-nav-selected-ink" : "text-nav-ink hover:bg-nav-hover"}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main
        className={` col-start-2 mx-auto h-full min-h-0 w-full min-w-0 max-w-400 overflow-auto overscroll-contain ${reviewingGame || editingPuzzle || creatingPuzzle ? `!overflow-hidden px-6 py-5 max-[1150px]:px-5 ${creatingPuzzle ? "max-[760px]:!overflow-auto" : ""}` : "px-10.5 pt-8.75 pb-12.5 max-[1150px]:px-6.25 max-[1150px]:py-7"}`}
      >
        <Suspense
          fallback={
            <Grid
              px="5"
              className="py-15 text-center text-empty min-h-70 place-items-center"
            >
              加载中…
            </Grid>
          }
        >
          <Routes>
            <Route path="/" element={<Navigate to="/games" />} />
            <Route path="/games" element={<GamesPage />} />
            <Route
              path="/analysis"
              element={<Navigate to="/games" replace />}
            />
            <Route
              path="/analysis/:id"
              element={<AnalysisPage key={reviewingGame?.params.id} />}
            />
            <Route path="/puzzles" element={<PuzzlesPage />} />
            <Route path="/puzzles/new" element={<PuzzleCreatePage />} />
            <Route
              path="/puzzles/:id/edit"
              element={<PuzzleEditPage key={editingPuzzle?.params.id} />}
            />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </Grid>
  );
}
