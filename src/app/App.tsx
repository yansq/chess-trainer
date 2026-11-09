import { Box, Flex, Grid } from "@radix-ui/themes";
import { lazy, Suspense, useState } from "react";
import { NavLink, Route, Routes, Navigate, useMatch } from "react-router-dom";
import {
  ChartColumn,
  ChessKnight,
  Database,
  Settings,
  Target,
  CalendarDays,
  Eye,
  Sun,
  BookOpen,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppearance } from "../shared/ui/AppTheme";
const RepertoirePage = lazy(
  () => import("../features/repertoire/RepertoirePage"),
);
const GamesPage = lazy(() => import("../features/games/GamesPage"));
const AnalysisPage = lazy(() => import("../features/analysis/AnalysisPage"));
const PuzzleCreatePage = lazy(
  () => import("../features/puzzles/PuzzleCreatePage"),
);
const PuzzleEditPage = lazy(() => import("../features/puzzles/PuzzleEditPage"));
const PuzzlesPage = lazy(() => import("../features/puzzles/PuzzlesPage"));
const ReviewPage = lazy(() => import("../features/review/ReviewPage"));
const VisualizationPage = lazy(
  () => import("../features/visualization/VisualizationPage"),
);
const StatisticsPage = lazy(
  () => import("../features/statistics/StatisticsPage"),
);
const SettingsPage = lazy(() => import("../features/settings/SettingsPage"));
const nav = [
  ["/games", "对局", Database],
  ["/repertoires", "开局库", BookOpen],
  ["/puzzles", "题库", Target],
  ["/review", "今日训练", CalendarDays],
  ["/visualization", "可视化训练", Eye],
  ["/statistics", "统计", ChartColumn],
  ["/settings", "设置", Settings],
] as const;
export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem("chess-trainer-sidebar-collapsed");
      if (saved !== null) return saved === "true";
    } catch {
      // Keep the sidebar usable when storage is unavailable.
    }
    return window.matchMedia("(max-width: 900px)").matches;
  });
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("chess-trainer-sidebar-collapsed", String(next));
    } catch {
      // The current view can still be toggled without persistence.
    }
  }
  const sidebarAction = sidebarCollapsed ? "展开侧栏" : "收起侧栏";
  const { appearance, toggle } = useAppearance();
  const themeAction =
    appearance === "dark" ? "切换为浅色模式" : "切换为深色模式";
  const reviewingGame = useMatch("/analysis/:id");
  const creatingPuzzle = useMatch("/puzzles/new");
  const editingRepertoire = useMatch("/repertoires");
  const editingPuzzle = useMatch("/puzzles/:id/edit");
  return (
    <Grid
      className={`${sidebarCollapsed ? "sidebar-compact" : "sidebar-wide"} sidebar-motion h-dvh grid-cols-shell overflow-hidden`}
    >
      <aside className="fixed inset-y-0 left-0 flex h-dvh w-sidebar sidebar-motion flex-col overflow-x-hidden overflow-y-auto overscroll-none border-r border-sidebar-edge bg-sidebar px-3 py-6">
        <Flex
          className={`sidebar-motion relative shrink-0 text-brand-ink ${sidebarCollapsed ? "h-24" : "h-16"}`}
        >
          <ChessKnight size={20} className="absolute top-1 left-1" />
          <Box
            aria-hidden={sidebarCollapsed}
            className={`sidebar-motion absolute top-1 left-8 whitespace-nowrap ${sidebarCollapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}
          >
            <strong className="font-medium tracking-brand">
              Chess Trainer
            </strong>
          </Box>
          <button
            type="button"
            onClick={toggle}
            aria-label={themeAction}
            title={themeAction}
            className={`sidebar-motion absolute top-0 right-0 flex size-8 shrink-0 items-center justify-center rounded-nav text-nav-ink hover:bg-nav-hover focus-visible:outline-2 focus-visible:outline-focus ${sidebarCollapsed ? "-translate-x-0.5 translate-y-7" : "translate-x-0 translate-y-0"}`}
          >
            {appearance === "light" ? (
              <Sun size={20} />
            ) : (
              <MoonStar size={20} />
            )}
          </button>
        </Flex>
        <nav id="app-navigation" aria-label="主导航" className="grid gap-1">
          {nav.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-nav px-3 py-2 text-sm no-underline ${isActive || (path === "/games" && reviewingGame) ? "bg-nav-selected text-nav-selected-ink" : "text-nav-ink hover:bg-nav-hover"}`
              }
            >
              <Icon size={18} className="shrink-0" />
              <span
                aria-hidden={sidebarCollapsed}
                className={`sidebar-motion whitespace-nowrap ${sidebarCollapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}
              >
                {label}
              </span>
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarAction}
          title={sidebarAction}
          aria-expanded={!sidebarCollapsed}
          aria-controls="app-navigation"
          className="mt-auto flex items-center gap-3 rounded-nav px-3 py-2 text-sm text-nav-ink hover:bg-nav-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} className="shrink-0" />
          ) : (
            <PanelLeftClose size={18} className="shrink-0" />
          )}
          <span
            aria-hidden={sidebarCollapsed}
            className={`sidebar-motion whitespace-nowrap ${sidebarCollapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}
          >
            {sidebarAction}
          </span>
        </button>
      </aside>
      <main
        className={` col-start-2 mx-auto h-full min-h-0 w-full min-w-0 max-w-400 overflow-auto overscroll-contain ${reviewingGame || editingPuzzle || creatingPuzzle || editingRepertoire ? `!overflow-hidden px-6 py-5 max-[1150px]:px-5 ${creatingPuzzle ? "max-[760px]:!overflow-auto" : ""}` : "px-8 pt-6 pb-8 max-[1150px]:px-6 max-[1150px]:py-6"}`}
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
            <Route path="/repertoires" element={<RepertoirePage />} />
            <Route path="/puzzles" element={<PuzzlesPage />} />
            <Route path="/puzzles/new" element={<PuzzleCreatePage />} />
            <Route
              path="/puzzles/:id/edit"
              element={<PuzzleEditPage key={editingPuzzle?.params.id} />}
            />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/visualization" element={<VisualizationPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </Grid>
  );
}
