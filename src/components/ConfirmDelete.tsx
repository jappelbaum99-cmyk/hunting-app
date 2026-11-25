import { useEffect, useState } from 'react';

// A Delete button that asks right where it is ("Delete X? Delete it / Keep")
// instead of a browser pop-up, which some windows (like a preview pane) answer
// "Cancel" to on their own. It goes back to plain Delete after a few seconds.
export function ConfirmDelete(props: { question: string; onDelete(): void; label?: string }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 8000);
    return () => clearTimeout(timer);
  }, [asking]);
  if (!asking) {
    return (
      <button className="danger" onClick={() => setAsking(true)}>
        {props.label ?? 'Delete'}
      </button>
    );
  }
  return (
    <span className="confirm-delete" role="group" aria-label={props.question}>
      <span className="confirm-delete-question">{props.question}</span>
      <button className="danger" onClick={props.onDelete} autoFocus>
        Delete it
      </button>
      <button onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}
