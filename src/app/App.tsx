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
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ChessKnight size={24} />
          <div>
            <strong>Chess Trainer</strong>
            <small>PERSONAL WORKSPACE</small>
          </div>
        </div>
        <nav>
          {nav.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `nav-item ${isActive || (path === "/games" && reviewingGame) ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Suspense fallback={<div className="empty full">加载中…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/games" />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/analysis" element={<Navigate to="/games" replace />} />
            <Route path="/analysis/:id" element={<AnalysisPage />} />
            <Route path="/puzzles" element={<PuzzlesPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
