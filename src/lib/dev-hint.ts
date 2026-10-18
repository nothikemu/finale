/**
 * Setup and failure hints are for the owner, not for visitors. They show in
 * development builds, and in production only when SHOW_DIAGNOSTICS=1 is set.
 * The flag is resolved on the server and passed to client components as a prop
 * (client code cannot read non-public environment variables).
 */
export const hint = (text: string | undefined, enabled: boolean): string | undefined => (enabled ? text : undefined);
