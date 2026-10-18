/**
 * Developer-facing setup hints. They are undefined in production builds, so
 * visitors never see environment variable names or integration internals.
 */
export const devHint = (text: string): string | undefined => (process.env.NODE_ENV === "production" ? undefined : text);
