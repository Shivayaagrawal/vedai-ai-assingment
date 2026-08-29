"use client";

export function UploadHero() {
  return (
    <div className="flex flex-col items-center">
      <h1 className="max-w-3xl text-center text-page-title">
        <span className="text-ink">Upload </span>
        <span className="rounded-md bg-primary-soft px-3 py-1 text-primary underline decoration-primary decoration-2 underline-offset-4">
          Question Paper &amp; Answer Sheets
        </span>
      </h1>
      <p className="mt-3 text-body-small text-muted">
        Upload both files to get started
      </p>

      <div className="mt-8 w-56" aria-hidden>
        <img
          src="/upload-hero.jpg?v=2"
          alt=""
          className="hero-breathe pointer-events-none h-auto w-full select-none"
        />
      </div>
    </div>
  );
}
