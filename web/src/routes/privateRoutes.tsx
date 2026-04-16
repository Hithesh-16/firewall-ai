import { lazy, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { ROUTES } from "../utils/routes";
import { RequireAuth } from "./RequireAuth";
import { RouteFallback } from "./RouteFallback";

/**
 * Every authenticated page is lazy-loaded. The initial public bundle
 * (landing + login) is a strict subset — private chunks only download
 * when an authenticated user actually navigates to them.
 *
 * Naming convention: `import(...)` returns `{ default }` for default
 * exports and `{ NamedExport }` for named exports. We normalize named
 * exports to `{ default }` so `React.lazy` can consume either shape.
 */

const AppShell = lazy(() =>
  import("../components/layout/AppShell").then((m) => ({ default: m.AppShell })),
);
const ModelGate = lazy(() => import("../components/shared/ModelGate"));
const OnboardingRoot = lazy(() =>
  import("../pages/onboarding/OnboardingRoot").then((m) => ({
    default: m.OnboardingRoot,
  })),
);
const SetupModelPage = lazy(() => import("../pages/setup/SetupModelPage"));
const ChatPage = lazy(() =>
  import("../pages/chat/ChatPage").then((m) => ({ default: m.ChatPage })),
);

// Settings
const AssistantPage = lazy(() => import("../pages/settings/AssistantPage"));
const ModelAccessPage = lazy(() => import("../pages/settings/ModelAccessPage"));
const ModelsPage = lazy(() => import("../pages/settings/ModelsPage"));

// Security
const SecurityDashboard = lazy(() =>
  import("../pages/security/SecurityDashboard").then((m) => ({
    default: m.SecurityDashboard,
  })),
);
const SecurityAuditPage = lazy(() =>
  import("../pages/security/SecurityAuditPage").then((m) => ({
    default: m.SecurityAuditPage,
  })),
);
const PolicyEditor = lazy(() =>
  import("../pages/security/PolicyEditor").then((m) => ({
    default: m.PolicyEditor,
  })),
);

// Org / RBAC / Team
const OrgSettingsPage = lazy(() =>
  import("../pages/org/OrgSettingsPage").then((m) => ({
    default: m.OrgSettingsPage,
  })),
);
const RbacPage = lazy(() =>
  import("../pages/rbac/RbacPage").then((m) => ({ default: m.RbacPage })),
);
const TeamDashboard = lazy(() =>
  import("../pages/team/TeamDashboard").then((m) => ({
    default: m.TeamDashboard,
  })),
);

// Agents / tasks / workflow
const AgentManagerPage = lazy(() =>
  import("../pages/agents/AgentManagerPage").then((m) => ({
    default: m.AgentManagerPage,
  })),
);
const TasksPage = lazy(() =>
  import("../pages/tasks/TasksPage").then((m) => ({ default: m.TasksPage })),
);
const MemoryPage = lazy(() =>
  import("../pages/memory/MemoryPage").then((m) => ({ default: m.MemoryPage })),
);
const SkillsPage = lazy(() =>
  import("../pages/skills/SkillsPage").then((m) => ({ default: m.SkillsPage })),
);
const CommandsPage = lazy(() =>
  import("../pages/commands/CommandsPage").then((m) => ({
    default: m.CommandsPage,
  })),
);
const PluginsPage = lazy(() =>
  import("../pages/plugins/PluginsPage").then((m) => ({
    default: m.PluginsPage,
  })),
);

// Preferences
const PrivacyPage = lazy(() =>
  import("../pages/privacy/PrivacyPage").then((m) => ({
    default: m.PrivacyPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("../pages/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const CronPage = lazy(() =>
  import("../pages/cron/CronPage").then((m) => ({ default: m.CronPage })),
);
const UsagePage = lazy(() =>
  import("../pages/usage/UsagePage").then((m) => ({ default: m.UsagePage })),
);
const AddProviderPage = lazy(() =>
  import("../pages/providers/AddProviderPage").then((m) => ({
    default: m.AddProviderPage,
  })),
);

const lazyElement = (node: JSX.Element) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>;

/**
 * Private routes are only considered by the router when a token is
 * present. Each element is wrapped in `RequireAuth` as a second line
 * of defence so a bookmarked deep link also goes through the guard.
 */
export const privateRoutes: RouteObject[] = [
  // Onboarding + setup live OUTSIDE the AppShell so they can own the
  // full screen. Each still requires auth.
  {
    path: ROUTES.ONBOARDING,
    element: <RequireAuth>{lazyElement(<OnboardingRoot />)}</RequireAuth>,
  },
  {
    path: ROUTES.SETUP_MODEL,
    element: <RequireAuth>{lazyElement(<SetupModelPage />)}</RequireAuth>,
  },

  // Authenticated dashboard root — AppShell + ModelGate
  {
    path: ROUTES.DASHBOARD,
    element: (
      <RequireAuth>
        {lazyElement(
          <ModelGate>
            <AppShell />
          </ModelGate>,
        )}
      </RequireAuth>
    ),
    children: [{ index: true, element: lazyElement(<ChatPage />) }],
  },

  // All other authenticated surfaces — same guard + shell, different
  // root so nested paths like /security, /org, /settings/models work.
  {
    path: "/",
    element: (
      <RequireAuth>
        {lazyElement(
          <ModelGate>
            <AppShell />
          </ModelGate>,
        )}
      </RequireAuth>
    ),
    children: [
      { path: "security", element: lazyElement(<SecurityDashboard />) },
      { path: "security/audit", element: lazyElement(<SecurityAuditPage />) },
      { path: "policy", element: lazyElement(<PolicyEditor />) },
      { path: "policy/roles", element: <Navigate to={ROUTES.RBAC} replace /> },
      { path: "rbac", element: lazyElement(<RbacPage />) },
      { path: "org", element: lazyElement(<OrgSettingsPage />) },
      { path: "team", element: lazyElement(<TeamDashboard />) },
      { path: "agents", element: lazyElement(<AgentManagerPage />) },
      { path: "tasks", element: lazyElement(<TasksPage />) },
      { path: "memory", element: lazyElement(<MemoryPage />) },
      { path: "skills", element: lazyElement(<SkillsPage />) },
      { path: "commands", element: lazyElement(<CommandsPage />) },
      { path: "plugins", element: lazyElement(<PluginsPage />) },
      { path: "privacy", element: lazyElement(<PrivacyPage />) },
      { path: "notifications", element: lazyElement(<NotificationsPage />) },
      { path: "cron", element: lazyElement(<CronPage />) },
      { path: "usage", element: lazyElement(<UsagePage />) },
      { path: "providers/add", element: lazyElement(<AddProviderPage />) },
      { path: "settings/models", element: lazyElement(<ModelsPage />) },
      { path: "settings/assistant", element: lazyElement(<AssistantPage />) },
      {
        path: "settings/model-access",
        element: lazyElement(<ModelAccessPage />),
      },
    ],
  },
];
