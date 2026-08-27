import type { GameId } from "../types";

type Props = {
  childName: string;
  onPick: (gameId: GameId) => void;
  onOpenParent: () => void;
};

/**
 * The three modes are shown as a ladder, easiest first.
 *
 * Free conversation is the last card, not the first: asking a beginner an open
 * question is the hardest thing in the app, and leading with it is what makes a
 * child freeze rather than play.
 */
const games: { id: GameId; title: string; blurb: string; visual: string; step: string }[] = [
  {
    id: "move",
    title: "Move With Me",
    blurb: "Listen and do it. No talking needed.",
    visual: "🤸",
    step: "Step 1",
  },
  {
    id: "nameit",
    title: "Name It",
    blurb: "One picture, one word.",
    visual: "🐱",
    step: "Step 2",
  },
  {
    id: "chat",
    title: "Talk With Me",
    blurb: "Say anything you like.",
    visual: "💬",
    step: "Step 3",
  },
];

export function HomeScreen({ childName, onPick, onOpenParent }: Props) {
  return (
    <section className="home-screen" aria-label="Choose a game">
      <header className="home-header">
        <div>
          <p>English Mate</p>
          <h1>Hi {childName}! What shall we play?</h1>
        </div>
        <button type="button" className="ghost-button" onClick={onOpenParent}>
          Parent
        </button>
      </header>

      <div className="game-cards">
        {games.map((game) => (
          <button key={game.id} type="button" className="game-card" onClick={() => onPick(game.id)}>
            <span className="game-card-visual" aria-hidden="true">
              {game.visual}
            </span>
            <span className="game-card-step">{game.step}</span>
            <strong>{game.title}</strong>
            <span className="game-card-blurb">{game.blurb}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
