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
      const res = await fetch("/api/my-apps", {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to load your apps");
      }

      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

async function signOut() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });

  window.location.href = "/";
}

export function Workspace({ user }: { user: AuthUser }) {
  const { data, isLoading, isError } = useMyApps();

  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);

  const openApp = useCallback((app: SidebarApp) => {
  const isFieldService =
    app.name === "Field Service Calendar";

  const isProductionShopFloor =
    app.name === "Production Shop Floor";

  const isProductionPriority =
    app.name === "Production Priority Board";

  const isPackingControl =
    app.name === "Packing Control Board";

  const isAdminConsole =
    app.name === "Admin Console";

  const requiresEmbeddedSSO =
    isFieldService ||
    isProductionShopFloor ||
    isProductionPriority ||
    isPackingControl ||
    isAdminConsole;

  // If the tab is already open, just activate it.
  if (openTabs.some((t) => t.app.id === app.id)) {
    setActiveAppId(app.id);
    return;
  }

  // Open the tab first.
  setOpenTabs((prev) => [...prev, { app }]);
  setActiveAppId(app.id);

  // Start SSO outside the state updater.
  if (!requiresEmbeddedSSO) {
    return;
  }

  const loginPath = isFieldService
    ? "/api/login?embedded=1"
    : "/api/auth/login?embedded=1";

  const loginUrl =
    `${app.launchUrl.replace(/\/$/, "")}${loginPath}`;

  const popupWidth = 480;
  const popupHeight = 600;

  const left = Math.max(
    0,
    Math.round(
      (window.screen.availWidth - popupWidth) / 2,
    ),
  );

  const top = Math.max(
    0,
    Math.round(
      (window.screen.availHeight - popupHeight) / 2,
    ),
  );

  let popupName = "workspace-sso";

  if (isFieldService) {
    popupName = "fieldservice-sso";
  } else if (isProductionShopFloor) {
    popupName = "production-shop-floor-sso";
  } else if (isProductionPriority) {
    popupName = "production-priority-sso";
  } else if (isPackingControl) {
    popupName = "packing-control-sso";
  } else if (isAdminConsole) {
    popupName = "admin-console-sso";
  }

  console.log(
    "[Workspace] Starting embedded SSO:",
    {
      app: app.name,
      loginUrl,
      popupName,
      launchUrl: app.launchUrl,
    },
  );

  const popup = window.open(
    loginUrl,
    popupName,
    [
      `width=${popupWidth}`,
      `height=${popupHeight}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
    ].join(","),
  );

  if (popup) {
    popup.focus();
  } else {
    console.error(
      "[Workspace] Failed to open SSO popup:",
      app.name,
    );
  }
}, [openTabs]);
  
  const closeTab = useCallback(
    (appId: number) => {
      setOpenTabs((prev) => {
        const next = prev.filter(
          (t) => t.app.id !== appId,
        );

        if (activeAppId === appId) {
          setActiveAppId(
            next.length > 0
              ? next[next.length - 1]!.app.id
              : null,
          );
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

      {(data?.apps.length ?? 0) === 0 &&
      !isLoading &&
      !isError ? (
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

      <h3 className="mt-4 text-lg font-semibold text-white">
        No applications yet
      </h3>

      <p className="mt-1 max-w-sm text-sm text-ws-text-secondary">
        You're signed in, but no applications have been assigned
        to your account yet. Contact an administrator to request
        access.
      </p>
    </div>
  );
}