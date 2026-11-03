export interface ImplicitRole {
  readonly role: string;
  readonly requiredAttribute?: string;
}

/** Keyed by lowercase tag name. */
export type RoleTable = ReadonlyMap<string, ImplicitRole>;

/**
 * The tags whose implicit role any engine gives by tag alone, or by tag and one attribute: Playwright 1.64.1's
 * table, on which aria-query 5.3.0 (Testing Library 10.4.2's `getByRole`) agrees except for `search` and `svg`.
 * A `role` equal to one of these is kept, since removing it changes nothing for some engine. The drift test,
 * test/implicit-roles.test.ts, checks the table against both.
 */
export const implicitRoles: RoleTable = new Map([
  ['a', { role: 'link', requiredAttribute: 'href' }],
  ['area', { role: 'link', requiredAttribute: 'href' }],
  ['article', { role: 'article' }],
  ['aside', { role: 'complementary' }],
  ['blockquote', { role: 'blockquote' }],
  ['button', { role: 'button' }],
  ['caption', { role: 'caption' }],
  ['code', { role: 'code' }],
  ['datalist', { role: 'listbox' }],
  ['dd', { role: 'definition' }],
  ['del', { role: 'deletion' }],
  ['details', { role: 'group' }],
  ['dfn', { role: 'term' }],
  ['dialog', { role: 'dialog' }],
  ['dt', { role: 'term' }],
  ['em', { role: 'emphasis' }],
  ['fieldset', { role: 'group' }],
  ['figure', { role: 'figure' }],
  ['h1', { role: 'heading' }],
  ['h2', { role: 'heading' }],
  ['h3', { role: 'heading' }],
  ['h4', { role: 'heading' }],
  ['h5', { role: 'heading' }],
  ['h6', { role: 'heading' }],
  ['hr', { role: 'separator' }],
  ['html', { role: 'document' }],
  ['ins', { role: 'insertion' }],
  ['li', { role: 'listitem' }],
  ['main', { role: 'main' }],
  ['mark', { role: 'mark' }],
  ['math', { role: 'math' }],
  ['menu', { role: 'list' }],
  ['meter', { role: 'meter' }],
  ['nav', { role: 'navigation' }],
  ['ol', { role: 'list' }],
  ['optgroup', { role: 'group' }],
  ['option', { role: 'option' }],
  ['output', { role: 'status' }],
  ['p', { role: 'paragraph' }],
  ['progress', { role: 'progressbar' }],
  ['search', { role: 'search' }],
  ['strong', { role: 'strong' }],
  ['sub', { role: 'subscript' }],
  ['sup', { role: 'superscript' }],
  ['svg', { role: 'img' }],
  ['table', { role: 'table' }],
  ['tbody', { role: 'rowgroup' }],
  ['textarea', { role: 'textbox' }],
  ['tfoot', { role: 'rowgroup' }],
  ['thead', { role: 'rowgroup' }],
  ['time', { role: 'time' }],
  ['tr', { role: 'row' }],
  ['ul', { role: 'list' }],
]);
