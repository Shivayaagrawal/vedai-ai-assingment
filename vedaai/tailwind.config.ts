import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          soft: "var(--color-primary-soft-bg)",
        },
        ink: {
          DEFAULT: "var(--color-ink)",
          secondary: "var(--color-ink-secondary)",
        },
        background: "var(--color-background)",
        surface: {
          DEFAULT: "var(--color-surface)",
          muted: "var(--color-surface-muted)",
          active: "var(--color-surface-active)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          dashed: "var(--color-border-dashed)",
        },
        muted: "var(--color-text-muted)",
        success: {
          bg: "var(--color-success-bg)",
          text: "var(--color-success-text)",
        },
        warning: {
          bg: "var(--color-warning-bg)",
          text: "var(--color-warning-text)",
        },
        error: {
          bg: "var(--color-error-bg)",
          text: "var(--color-error-text)",
        },
        highlight: {
          DEFAULT: "var(--color-highlight-answer-active)",
          bg: "var(--color-highlight-answer-active-bg)",
          secondary: "var(--color-highlight-answer-secondary)",
          incorrect: "var(--color-highlight-incorrect)",
          "incorrect-bg": "var(--color-highlight-incorrect-bg)",
          partial: "var(--color-highlight-partial)",
          "partial-bg": "var(--color-highlight-partial-bg)",
        },
        overlay: "var(--color-overlay-dark)",
      },
      fontFamily: {
        primary: ["var(--font-family-primary)"],
      },
      fontSize: {
        "page-title": [
          "var(--text-page-title-size)",
          {
            lineHeight: "var(--text-page-title-leading)",
            fontWeight: "var(--text-page-title-weight)",
          },
        ],
        "section-heading": [
          "var(--text-section-heading-size)",
          {
            lineHeight: "var(--text-section-heading-leading)",
            fontWeight: "var(--text-section-heading-weight)",
          },
        ],
        "nav-item": [
          "var(--text-nav-item-size)",
          {
            lineHeight: "var(--text-nav-item-leading)",
            fontWeight: "var(--text-nav-item-weight)",
          },
        ],
        body: [
          "var(--text-body-size)",
          {
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--text-body-weight)",
          },
        ],
        "body-small": [
          "var(--text-body-small-size)",
          {
            lineHeight: "var(--text-body-small-leading)",
            fontWeight: "var(--text-body-small-weight)",
          },
        ],
        caption: [
          "var(--text-caption-size)",
          {
            lineHeight: "var(--text-caption-leading)",
            fontWeight: "var(--text-caption-weight)",
          },
        ],
        badge: [
          "var(--text-badge-size)",
          {
            lineHeight: "var(--text-badge-leading)",
            fontWeight: "var(--text-badge-weight)",
          },
        ],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        panel: "var(--shadow-panel)",
      },
    },
  },
  plugins: [],
};
export default config;
