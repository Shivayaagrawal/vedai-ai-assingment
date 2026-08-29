"use client";

import { Settings, Sparkles, X } from "lucide-react";
import { useEffect } from "react";
import { SIDEBAR_NAV } from "../lib/nav";
import { BrandLogo } from "./BrandLogo";

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="md:hidden">
      {/* Inferred: dimmed scrim — drawer open state is not in the reference screenshots. */}
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "var(--color-overlay-dark)", opacity: 0.4 }}
        onClick={onClose}
      />
      <aside
        className="fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col bg-surface px-5 py-6 shadow-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo />
          <span className="flex-1 text-section-heading text-ink">VedaAI</span>
          <button type="button" aria-label="Close menu" onClick={onClose} className="text-muted">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="rounded-pill bg-gradient-to-r from-primary to-primary-hover p-[2px] shadow-card">
          <div className="flex w-full items-center justify-center gap-2 rounded-pill bg-ink px-4 py-3 text-surface">
            <Sparkles size={16} strokeWidth={1.75} />
            <span className="text-body-small font-semibold">
              AI Teacher&apos;s Toolkit
            </span>
          </div>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-2">
          {SIDEBAR_NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === "exams";
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-md px-3 py-3 text-nav-item ${
                  active ? "bg-surface-active text-ink" : "text-muted"
                }`}
              >
                <Icon size={20} strokeWidth={1.75} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>

        <div className="mb-4 flex items-center gap-3 px-3 py-3 text-nav-item text-muted">
          <Settings size={20} strokeWidth={1.75} />
          <span>Settings</span>
        </div>
      </aside>
    </div>
  );
}
