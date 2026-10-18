import { AboutPanel } from "./AboutPanel";
import { ContributionCalendarPanel } from "./ContributionCalendarPanel";
import { DiscordPresencePanel } from "./DiscordPresencePanel";
import { GitHubProjectsPanel } from "./GitHubProjectsPanel";
import { RecentListeningPanel } from "./RecentListeningPanel";
import { SocialLinksPanel } from "./SocialLinksPanel";

/**
 * Six panels in the wireframe's hierarchy: four across the top, then the
 * contribution calendar (two thirds) and projects (one third).
 * Each data panel streams in independently and fails independently.
 */
export function Dashboard() {
  return (
    <div className="dashboard">
      <div className="row row--top">
        <DiscordPresencePanel />
        <SocialLinksPanel />
        <RecentListeningPanel />
        <AboutPanel />
      </div>
      <div className="row row--bottom">
        <ContributionCalendarPanel />
        <GitHubProjectsPanel />
      </div>
    </div>
  );
}
