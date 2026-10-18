import { Suspense } from "react";
import { loadListening } from "@/data/listenbrainz";
import { ListeningFeed } from "./ListeningFeed";
import { Panel, SkeletonRows, devHint } from "./Panel";

export function RecentListeningPanel() {
  return (
    <Panel id="listening" index={2} title="recently played" aside="via listenbrainz" scroll="recently played tracks, scrollable">
      <Suspense fallback={<SkeletonRows count={7} />}>
        <ListeningContent />
      </Suspense>
    </Panel>
  );
}

async function ListeningContent() {
  const initial = await loadListening();
  // Runs once per request on the server; the value only seeds the client's first render.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now();
  return <ListeningFeed initial={initial} serverNow={serverNow} setupHint={devHint("set LISTENBRAINZ_TOKEN (see README)")} />;
}
