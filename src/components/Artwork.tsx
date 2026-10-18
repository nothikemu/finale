/** Square artwork with a monochrome fallback. Decorative: adjacent text carries the meaning. */
export function Artwork({ src, size, className = "" }: { src: string | null; size: number; className?: string }) {
  return (
    <span className={`art ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- external artwork at fixed size; next/image would proxy it for no gain
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : null}
    </span>
  );
}
