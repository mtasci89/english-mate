import { topicByKey, type DayPlan, type Topic } from "../session/programme";

type Props = {
  plan: DayPlan;
  topic: Topic;
  startAt: string;
  onStart: () => void;
  onOpenParent: () => void;
};

const blockWords: Record<string, string> = {
  warmup: "Move with me",
  talk: "Talk together",
  story: "A story",
};

/**
 * What the box says it will do tonight.
 *
 * There is one button and it is not a choice — the programme is already
 * decided. On the real device this screen does not exist at all: the box wakes
 * itself and starts talking. Here a browser needs a tap before it will play
 * audio, so the tap stands in for the alarm.
 */
export function TonightScreen({ plan, topic, startAt, onStart, onOpenParent }: Props) {
  const total = plan.blocks.reduce((sum, block) => sum + block.minutes, 0);

  return (
    <section className="tonight-screen" aria-label="Tonight">
      <header className="home-header">
        <div>
          <p>Tonight · {startAt}</p>
          <h1>{topicByKey.get(plan.topic)?.en ?? topic.en}</h1>
        </div>
        <button type="button" className="ghost-button" onClick={onOpenParent}>
          Parent
        </button>
      </header>

      <ol className="tonight-blocks">
        {plan.blocks.map((block) => (
          <li key={block.kind}>
            <strong>{blockWords[block.kind]}</strong>
            <span>{block.minutes} min</span>
          </li>
        ))}
      </ol>

      <button type="button" className="primary-talk" onClick={onStart}>
        Start · {total} min
      </button>
    </section>
  );
}
