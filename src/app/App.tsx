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
  const editingPuzzle = useMatch("/puzzles/:id/edit");
  return (
    <div className="shell [--sidebar-width:220px] h-dvh grid grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden max-[900px]:[--sidebar-width:64px]">
      <aside className="sidebar fixed inset-y-0 left-0 flex h-dvh w-[var(--sidebar-width)] flex-col overflow-y-auto overscroll-none border-r border-[#283739] bg-sidebar px-[14px] py-7">
        <div className="brand flex items-center gap-3 px-3 pt-1 pb-[34px] text-[#a2cbaa] [&_strong]:block [&_strong]:text-[17px] [&_strong]:tracking-[-0.03em] [&_strong]:text-[#f2f6f3] [&_small]:mt-1 [&_small]:block [&_small]:text-[9px] [&_small]:tracking-[0.18em] [&_small]:text-[#718581] max-[900px]:px-[5px] max-[900px]:pb-[30px] max-[900px]:[&>div]:hidden">
          <ChessKnight size={24} />
          <div>
            <strong>Chess Trainer</strong>
          </div>
        </div>
        <nav className="grid gap-1">
          {nav.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `nav-item flex items-center gap-[13px] rounded-[9px] px-[15px] py-3 text-[14px] no-underline max-[900px]:justify-center max-[900px]:[&>span]:hidden ${isActive || (path === "/games" && reviewingGame) ? "active bg-[#263a35] text-[#c6e8ce]" : "text-[#a2b0ad] hover:bg-[#1e2b2d]"}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main
        className={`main col-start-2 mx-auto h-full min-h-0 w-full min-w-0 max-w-[1600px] overflow-auto overscroll-contain ${reviewingGame || editingPuzzle ? "!overflow-hidden px-6 py-5 max-[1150px]:px-5" : "px-[42px] pt-[35px] pb-[50px] max-[1150px]:px-[25px] max-[1150px]:py-7"}`}
      >
        <Suspense
          fallback={
            <div className="empty full px-5 py-[60px] text-center text-[#829591] grid min-h-[280px] place-items-center">
              加载中…
            </div>
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
    </div>
  );
}
