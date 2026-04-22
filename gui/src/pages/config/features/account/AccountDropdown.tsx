import {
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  UserCircleIcon as UserCircleIconOutline,
} from "@heroicons/react/24/outline";
import { useContext } from "react";

import { AfPulseHalo } from "../../../../components/loaders/AfPulseHalo";
import { ToolTip } from "../../../../components/gui/Tooltip";
import {
  Button,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../../../../components/ui";
import { Divider } from "../../../../components/ui/Divider";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAiFirewallAuth } from "../../../../hooks/useAiFirewallAuth";
import { useAppSelector } from "../../../../redux/hooks";

/**
 * Sidebar profile icon + account dropdown.
 *
 * Source of truth is `useAiFirewallAuth` (the extension-side
 * AiFirewallAuthService, reflected to the webview via the
 * aiFirewall/authState push + aiFirewall/getAuthState pull). This is
 * now the single sign-in/out surface in the IDE sidebar — the old
 * bottom-strip AuthStatusBar was removed to collapse to one canonical
 * entry point.
 *
 * Click behaviour:
 *   - When signed out → button opens the `aiFirewall.login` command
 *     (web-first loopback flow). It does NOT invoke the legacy hub
 *     `useAuth().login()` (that's what used to re-trigger login even
 *     when the user was already signed in).
 *   - When signed in → Listbox opens a dropdown; logout is a menu
 *     item, never an incidental click side-effect.
 */
export function AccountDropdown() {
  const ideMessenger = useContext(IdeMessengerContext);
  const auth = useAiFirewallAuth();
  // P4 polish: swap the static green dot for an AfPulseHalo driven
  // by live proxy-health from the security slice. Green pulse →
  // proxy reachable and scanning; red static → unreachable.
  const proxyHealthy = useAppSelector((s) => s.security.proxyHealthy);

  // Hide the button during the tiny window between webview boot and
  // the first IPC round-trip so a cold start doesn't flash "Sign in"
  // before the hook discovers the user is already authenticated.
  if (!auth.ready) {
    return (
      <span
        aria-label="Loading account"
        className="text-description-muted flex items-center gap-2 px-2 py-1.5"
      >
        <UserCircleIconOutline className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0 opacity-50" />
      </span>
    );
  }

  if (!auth.signedIn) {
    return (
      <ToolTip content="Sign in to AI Firewall" className="text-xs md:!hidden">
        <Button
          variant="ghost"
          className="text-description flex w-full flex-row items-center gap-2 px-2 py-1.5"
          onClick={() =>
            ideMessenger.post("openUrl", "command:aiFirewall.login")
          }
        >
          <UserCircleIconOutline className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
          <span className="text-description hidden text-xs md:block">
            Sign in
          </span>
        </Button>
      </ToolTip>
    );
  }

  const email = auth.email ?? "Signed in";
  const initial = email ? email[0].toUpperCase() : "?";
  const truncatedEmail = email.length > 28 ? email.slice(0, 26) + "…" : email;

  return (
    <div>
      <Listbox>
        {({ open }) => (
          <>
            <ListboxButton
              className={`text-description w-full items-center justify-start gap-2 border-none px-2 py-1.5 ${
                open ? "bg-input" : "hover:bg-input bg-inherit"
              }`}
            >
              <span
                aria-hidden
                className="bg-primary/20 text-primary flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              >
                {initial}
              </span>
              <AfPulseHalo
                size="sm"
                tone={proxyHealthy ? "accent" : "danger"}
                inactive={!proxyHealthy}
              >
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    proxyHealthy ? "bg-af-accent" : "bg-af-danger"
                  }`}
                  title={
                    proxyHealthy
                      ? "Proxy online — firewall active"
                      : "Proxy unreachable"
                  }
                />
              </AfPulseHalo>
              <span className="text-foreground hidden min-w-0 flex-1 truncate text-left text-xs md:block">
                {truncatedEmail}
              </span>
            </ListboxButton>
            <ListboxOptions anchor="right end">
              {/* Header with full email (visible on all screen sizes) */}
              <div className="border-border border-b px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="bg-primary/20 text-primary flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    {initial}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-foreground truncate text-xs font-medium">
                      {email}
                    </span>
                    <span className="text-description-muted text-[10px]">
                      Signed in to AI Firewall
                    </span>
                  </div>
                </div>
              </div>

              <ListboxOption
                onClick={() =>
                  ideMessenger.post(
                    "openUrl",
                    "command:aiFirewall.viewDashboard",
                  )
                }
                value="open-dashboard"
              >
                <div className="flex items-center gap-2 py-0.5">
                  <Cog6ToothIcon className="h-3.5 w-3.5" />
                  <span>Security Dashboard</span>
                </div>
              </ListboxOption>

              <Divider />

              <ListboxOption
                onClick={() =>
                  ideMessenger.post("openUrl", "command:aiFirewall.logout")
                }
                value="logout"
              >
                <div className="flex items-center gap-2 py-0.5">
                  <ArrowRightStartOnRectangleIcon className="h-3.5 w-3.5" />
                  <span>Sign out</span>
                </div>
              </ListboxOption>
            </ListboxOptions>
          </>
        )}
      </Listbox>
    </div>
  );
}
