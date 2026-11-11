# Writing glossary entries and ADRs

`AGENTS.md` says when a change updates a glossary, the glossary map or an ADR. This page says how.

## Glossary entries

- Write each entry as `**Term**:`, then one or two sentences that say what it is, then `_Avoid_:` with the rejected
  synonyms. Group entries under subheadings when clusters form.
- Add only terms specific to this project. A Stryker, Playwright or Storybook term belongs only where this project
  gives it a narrower or different meaning, and the definition says how.
- Keep entries to what the term means. Behaviour goes in the code and, where the package has one, its README;
  reasons go in an ADR.
- Give each concept one name across the glossaries. Define it in the context that owns it, and describe the
  hand-off in the map's relationships rather than defining it twice. An _Avoid_ list never bans a word that another
  glossary uses as its term.
- When a term is renamed, rename the code, tests and docs that use it in the same commit, and list the old name
  under `_Avoid_`. When the last thing a term names is removed, delete the entry.
- A new package either becomes a context, with `packages/<package>/GLOSSARY.md` and a map entry, or joins the
  context that owns its concepts, and the map names it under that context.

## ADRs

- Judge the three tests in `AGENTS.md` this way. Hard to reverse: changing your mind later costs real work.
  Surprising without context: a reader of the code would ask why it is done this way, or would "fix" it. A real
  trade-off: there was a genuine alternative, and you picked one for a reason. Typical cases are a package boundary,
  a plugin contract with Stryker or Playwright, a deliberate departure from the obvious approach, a constraint the
  code cannot show, and an alternative that was rejected for a reason someone would miss.
- Put a decision that spans contexts in `docs/adr/`, and a decision inside one context in the `docs/adr/` next to
  that context's `GLOSSARY.md`, such as `packages/stryker-storybook/docs/adr/` for the Storybook context, which also
  covers `storybook-mock-transformer`.
- Name the file `NNNN-slug.md` with the next number in that folder. Numbers are never reused.
- Start with a short title, then one to three sentences: the context, the decision, and why. Add a
  `Considered Options` section only when a reader would propose the rejected option again, and `Consequences` only
  for an effect that is not obvious.
- State the reason in the ADR itself. Chat, uncommitted notes and planning labels are not sources a reader can
  open.
- To supersede, write the new ADR and add frontmatter `status: superseded by ADR-NNNN` to the old one. The old ADR
  stays, and its decision text is not edited.
