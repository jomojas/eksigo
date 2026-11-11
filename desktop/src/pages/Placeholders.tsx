// Screens still to come. Each becomes the real screen on the day noted in docs/ROADMAP.md;
// until then they show what a new learner would see with nothing added yet.

import { useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import { addAudio, Kbd, Page } from "../components/Shell";
import { inApp } from "../lib/backend";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Soon({ day }: { day: string }) {
  return <span className="badge badge-next">Arrives {day}</span>;
}

export function Today() {
  const navigate = useNavigate();
  return (
    <Page crumbs={["Today"]} keys={[["Mod O", "Add audio"]]}>
      <div className="page">
        <div>
          <div className="eyebrow">{greeting()}</div>
          <h1 className="h1" style={{ marginTop: 6 }}>
            Nothing to continue yet
          </h1>
        </div>
        <div className="empty">
          <h2 className="h2">Start with an episode</h2>
          <p>
            Find a podcast you like, or add an audio or video file of your own. Eksigo transcribes it on this computer, then
            plays it back one sentence at a time for you to type.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={() => navigate("/podcasts")}>
              <Icon name="podcasts" />
              Find a podcast
            </button>
            <button className="btn" disabled={!inApp} onClick={() => addAudio().then((added) => added && navigate("/library", { state: { added } }))}>
              <Icon name="plus" />
              Add audio
              <Kbd keys="Mod O" />
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}

export function Words() {
  return (
    <Page crumbs={["My words"]}>
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="h1" style={{ flexGrow: 1 }}>
            My words
          </h1>
          <Soon day="day 5" />
        </div>
        <div className="empty">
          <h2 className="h2">No words saved yet</h2>
          <p>After a dictation, select a word in the results to look it up and add it here, with the sentence you heard it in.</p>
        </div>
      </div>
    </Page>
  );
}

export function Progress() {
  return (
    <Page crumbs={["Progress"]}>
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="h1" style={{ flexGrow: 1 }}>
            Progress
          </h1>
          <Soon day="after v0.1" />
        </div>
        <div className="empty">
          <h2 className="h2">Your year of practice</h2>
          <p>A grid of the days you practised, your streak and how your accuracy changes over time.</p>
        </div>
      </div>
    </Page>
  );
}
