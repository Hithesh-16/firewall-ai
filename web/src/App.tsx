import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { ROUTES } from "./utils/routes";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { ChatPage } from "./pages/chat/ChatPage";
import { SecurityDashboard } from "./pages/security/SecurityDashboard";
import { SecurityAuditPage } from "./pages/security/SecurityAuditPage";
import { PolicyEditor } from "./pages/security/PolicyEditor";
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
  {
    path: ROUTES.LOGIN,
    element: <LoginPage />,
  },
  {
    path: ROUTES.REGISTER,
    element: <LoginPage />,
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "security", element: <SecurityDashboard /> },
      { path: "security/audit", element: <SecurityAuditPage /> },
      { path: "policy", element: <PolicyEditor /> },
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
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
