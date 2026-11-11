// First-run screens. Each becomes the real screen on the day noted in docs/ROADMAP.md;
// until then they show what a new learner would see with nothing added yet.

import { useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";

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
            <button className="btn" disabled>
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

export function Podcasts() {
  return (
    <Page crumbs={["Podcasts"]}>
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="h1" style={{ flexGrow: 1 }}>
            Podcasts
          </h1>
          <Soon day="day 2" />
        </div>
        <div className="empty">
          <h2 className="h2">Search Apple Podcasts or add an RSS feed</h2>
          <p>Shows you follow appear here, with a list of podcasts that are good for learners.</p>
        </div>
      </div>
    </Page>
  );
}

export function Library() {
  return (
    <Page crumbs={["Library"]} keys={[["Mod O", "Add audio"]]}>
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="h1" style={{ flexGrow: 1 }}>
            Library
          </h1>
          <Soon day="day 2" />
        </div>
        <div className="empty">
          <h2 className="h2">Your episodes and files</h2>
          <p>
            Downloaded episodes and your own audio or video files live here, with your progress and accuracy for each. Drop a file
            here to add it.
          </p>
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
