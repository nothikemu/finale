/**
 * Public identifiers that are safe to keep in the project. They are NOT secrets:
 * a Discord user ID and a ListenBrainz username are both visible to anyone who
 * can see your profile. They live here so the site still works on a host that
 * never receives your .env.local (Vercel, Netlify and similar upload only
 * committed files).
 *
 * An environment variable of the same name always wins over a value here
 * (for the ListenBrainz username, both are kept as candidate spellings).
 * Credentials (GITHUB_TOKEN, LISTENBRAINZ_TOKEN) are never read from this file.
 *
 * This file is compiled into the server: after editing it run `npm run build`
 * again (or restart `npm run dev`); /status shows the build that is running.
 */
export const identity = {
  /** Numeric Discord user ID, e.g. "123456789012345678". Same as DISCORD_USER_ID. */
  discordUserId: null as string | null,
  /**
   * ListenBrainz username. Same as LISTENBRAINZ_USERNAME. If you are not sure
   * of the spelling, list candidates separated by commas ("name1,name2" or
   * "name1 or name2"): the first one ListenBrainz knows (and that has listens)
   * is used, and a valid LISTENBRAINZ_TOKEN always decides when it is present.
   */
  listenbrainzUsername: null as string | null,
  /**
   * Show setup and failure hints inside panels, and serve /status, in a
   * production build. Same as SHOW_DIAGNOSTICS=1. Turn it off once everything works.
   */
  showDiagnostics: false,
};
