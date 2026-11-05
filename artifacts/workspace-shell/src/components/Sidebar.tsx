
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { resolveIcon } from "@/lib/icons";

export interface SidebarApp {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launchUrl: string;
}

interface SidebarProps {
  apps: SidebarApp[];
  activeAppId: number | null;
  onSelect: (app: SidebarApp) => void;
  userName: string;
  onSignOut: () => void;
}

export function Sidebar({
  apps,
  activeAppId,
  onSelect,
  userName,
  onSignOut,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const grouped = useMemo(() => {
    const filtered = apps.filter(
      (a) =>
        a.category?.trim() !== "Administration" &&
        a.name.toLowerCase().includes(search.trim().toLowerCase()),
    );

    const byCategory = new Map<string, SidebarApp[]>();

    for (const app of filtered) {
      const key = app.category?.trim() || "Apps";
      const list = byCategory.get(key) ?? [];
      list.push(app);
      byCategory.set(key, list);
    }

    return [...byCategory.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [apps, search]);

  const adminApps = apps.filter(
    (app) => app.category?.trim() === "Administration",
  );

  const toggle = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const renderApp = (app: SidebarApp) => {
    const Icon = resolveIcon(app.icon);
    const active = app.id === activeAppId;

    return (
      <button
        key={app.id}
        onClick={() => onSelect(app)}
        data-testid={`menu-item-app-${app.id}`}
        title={
          sidebarCollapsed
            ? app.name
            : app.description ?? undefined
        }
        className={`flex w-full items-center rounded-md py-2 text-left text-sm transition ${
          sidebarCollapsed
            ? "justify-center px-2"
            : "gap-2.5 px-3"
        } ${
          active
            ? "bg-ws-accent/15 font-medium text-ws-accent"
            : "text-white/85 hover:bg-white/5"
        }`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 ${
            active
              ? "text-ws-accent"
              : "text-ws-text-secondary"
          }`}
        />

        {!sidebarCollapsed && (
          <span className="truncate">{app.name}</span>
        )}
      </button>
    );
  };

  const renderCategory = (
    category: string,
    categoryApps: SidebarApp[],
  ) => {
    const isCollapsed = collapsed.has(category);

    return (
      <div key={category} className="mb-1">
        <button
          onClick={() => toggle(category)}
          data-testid={`heading-category-${category}`}
          title={sidebarCollapsed ? category : undefined}
          className={`flex w-full items-center rounded px-2 py-1.5 text-left text-base font-semibold text-ws-text-secondary hover:bg-white/5 ${
            sidebarCollapsed
              ? "justify-center"
              : "gap-1.5"
          }`}
        >
          {!sidebarCollapsed && (
            <>
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {category}
            </>
          )}
        </button>

        {!sidebarCollapsed && !isCollapsed && (
          <div className="mt-0.5 space-y-0.5">
            {categoryApps.map(renderApp)}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav
      className={`relative flex h-full shrink-0 flex-col border-r border-white/10 bg-ws-bg transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand header and sidebar toggle */}
      <div
        className={`flex shrink-0 items-center border-b border-white/10 py-2.5 ${
          sidebarCollapsed
            ? "justify-center px-2"
            : "justify-between gap-2 px-3"
        }`}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-ws-accent">
              <LayoutGrid className="h-3.5 w-3.5 text-ws-bg" />
            </div>

            <span className="text-sm font-bold tracking-tight text-white">
              Workspace
            </span>
          </div>
        )}

        <button
          onClick={() =>
            setSidebarCollapsed((prev) => !prev)
          }
          title={
            sidebarCollapsed
              ? "Expand sidebar"
              : "Collapse sidebar"
          }
          aria-label={
            sidebarCollapsed
              ? "Expand sidebar"
              : "Collapse sidebar"
          }
          aria-expanded={!sidebarCollapsed}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ws-text-secondary transition hover:bg-white/10 hover:text-white"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Search */}
      {!sidebarCollapsed && (
        <div className="shrink-0 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ws-text-secondary/60" />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-2 text-sm text-white placeholder:text-ws-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-ws-accent"
            />
          </div>
        </div>
      )}

      {/* Scrollable app menu */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto pb-3 ${
          sidebarCollapsed ? "px-1.5" : "px-2"
        }`}
      >
        {grouped.map(([category, categoryApps]) =>
          renderCategory(category, categoryApps),
        )}

        {!sidebarCollapsed && grouped.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-ws-text-secondary/70">
            No apps found.
          </div>
        )}
      </div>

      {/* Administration, user and sign-out footer */}
      <div
        className={`shrink-0 border-t border-white/10 ${
          sidebarCollapsed ? "p-2" : "p-3"
        }`}
      >
        {adminApps.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => toggle("Administration")}
              data-testid="heading-category-Administration"
              title={
                sidebarCollapsed
                  ? "Administration"
                  : undefined
              }
              className={`flex w-full items-center rounded px-2 py-1.5 text-left text-base font-semibold text-ws-text-secondary hover:bg-white/5 ${
                sidebarCollapsed
                  ? "justify-center"
                  : "gap-1.5"
              }`}
            >
              {!sidebarCollapsed && (
                <>
                  {collapsed.has("Administration") ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Administration
                </>
              )}
            </button>

            {!sidebarCollapsed &&
              !collapsed.has("Administration") && (
                <div className="mt-0.5 space-y-0.5">
                  {adminApps.map(renderApp)}
                </div>
              )}
          </div>
        )}

        <div className="my-2 border-t border-white/10" />

        {/* User and sign-out */}
        <div
          className={`flex items-center ${
            sidebarCollapsed
              ? "justify-center"
              : "gap-2"
          }`}
        >
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-sm font-medium text-white"
                data-testid="text-user-name"
              >
                {userName}
              </div>
            </div>
          )}

          <button
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            data-testid="button-sign-out"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2 py-1.5 text-xs text-ws-text-secondary hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            {!sidebarCollapsed && "Sign out"}
          </button>
        </div>
      </div>
    </nav>
  );
}
