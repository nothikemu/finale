import { Suspense } from "react";
import { site } from "@/config/site";
import { loadProjects } from "@/data/github/projects";
import { formatCount, formatShortDate, pluralize } from "@/lib/format";
import { failureHint } from "@/lib/server/diagnostics";
import { Panel, SkeletonRows, StateMessage } from "./Panel";
import { ExternalIcon, ForkIcon, StarIcon } from "./icons";

export function GitHubProjectsPanel() {
  return (
    <Panel id="projects" index={5} title="projects" scroll="github projects, scrollable">
      <Suspense fallback={<SkeletonRows count={4} />}>
        <ProjectsContent />
      </Suspense>
    </Panel>
  );
}

async function ProjectsContent() {
  const result = await loadProjects(site.githubUsername);

  if (result.status !== "ok") {
    return <StateMessage hint={failureHint(result)}>github projects unavailable</StateMessage>;
  }
  if (result.data.length === 0) {
    return <StateMessage>no public repositories</StateMessage>;
  }

  return (
    <>
      {result.stale ? <p className="stale-note">showing last known data</p> : null}
      <ul className="projects" role="list">
        {result.data.map((repo) => (
          <li className="project" key={repo.id}>
            <a className="project__name" href={repo.url} target="_blank" rel="noopener noreferrer">
              {repo.name}
              <span className="project__external" aria-hidden="true">
                <ExternalIcon size={11} />
              </span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            {repo.fork || repo.archived ? (
              <span className="project__flags">
                {repo.fork ? <span className="tag">fork</span> : null}
                {repo.archived ? <span className="tag">archived</span> : null}
              </span>
            ) : null}
            {repo.description ? <p className="project__description">{repo.description}</p> : null}
            <p className="project__meta">
              {repo.language ? <span>{repo.language.toLowerCase()}</span> : null}
              <span>
                <StarIcon size={11} /> <span className="visually-hidden">{pluralize(repo.stars, "star")}</span>
                <span aria-hidden="true">{formatCount(repo.stars)}</span>
              </span>
              <span>
                <ForkIcon size={11} /> <span className="visually-hidden">{pluralize(repo.forks, "fork")}</span>
                <span aria-hidden="true">{formatCount(repo.forks)}</span>
              </span>
              <span>
                <span className="visually-hidden">updated </span>
                <time dateTime={repo.updatedAt}>{formatShortDate(repo.updatedAt)}</time>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
