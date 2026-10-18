import type { CSSProperties, ReactNode } from "react";

interface PanelProps {
  /** Used for the heading id and the entrance-animation stagger. */
  id: string;
  index: number;
  title: string;
  /** Muted supporting label beside the heading. */
  aside?: ReactNode;
  className?: string;
  /**
   * Wraps the children in a fixed-height scroll region with a hidden scrollbar.
   * The region is focusable and named so keyboard users can scroll it.
   */
  scroll?: string;
  children: ReactNode;
}

export function Panel({ id, index, title, aside, className = "", scroll, children }: PanelProps) {
  const headingId = `${id}-title`;
  return (
    <section className={`panel panel--${id} ${className}`.trim()} aria-labelledby={headingId} style={{ "--i": index } as CSSProperties}>
      <header className="panel__head">
        <h2 id={headingId} className="panel__title">
          {title}
        </h2>
        {aside ? <span className="panel__aside">{aside}</span> : null}
      </header>
      {scroll ? (
        <div className="panel__body scroll" tabIndex={0} role="region" aria-label={scroll}>
          {children}
        </div>
      ) : (
        <div className="panel__body">{children}</div>
      )}
    </section>
  );
}

/** A distinct, understated message for empty / unconfigured / unavailable states. */
export function StateMessage({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="state" role="status">
      <p className="state__text">{children}</p>
      {hint ? <p className="state__hint">{hint}</p> : null}
    </div>
  );
}

/** Static rectangular placeholders. Geometry matches the loaded content to avoid layout shift. */
export function SkeletonRows({ count, className = "" }: { count: number; className?: string }) {
  return (
    <div className={`skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton__row" key={i}>
          <span className="skeleton__block skeleton__art" />
          <span className="skeleton__lines">
            <span className="skeleton__block skeleton__line" />
            <span className="skeleton__block skeleton__line skeleton__line--short" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Developer-facing hint that only appears outside production, so visitors never see env names. */
export const devHint = (text: string): string | undefined => (process.env.NODE_ENV === "production" ? undefined : text);
