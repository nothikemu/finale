import type { ReactNode } from "react";

/** A single quiet panel in the dashboard's own material, for pages that are not the dashboard. */
export function NoticePage({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <main className="page">
      <section className="panel notice" aria-labelledby="notice-title">
        <header className="panel__head">
          <h1 id="notice-title" className="panel__title">
            {title}
          </h1>
        </header>
        <div className="state">
          <p className="state__text">{text}</p>
          {children ? <p className="state__hint">{children}</p> : null}
        </div>
      </section>
    </main>
  );
}
