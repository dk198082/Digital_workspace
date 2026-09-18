import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { Sidebar, type SidebarApp } from "@/components/Sidebar";
import { WorkspaceTabs, type OpenTab } from "@/components/WorkspaceTabs";
import type { AuthUser } from "@/App";

interface MyAppsResponse {
  userName: string;
  apps: SidebarApp[];
}

function useMyApps() {
  return useQuery<MyAppsResponse>({
    queryKey: ["my-apps"],
    queryFn: async () => {
      const res = await fetch("/api/my-apps", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load your apps");
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/";
}

/**
 * No top horizontal header anymore — everything that used to live there
 * (brand, signed-in user, sign-out) now lives inside the Sidebar column
 * (see Sidebar.tsx: a compact header row at its top, a footer row at its
 * bottom). That's a deliberate trade: it gives the embedded app's content
 * area the FULL window height instead of sharing a row with shell chrome —
 * the whole point being that once you're inside an app, it should feel like
 * you have the whole window, not a shell wrapped around a smaller one.
 */
export function Workspace({ user }: { user: AuthUser }) {
  const { data, isLoading, isError } = useMyApps();
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);

  const openApp = useCallback((app: SidebarApp) => {
    
  const isFieldService = app.name === "Field Service Calendar";
  const isProductionShopFloor = app.name === "Production Shop Floor";

  setOpenTabs((prev) => {
    // If the tab is already open, just activate it.
    if (prev.some((t) => t.app.id === app.id)) {
      return prev;
    }

    // Start Field Service SSO directly from the user's click.
    if (isFieldService || isProductionShopFloor) {
      const loginPath = isFieldService
        ? "/api/login?embedded=1"
        : "/api/auth/login?embedded=1";

      const loginUrl = `${app.launchUrl.replace(/\/$/, "")}${loginPath}`;

      const popupWidth = 480;
      const popupHeight = 600;

      const Center = Math.max(
        0,
        Math.round((window.screen.availWidth - popupWidth) / 2),
      );

      const top = Math.max(
        0,
        Math.round((window.screen.availHeight - popupHeight) / 2),
      );

      const popup = window.open(
        loginUrl,
        "fieldservice-sso",
        [
          `width=${popupWidth}`,
          `height=${popupHeight}`,
          `Center=${Center}`,
          `top=${top}`,
          "resizable=yes",
          "scrollbars=yes",
        ].join(","),
      );

      if (popup) {
        popup.focus();
      }
    }

    return [...prev, { app }];
  });

  setActiveAppId(app.id);
}, []);

  const closeTab = useCallback(
    (appId: number) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.app.id !== appId);
        if (activeAppId === appId) {
          setActiveAppId(next.length > 0 ? next[next.length - 1]!.app.id : null);
        }
        return next;
      });
    },
    [activeAppId],
  );

  const userName = data?.userName ?? user.name;

  return (
    <div className="flex h-[100dvh] bg-ws-bg">
      {isLoading ? (
        <div className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-ws-bg p-3">
          <div className="h-8 animate-pulse rounded bg-white/5" />
        </div>
      ) : isError ? (
        <div className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-ws-bg p-4 text-sm text-red-300">
          Couldn't load your apps.
        </div>
      ) : (
        <Sidebar
          apps={data?.apps ?? []}
          activeAppId={activeAppId}
          onSelect={openApp}
          userName={userName}
          onSignOut={signOut}
        />
      )}

      {(data?.apps.length ?? 0) === 0 && !isLoading && !isError ? (
        <EmptyState />
      ) : (
        <WorkspaceTabs
          openTabs={openTabs}
          activeAppId={activeAppId}
          onActivate={setActiveAppId}
          onClose={closeTab}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <LayoutGrid className="h-8 w-8 text-white/20" />
      <h3 className="mt-4 text-lg font-semibold text-white">No applications yet</h3>
      <p className="mt-1 max-w-sm text-sm text-ws-text-secondary">
        You're signed in, but no applications have been assigned to your
        account yet. Contact an administrator to request access.
      </p>
    </div>
  );
}
