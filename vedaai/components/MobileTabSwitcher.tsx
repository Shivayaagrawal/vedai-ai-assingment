"use client";

export type ResultsTab = "questions" | "answers";

type MobileTabSwitcherProps = {
  value: ResultsTab;
  onChange: (tab: ResultsTab) => void;
};

const TABS: { id: ResultsTab; label: string }[] = [
  { id: "questions", label: "Questions" },
  { id: "answers", label: "Answer Sheet" },
];

export function MobileTabSwitcher({ value, onChange }: MobileTabSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Results views"
      className="flex rounded-pill bg-surface-muted p-1"
    >
      {TABS.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`min-h-10 flex-1 rounded-pill px-3 py-2 text-body-small font-medium ${
              active ? "bg-ink text-surface" : "bg-transparent text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
