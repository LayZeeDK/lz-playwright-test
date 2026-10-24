type Item = { id: string; label: string };
type Props = {
  open: boolean;
  busy: boolean;
  items: Item[];
  user: { name: string };
  error?: string;
  label: string;
  url: string;
  onClose: () => void;
  onSave: () => void;
};

function Badge(props: { tone: string; children?: unknown }) {
  return <span className={props.tone}>{props.children as string}</span>;
}

export function App({ open, busy, items, user, error, label, url, onClose, onSave }: Props) {
  return (
    <main>
      <h1>Edit items</h1>
      <p>
        Hello {user.name}, you have {items.length} items
      </p>
      <p title="Fish &amp; Chips">Fish &amp; Chips &mdash; daily</p>
      <button aria-label="Close dialog" onClick={onClose}>
        &times;
      </button>
      <button type="submit" disabled={busy} onClick={onSave}>
        Save
      </button>
      <input aria-label={label} placeholder="Search items" readOnly />
      <label htmlFor="q">Query</label>
      <input id="q" disabled />
      <a href="/docs">Docs</a>
      <a href={url}>External</a>
      <div role="dialog" aria-hidden={!open} hidden={!open}>
        {open && <p role="status">Opened</p>}
        {busy ? <span>Saving</span> : <span>Idle</span>}
      </div>
      <button aria-expanded={open} aria-pressed="true" onClick={() => onClose()}>
        Toggle
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {items.map((i) => (
          <li key={i.id}>{i.label}</li>
        ))}
      </ul>
      <>
        <Badge tone={busy ? 'warn' : 'ok'}>Status: {busy ? 'busy' : 'ready'}</Badge>
      </>
      <img alt="Logo" src="/logo.png" />
    </main>
  );
}
