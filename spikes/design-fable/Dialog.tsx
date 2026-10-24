import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  busy: boolean;
  items: string[];
  onClose: () => void;
  onSave: (e: { preventDefault(): void }) => void;
};

function Link({ to, children }: { to: string; children: ReactNode }) {
  return <a href={to}>{children}</a>;
}

export function Dialog({ open, busy, items, onClose, onSave }: Props) {
  function onSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    onSave(e);
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Edit items</h1>
      <button type="button" onClick={onClose} aria-label="Close dialog">
        x
      </button>
      <button type="submit" disabled={busy}>
        Save
      </button>
      <input placeholder="Search" readOnly={busy} />
      <div role="dialog" hidden={!open} aria-hidden={!open}>
        {open && <p role="status">Opened</p>}
        {busy ? <span>Saving...</span> : <span>Idle</span>}
      </div>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <Link to="/help">Help</Link>
      <a href="/docs">Docs</a>
      <p hidden>Secret</p>
    </form>
  );
}
