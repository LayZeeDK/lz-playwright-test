// The JSX types of h.ts: every tag is an HTML element, and any prop goes through.
declare namespace JSX {
  type Element = HTMLElement;

  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
