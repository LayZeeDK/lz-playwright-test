// The fixture's JSX factory. It follows React DOM's prop rules, so a mutant renders here as it would under React;
// like React, it writes aria-* and data-* booleans as "true"/"false" instead of omitting false.
type Child =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child[];

export function h(
  tag: string,
  props: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(props ?? {})) {
    if (/^on[A-Z]/.test(name)) {
      if (typeof value === 'function') {
        element.addEventListener(
          name.slice(2).toLowerCase(),
          value as EventListener,
        );
      }

      continue;
    }

    const attribute = name === 'htmlFor' ? 'for' : name;

    if (value === undefined || value === null) {
      continue;
    }

    if (/^(aria|data)-/.test(attribute)) {
      element.setAttribute(attribute, String(value));
    } else if (value !== false) {
      element.setAttribute(attribute, value === true ? '' : String(value));
    }
  }

  append(element, children);

  return element;
}

function append(parent: HTMLElement, children: readonly Child[]): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child instanceof Node) {
      parent.append(child);
    } else if (
      child !== null &&
      child !== undefined &&
      typeof child !== 'boolean'
    ) {
      parent.append(String(child));
    }
  }
}
