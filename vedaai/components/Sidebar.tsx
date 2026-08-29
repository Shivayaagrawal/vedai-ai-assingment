"use client";

import { ChevronLeft, Settings, Sparkles } from "lucide-react";
import { SIDEBAR_NAV } from "../lib/nav";
import { BrandLogo } from "./BrandLogo";

type SidebarProps = {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export function Sidebar({ collapsed = false, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={`hidden h-screen shrink-0 flex-col bg-surface py-6 shadow-panel md:flex ${
        collapsed ? "w-[72px] px-3" : "w-[280px] rounded-r-lg px-5"
      }`}
    >
      <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
        {collapsed ? (
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={onToggleCollapsed}
            className="shrink-0"
          >
            <BrandLogo />
          </button>
        ) : (
          <BrandLogo />
        )}
        {!collapsed ? (
          <>
            <span className="flex-1 text-section-heading text-ink">VedaAI</span>
            <button
              type="button"
              aria-label="Collapse sidebar"
              onClick={onToggleCollapsed}
              className="text-muted"
            >
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
          </>
        ) : null}
      </div>

      <div className={collapsed ? "mx-auto" : ""}>
        {collapsed ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-surface">
            <Sparkles size={16} strokeWidth={1.75} />
          </div>
        ) : (
          <div className="rounded-pill bg-gradient-to-r from-primary to-primary-hover p-[2px] shadow-card">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-4 py-3 text-surface"
            >
              <Sparkles size={16} strokeWidth={1.75} />
              <span className="text-body-small font-semibold">
                AI Teacher&apos;s Toolkit
              </span>
            </button>
          </div>
        )}
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-2">
        {SIDEBAR_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === "exams";
          return (
            <div
              key={item.id}
              className={`flex items-center rounded-md px-3 py-3 text-nav-item ${
                active ? "bg-surface-active text-ink" : "text-muted"
              } ${collapsed ? "justify-center" : "gap-3"}`}
            >
              <Icon size={20} strokeWidth={1.75} />
              {!collapsed ? <span>{item.label}</span> : null}
            </div>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="mb-4 flex items-center gap-3 px-3 py-3 text-nav-item text-muted">
          <Settings size={20} strokeWidth={1.75} />
          <span>Settings</span>
        </div>
      ) : null}

      <div
        className={`rounded-md bg-surface-muted ${collapsed ? "p-2" : "flex items-center gap-3 p-3"}`}
      >
        <div className="mx-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-body-small font-semibold text-ink shadow-card">
          DPS
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-body-small font-semibold text-ink">
              Delhi Public School
            </p>
            <p className="truncate text-caption text-muted">Bokaro Steel City</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
