import { RouterProvider, createMemoryRouter, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import { MainEditorProvider } from "./components/mainInput/TipTapEditor";
import { SubmenuContextProvidersProvider } from "./context/SubmenuContextProviders";
import { VscThemeProvider } from "./context/VscTheme";
import { TourProvider } from "./components/Tour/TourProvider";
import ParallelListeners from "./hooks/ParallelListeners";
import ConfigPage from "./pages/config";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import History from "./pages/history";
import LoginPage from "./pages/login";
import OrgSettingsPage from "./pages/org";
import SecurityPage from "./pages/security";
import FirstLookPage from "./pages/security/FirstLookPage";
import OnboardingPage from "./pages/onboarding";
import RbacPage from "./pages/rbac";
import Stats from "./pages/stats";
import AgentManagerPage from "./pages/agents";
import TeamDashboard from "./pages/team";
import TasksPage from "./pages/tasks";
import MemoryPage from "./pages/memory";
import SetupWizardPage from "./pages/setup";
import ThemePage from "./styles/ThemePage";
import { ROUTES } from "./util/navigation";
import { isInIde } from "./util";

// ── Route definitions ──────────────────────────────────────────────────

/** Routes available in ALL environments (IDE + standalone web) */
const coreRoutes = [
  { path: "/index.html", element: <Chat /> },
  { path: ROUTES.HOME, element: <Chat /> },
  { path: "/history", element: <History /> },
  { path: ROUTES.STATS, element: <Stats /> },
  { path: ROUTES.CONFIG, element: <ConfigPage /> },
  { path: ROUTES.THEME, element: <ThemePage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
];

/** Routes only available in the standalone web dashboard (NOT in IDE webview) */
const webOnlyRoutes = [
  { path: ROUTES.SECURITY, element: <SecurityPage /> },
  { path: ROUTES.FIRST_LOOK, element: <FirstLookPage /> },
  { path: "/rbac", element: <RbacPage /> },
  { path: ROUTES.ORG, element: <OrgSettingsPage /> },
  { path: ROUTES.TEAM, element: <TeamDashboard /> },
  { path: ROUTES.AGENTS, element: <AgentManagerPage /> },
  { path: ROUTES.TASKS, element: <TasksPage /> },
  { path: ROUTES.MEMORY, element: <MemoryPage /> },
  { path: ROUTES.SETUP, element: <SetupWizardPage /> },
];

/** Redirect for web-only routes when accessed inside IDE */
const webOnlyRedirects = webOnlyRoutes.map((route) => ({
  path: route.path,
  element: <Navigate to={ROUTES.HOME} replace />,
}));

// Build routes based on environment
const inIde = isInIde();
const childRoutes = inIde
  ? [...coreRoutes, ...webOnlyRedirects]
  : [...coreRoutes, ...webOnlyRoutes];

const router = createMemoryRouter([
  {
    path: ROUTES.LOGIN,
    element: <LoginPage />,
  },
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: childRoutes,
  },
]);

/*
  ParallelListeners prevents entire app from rerendering on any change in the listeners,
  most of which interact with redux etc.
*/
function App() {
  return (
    <VscThemeProvider>
      <MainEditorProvider>
        <SubmenuContextProvidersProvider>
          <TourProvider>
            <RouterProvider router={router} />
          </TourProvider>
        </SubmenuContextProvidersProvider>
      </MainEditorProvider>
      <ParallelListeners />
    </VscThemeProvider>
  );
}

export default App;
