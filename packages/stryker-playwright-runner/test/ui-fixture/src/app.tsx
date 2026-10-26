import { h } from './h.js';

const state = { open: false, busy: true, revealed: false, total: 42 };
const actions = {
  toggle() {
    state.open = !state.open;
    render();
  },
  reveal() {
    state.revealed = true;
    render();
  },
};

function App({ open, busy, revealed, total }: typeof state) {
  return (
    <main>
      <h1>Orders</h1>
      <button aria-expanded={open} onClick={actions.toggle}>
        Menu
      </button>
      {open && <p>Details panel</p>}
      <section hidden={!open}>Region content</section>
      {open && (
        <div role="dialog" aria-label="Settings">
          <button aria-label="Close" onClick={actions.toggle}>
            &times;
          </button>
        </div>
      )}
      <button onClick={actions.reveal}>Show</button>
      {revealed && <p role="status">Revealed</p>}
      <button type="submit" disabled={busy}>
        Submit
      </button>
      <a href="#/done">Done</a>
      <span data-testid="total">{total}</span>
      <footer>Footer note</footer>
    </main>
  );
}

function render() {
  document.body.replaceChildren(App(state));
}

render();
