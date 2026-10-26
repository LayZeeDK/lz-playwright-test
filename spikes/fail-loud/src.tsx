export function Dialog(props: { open: boolean; close: () => void }) {
  return (
    <div role="dialog" hidden={!props.open}>
      <h1>Settings</h1>
      {props.open && <p>Opened</p>}
      <button aria-label="Close" onClick={props.close}>
        x
      </button>
      <a href="/help">Help</a>
    </div>
  );
}
