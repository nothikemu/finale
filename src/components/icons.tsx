import type { SVGProps } from "react";
import type { IconName } from "@/config/site";

/** Compact monochrome inline icons. Decorative by default: pair with a text label. */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 16, viewBox, children, ...props }: IconProps & { viewBox: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </Svg>
  );
}

export function GitHubIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </Svg>
  );
}

/** Square-cornered chain link, used for guns.lol. */
export function LinkIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" {...props}>
      <path d="M1 5h6v2H3v2h4v2H1zM15 5H9v2h4v2H9v2h6zM5 7.25h6v1.5H5z" />
    </Svg>
  );
}

/** Small square-edged external-link arrow. */
export function ExternalIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 12 12" {...props}>
      <path d="M3 1h8v8h-1.5V3.56L2.53 10.53 1.47 9.47 8.44 2.5H3z" />
    </Svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" {...props}>
      <path d="M8 .5l2.2 4.9 5.3.5-4 3.6 1.2 5.2L8 11.9 3.3 14.7l1.2-5.2-4-3.6 5.3-.5z" />
    </Svg>
  );
}

export function ForkIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" {...props}>
      <path d="M3 1h3v3H3zM10 1h3v3h-3zM6.5 11h3v3h-3zM4 4h1.5v2.25h5V4H12v3.75H8.75V11h-1.5V7.75H4z" />
    </Svg>
  );
}

const SOCIAL_ICONS: Record<IconName, (props: IconProps) => React.JSX.Element> = {
  x: XIcon,
  github: GitHubIcon,
  link: LinkIcon,
};

export function SocialIcon({ name, ...props }: IconProps & { name: IconName }) {
  const Icon = SOCIAL_ICONS[name];
  return <Icon {...props} />;
}
