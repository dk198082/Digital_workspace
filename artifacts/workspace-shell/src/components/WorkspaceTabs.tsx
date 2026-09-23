import { useEffect, useRef, useState } from "react";
import {
  X,
  ExternalLink,
  AlertTriangle,
  LayoutGrid,
} from "lucide-react";
import type { SidebarApp } from "@/components/Sidebar";

export interface OpenTab {
  app: SidebarApp;
}

const IFRAME_LOAD_TIMEOUT_MS = 12_000;

function withEmbeddedFlag(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("embedded", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

interface WorkspaceTabsProps {
  openTabs: OpenTab[];
  activeAppId: number | null;
  onActivate: (appId: number) => void;
  onClose: (appId: number) => void;
}

export function WorkspaceTabs({
  openTabs,
  activeAppId,
  onActivate,
  onClose,
}: WorkspaceTabsProps) {
  if (openTabs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <LayoutGrid className="h-8 w-8 text-white/20" />

        <h3 className="mt-4 text-lg font-semibold text-white">
          Nothing open yet
        </h3>

        <p className="mt-1 max-w-sm text-sm text-ws-text-secondary">
          Choose an app from the menu on the left to open it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-white/10 bg-ws-bg px-2">
        {openTabs.map(({ app }) => (
          <Tab
            key={app.id}
            app={app}
            active={app.id === activeAppId}
            onActivate={() => onActivate(app.id)}
            onClose={() => onClose(app.id)}
          />
        ))}
      </div>

      <div className="relative flex-1 bg-white">
        {openTabs.map(({ app }) => (
          <AppFrame
            key={app.id}
            app={app}
            visible={app.id === activeAppId}
          />
        ))}
      </div>
    </div>
  );
}

function Tab({
  app,
  active,
  onActivate,
  onClose,
}: {
  app: SidebarApp;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      data-testid={`tab-${app.id}`}
      className={`group flex max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${
        active
          ? "border-ws-accent font-medium text-white"
          : "border-transparent text-ws-text-secondary hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="truncate">{app.name}</span>

      <a
        href={app.launchUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open in a new browser tab"
        data-testid={`button-open-new-tab-${app.id}`}
        className="rounded p-0.5 text-ws-text-secondary opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
        data-testid={`button-close-tab-${app.id}`}
        className="rounded p-0.5 text-ws-text-secondary hover:bg-white/10 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AppFrame({
  app,
  visible,
}: {
  app: SidebarApp;
  visible: boolean;
}) {
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

  const requiresEmbeddedAuth =
      isFieldService ||
      isProductionShopFloor ||
      isProductionPriority ||
      isPackingControl ||
      isAdminConsole;

  const [suspectedBlocked, setSuspectedBlocked] =
    useState(false);

  const [loaded, setLoaded] = useState(false);

  const [iframeVersion, setIframeVersion] = useState(0);

  const [embeddedAuthReady, setEmbeddedAuthReady] =
    useState(!requiresEmbeddedAuth);

  const timerRef =
    useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );

  /*
   * ---------------------------------------------------------
   * App origins
   * ---------------------------------------------------------
   */

  const FIELD_SERVICE_ORIGIN =
    isFieldService
      ? new URL(app.launchUrl).origin
      : null;

  const PRODUCTION_ORIGIN =
    isProductionShopFloor
      ? new URL(app.launchUrl).origin
      : null;

  const PRODUCTION_PRIORITY_ORIGIN =
    isProductionPriority
      ? new URL(app.launchUrl).origin
      : null;

  const PACKING_CONTROL_ORIGIN =
    isPackingControl
      ? new URL(app.launchUrl).origin
      : null;

  const ADMIN_CONSOLE_ORIGIN =
    isAdminConsole
      ? new URL(app.launchUrl).origin
      : null;

  /*
   * ---------------------------------------------------------
   * iframe URL
   * ---------------------------------------------------------
   */

  const iframeSrc = requiresEmbeddedAuth
    ? withEmbeddedFlag(app.launchUrl)
    : app.launchUrl;

  /*
   * ---------------------------------------------------------
   * iframe load timeout
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!requiresEmbeddedAuth) {
      return;
    }

    if (!embeddedAuthReady) {
      return;
    }

    clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      if (!loaded) {
        setSuspectedBlocked(true);
      }
    }, IFRAME_LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(timerRef.current);
    };
  }, [
    loaded,
    embeddedAuthReady,
    requiresEmbeddedAuth,
  ]);

  /*
   * ---------------------------------------------------------
   * Embedded SSO completion message
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!requiresEmbeddedAuth) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const messageType =
        typeof event.data?.type === "string"
          ? event.data.type
          : "";

      /*
       * Field Service
       */
      const validFieldService =
        isFieldService &&
        FIELD_SERVICE_ORIGIN &&
        event.origin === FIELD_SERVICE_ORIGIN &&
        messageType === "FIELD_SERVICE_AUTH_COMPLETE";

      /*
       * Production Shop Floor
       */
      const validProduction =
        isProductionShopFloor &&
        PRODUCTION_ORIGIN &&
        event.origin === PRODUCTION_ORIGIN &&
        messageType === "PRODUCTION_AUTH_COMPLETE";

      /*
       * Production Priority
       */
      const validProductionPriority =
        isProductionPriority &&
        PRODUCTION_PRIORITY_ORIGIN &&
        event.origin === PRODUCTION_PRIORITY_ORIGIN &&
        messageType ===
          "PRODUCTION_PRIORITY_AUTH_COMPLETE";

      /*
       * Packing Control Board
       */
      const validPacking =
        isPackingControl &&
        PACKING_CONTROL_ORIGIN &&
        event.origin === PACKING_CONTROL_ORIGIN &&
        messageType ===
          "PACKING_CONTROL_AUTH_COMPLETE";

      const ValidAdminConsole =
        isAdminConsole &&
        ADMIN_CONSOLE_ORIGIN &&
        event.origin === ADMIN_CONSOLE_ORIGIN &&
        event.data?.type === "ADMIN_CONSOLE_AUTH_COMPLETE";

      if (
        !validFieldService &&
        !validProduction &&
        !validProductionPriority &&
        !validPacking && 
        !ValidAdminConsole
      ) {
        return;
      }

      console.log(
        "[Workspace] Embedded authentication completed:",
        app.name,
      );

      setEmbeddedAuthReady(true);
      setLoaded(false);
      setSuspectedBlocked(false);

      /*
       * Force a fresh iframe after authentication.
       */
      setIframeVersion((version) => version + 1,
      );
    };

    window.addEventListener(
      "message",
      handleMessage,
    );

    return () => {
      window.removeEventListener(
        "message",
        handleMessage,
      );
    };
  }, [
    app.name,
    isFieldService,
    FIELD_SERVICE_ORIGIN,
    isProductionShopFloor,
    PRODUCTION_ORIGIN,
    isProductionPriority,
    PRODUCTION_PRIORITY_ORIGIN,
    isPackingControl,
    PACKING_CONTROL_ORIGIN,
    isAdminConsole,
    ADMIN_CONSOLE_ORIGIN,
    requiresEmbeddedAuth,
  ]);

  /*
   * ---------------------------------------------------------
   * Render
   * ---------------------------------------------------------
   */

  return (
    <div
      className="absolute inset-0"
      style={{
        display: visible ? "block" : "none",
      }}
      data-testid={`frame-container-${app.id}`}
    >
      {suspectedBlocked && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />

            <strong>{app.name}</strong>

            <span>
              is taking a while to load. It may not allow
              opening inside the Workspace.
            </span>
          </span>

          <a
            href={app.launchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />

            Open in new tab instead
          </a>
        </div>
      )}

      {embeddedAuthReady && (
        <iframe
          key={`${app.id}-${iframeVersion}`}
          src={iframeSrc}
          title={app.name}
          className="absolute inset-0 h-full w-full border-0"
          style={{
            display: visible ? "block" : "none",
          }}
          onLoad={() => {
            console.log(
              "[Workspace] iframe loaded:",
              app.name,
            );

            setLoaded(true);
            setSuspectedBlocked(false);
          }}
        />
      )}
    </div>
  );
}