import { site } from "@/config/site";
import { Panel } from "./Panel";
import { ExternalIcon, SocialIcon } from "./icons";

export function SocialLinksPanel() {
  return (
    <Panel id="socials" index={1} title="socials">
      <ul className="links" role="list">
        {site.socials.map((social) => (
          <li key={social.id}>
            <a className="link-row" href={social.href} target="_blank" rel="noopener noreferrer me">
              <span className="link-row__icon">
                <SocialIcon name={social.icon} size={16} />
              </span>
              <span className="link-row__text">
                <span className="link-row__label">{social.label}</span>
                <span className="link-row__handle">{social.handle}</span>
              </span>
              <span className="link-row__external">
                <ExternalIcon size={12} />
              </span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
