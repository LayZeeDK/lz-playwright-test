export const spanSwapRoleByTag: ReadonlyMap<string, string> = new Map([
  ['a', 'link'],
  ['area', 'link'],
  ['button', 'button'],
]);

const spanSwapRoles: ReadonlySet<string> = new Set(spanSwapRoleByTag.values());

export function swapsToSpan(role: string | undefined): boolean {
  return role !== undefined && spanSwapRoles.has(role);
}

/**
 * The attributes of `a`, `area` and `button` that a span cannot take under @types/react 19.3.0 (TS2322); a span
 * ignores them at run time.
 */
export const notOnSpan: ReadonlySet<string> = new Set([
  'alt',
  'coords',
  'disabled',
  'download',
  'form',
  'formAction',
  'formEncType',
  'formMethod',
  'formNoValidate',
  'formTarget',
  'href',
  'hrefLang',
  'media',
  'name',
  'ping',
  'referrerPolicy',
  'shape',
  'target',
  'type',
  'value',
]);
