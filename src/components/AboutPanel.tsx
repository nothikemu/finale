import { site } from "@/config/site";
import { FxWord } from "./FxWord";
import { Panel } from "./Panel";

export function AboutPanel() {
  return (
    <Panel id="about" index={3} title="about">
      <div className="about">
        {site.about.map((line, lineIndex) => (
          <p className="about__line" key={lineIndex}>
            {line.map((segment, segmentIndex) =>
              segment.fx ? (
                <FxWord fx={segment.fx} key={segmentIndex}>
                  {segment.text}
                </FxWord>
              ) : (
                segment.text
              ),
            )}
          </p>
        ))}
      </div>
    </Panel>
  );
}
