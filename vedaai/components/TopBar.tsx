"use client";

import {
  Bell,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  ClipboardList,
  Menu,
  Sparkles,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";

type TopBarProps = {
  onBack?: () => void;
  onOpenMenu?: () => void;
};

export function TopBar({ onBack, onOpenMenu }: TopBarProps) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3 text-ink md:gap-4">
        <button type="button" aria-label="Back" className="text-ink" onClick={onBack}>
          <ChevronLeft size={22} strokeWidth={1.75} />
        </button>
        <div className="hidden items-center gap-2 text-nav-item md:flex">
          <ClipboardList size={18} strokeWidth={1.75} className="text-muted" />
          <span className="font-medium">Exams</span>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <BrandLogo />
          <span className="text-section-heading text-ink">VedaAI</span>
        </div>
      </div>

      <div className="hidden items-center gap-5 md:flex">
        <button type="button" aria-label="Help" className="text-muted">
          <CircleHelp size={20} strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Notifications" className="relative text-muted">
          <Bell size={20} strokeWidth={1.75} />
          <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-primary" />
        </button>
        <button type="button" aria-label="AI tools" className="text-muted">
          <Sparkles size={20} strokeWidth={1.75} />
        </button>
        <button type="button" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-active text-caption font-semibold text-ink">
            MR
          </span>
          <span className="text-body-small font-medium text-ink">Madhur Rastogi</span>
          <ChevronDown size={16} strokeWidth={1.75} className="text-muted" />
        </button>
      </div>

      <div className="flex items-center gap-4 md:hidden">
        <button type="button" aria-label="Notifications" className="relative text-muted">
          <Bell size={20} strokeWidth={1.75} />
          <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-primary" />
        </button>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-active text-caption font-semibold text-ink">
          MR
        </span>
        <button
          type="button"
          aria-label="Open menu"
          className="text-ink"
          onClick={onOpenMenu}
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
