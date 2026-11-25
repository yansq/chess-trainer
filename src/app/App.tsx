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
  Eye,
  Sun,
  BookOpen,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppearance } from "../shared/ui/AppTheme";
import { useSidebarPreference } from "../shared/ui/sidebar";

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

const navGroups = [
  {
    label: "复盘",
    items: [
      ["/games", "对局", Database],
      ["/repertoires", "开局库", BookOpen],
    ],
  },
  {
    label: "训练",
    items: [
      ["/puzzles", "题库", Target],
      ["/review", "今日训练", CalendarDays],
      ["/visualization", "可视化训练", Eye],
    ],
  },
  {
    label: "洞察",
    items: [
      ["/statistics", "统计", ChartColumn],
      ["/settings", "设置", Settings],
    ],
  },
] as const;

export default function App() {
  const sidebarCollapsed = useSidebarPreference((s) => s.collapsed);
  const toggleSidebar = useSidebarPreference((s) => s.toggle);
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
      <aside className="sidebar-surface sidebar-motion fixed inset-y-0 left-0 flex h-dvh w-sidebar flex-col overflow-x-hidden overflow-y-auto overscroll-none border-r border-sidebar-edge px-3 pt-5 pb-2.5">
        <Flex
          align="center"
          className="sidebar-motion relative mb-6 h-11 shrink-0 gap-3 px-1 text-brand-ink"
        >
          <Flex
            align="center"
            justify="center"
            className="size-9 shrink-0 rounded-control border border-brand-badge-edge bg-brand-badge text-accent-ink"
          >
            <ChessKnight size={18} aria-hidden="true" />
          </Flex>
          <Box
            aria-hidden={sidebarCollapsed}
            className={`sidebar-motion min-w-0 overflow-hidden whitespace-nowrap ${sidebarCollapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}
          >
            <strong className="font-brand-display block text-brand leading-tight font-semibold tracking-brand text-brand-ink">
              Chess Trainer
            </strong>
            <span className="block text-micro tracking-eyebrow text-brand-muted uppercase">
              Study Atelier
            </span>
          </Box>
        </Flex>

        <nav
          id="app-navigation"
          aria-label="主导航"
          className="flex flex-1 flex-col gap-5"
        >
          {navGroups.map((group, groupIndex) => (
            <Box key={group.label} className="grid gap-1">
              {sidebarCollapsed ? (
                groupIndex > 0 && (
                  <Box
                    aria-hidden="true"
                    className="mx-2 mb-1 h-px bg-sidebar-edge"
                  />
                )
              ) : (
                <Box
                  aria-hidden="true"
                  className="px-3 pb-1 text-eyebrow font-medium tracking-eyebrow text-eyebrow-ink"
                >
                  {group.label}
                </Box>
              )}
              {group.items.map(([path, label, Icon]) => (
                <NavLink
                  key={path}
                  to={path}
                  state={
                    path === "/games" && reviewingGame?.params.id
                      ? { returnGameId: reviewingGame.params.id }
                      : undefined
                  }
                  aria-label={label}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-nav px-3 py-2 text-sm no-underline ${isActive || (path === "/games" && reviewingGame) ? "nav-item-active nav-item-active-bar" : "text-nav-ink hover:bg-nav-hover hover:text-app"}`
                  }
                >
                  <Icon size={17} className="shrink-0" />
                  <span
                    aria-hidden={sidebarCollapsed}
                    className={`sidebar-motion whitespace-nowrap ${sidebarCollapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}
                  >
                    {label}
                  </span>
                </NavLink>
              ))}
            </Box>
          ))}
        </nav>

        <Flex
          align="center"
          justify={sidebarCollapsed ? "center" : "between"}
          direction={sidebarCollapsed ? "column" : "row"}
          className="mt-4 gap-1.5 border-t border-sidebar-edge pt-2.5"
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={themeAction}
            title={themeAction}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-nav px-2 text-xs text-nav-ink transition-colors hover:bg-nav-hover hover:text-app focus-visible:outline-2 focus-visible:outline-focus"
          >
            {appearance === "light" ? (
              <Sun size={16} className="shrink-0" />
            ) : (
              <MoonStar size={16} className="shrink-0" />
            )}
            {!sidebarCollapsed && (
              <span className="whitespace-nowrap">
                {appearance === "light" ? "浅色" : "深色"}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarAction}
            title={sidebarAction}
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-navigation"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-nav text-nav-ink transition-colors hover:bg-nav-hover hover:text-app focus-visible:outline-2 focus-visible:outline-focus"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={17} className="shrink-0" />
            ) : (
              <PanelLeftClose size={17} className="shrink-0" />
            )}
          </button>
        </Flex>
      </aside>

      <main
        className={`workspace-surface col-start-2 mx-auto h-full min-h-0 w-full min-w-0 max-w-400 overflow-auto overscroll-contain ${reviewingGame || editingPuzzle || creatingPuzzle || editingRepertoire ? `!overflow-hidden px-6 py-5 max-[1150px]:px-5 ${creatingPuzzle ? "max-[760px]:!overflow-auto" : ""}` : "px-8 pt-7 pb-8 max-[1150px]:px-6 max-[1150px]:py-6"}`}
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
