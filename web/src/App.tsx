import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { ROUTES } from "./utils/routes";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { LandingPage } from "./pages/landing/LandingPage";
import { OnboardingRoot } from "./pages/onboarding/OnboardingRoot";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { AppInitializer } from "./components/shared/AppInitializer";
import ModelGate from "./components/shared/ModelGate";
import SetupModelPage from "./pages/setup/SetupModelPage";
import AssistantPage from "./pages/settings/AssistantPage";
import ModelAccessPage from "./pages/settings/ModelAccessPage";
import ModelsPage from "./pages/settings/ModelsPage";
import { ChatPage } from "./pages/chat/ChatPage";
import { SecurityDashboard } from "./pages/security/SecurityDashboard";
import { SecurityAuditPage } from "./pages/security/SecurityAuditPage";
import { PolicyEditor } from "./pages/security/PolicyEditor";
import { RolePoliciesPage } from "./pages/security/RolePoliciesPage";
import { OrgSettingsPage } from "./pages/org/OrgSettingsPage";
import { RbacPage } from "./pages/rbac/RbacPage";
import { TeamDashboard } from "./pages/team/TeamDashboard";
import { AgentManagerPage } from "./pages/agents/AgentManagerPage";
import { TasksPage } from "./pages/tasks/TasksPage";
import { MemoryPage } from "./pages/memory/MemoryPage";
import { SkillsPage } from "./pages/skills/SkillsPage";
import { CommandsPage } from "./pages/commands/CommandsPage";
import { PluginsPage } from "./pages/plugins/PluginsPage";
import { PrivacyPage } from "./pages/privacy/PrivacyPage";
import { NotificationsPage } from "./pages/notifications/NotificationsPage";
import { CronPage } from "./pages/cron/CronPage";
import { UsagePage } from "./pages/usage/UsagePage";
import { AddProviderPage } from "./pages/providers/AddProviderPage";

const router = createBrowserRouter([
  // Public — landing page (no auth required)
  {
    path: "/",
    element: <LandingPage />,
  },
  // Public — auth
  {
    path: ROUTES.LOGIN,
    element: <LoginPage />,
  },
  {
    path: ROUTES.REGISTER,
    element: <LoginPage />,
  },
  // Onboarding wizard — mounted OUTSIDE the AppShell so it has its own
  // full-screen brand layout. The wizard enforces its own auth + gate
  // logic internally (see OnboardingRoot).
  {
    path: "/onboarding",
    element: <OnboardingRoot />,
  },
  // Mandatory-model fix-it page. Lives OUTSIDE ModelGate so a user
  // with no models configured has a way to fix their own state
  // without an infinite redirect. See ModelGate's BYPASS_PATHS.
  {
    path: "/setup-model",
    element: <SetupModelPage />,
  },
  // Authenticated dashboard — moved from "/" to "/dashboard" so the
  // landing page can live at "/" for unauthenticated users.
  {
    path: "/dashboard",
    element: (
      <ModelGate>
        <AppShell />
      </ModelGate>
    ),
    children: [{ index: true, element: <ChatPage /> }],
  },
  // All other authenticated surfaces live under the same AppShell,
  // wrapped by the same mandatory-model gate.
  {
    path: "/",
    element: (
      <ModelGate>
        <AppShell />
      </ModelGate>
    ),
    children: [
      { path: "security", element: <SecurityDashboard /> },
      { path: "security/audit", element: <SecurityAuditPage /> },
      { path: "policy", element: <PolicyEditor /> },
      { path: "policy/roles", element: <RolePoliciesPage /> },
      { path: "rbac", element: <RbacPage /> },
      { path: "org", element: <OrgSettingsPage /> },
      { path: "team", element: <TeamDashboard /> },
      { path: "agents", element: <AgentManagerPage /> },
      { path: "tasks", element: <TasksPage /> },
      { path: "memory", element: <MemoryPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "commands", element: <CommandsPage /> },
      { path: "plugins", element: <PluginsPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "cron", element: <CronPage /> },
      { path: "usage", element: <UsagePage /> },
      { path: "providers/add", element: <AddProviderPage /> },
      { path: "settings/models", element: <ModelsPage /> },
      { path: "settings/assistant", element: <AssistantPage /> },
      { path: "settings/model-access", element: <ModelAccessPage /> },
    ],
  },
  // Public 403 — rendered by <ProtectedRoute> when the user lacks a
  // required capability. Never a blank page.
  { path: "/403", element: <ForbiddenPage /> },
  // Fallback — anything unknown goes back to landing
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <AppInitializer>
      <RouterProvider router={router} />
    </AppInitializer>
  );
}
