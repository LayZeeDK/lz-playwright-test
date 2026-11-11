# Agent guide

## Domain language

Before you name a type, function, option, test or heading, read the glossary of the context you work in.
`GLOSSARY-MAP.md` lists the contexts, links each one's `GLOSSARY.md`, and says how the contexts relate. Use each
term as its glossary defines it; the words under _Avoid_ are rejected synonyms.

When a change adds or renames a concept that package users or maintainers name, changes what a term covers, or
removes the last thing a term names, update that context's `GLOSSARY.md` in the same commit. When it adds, removes
or merges a package or context, or changes what one context hands to another, update `GLOSSARY-MAP.md`. How:
`references/glossaries-and-adrs.md`.

## Decisions

Before you change how something works, read the ADRs that cover it: `docs/adr/` for decisions across contexts,
and the `docs/adr/` next to a context's `GLOSSARY.md` for decisions inside that context. Work within them.

When a change makes a decision that is hard to reverse, surprising without context and the result of a real
trade-off, write an ADR in the same commit. When it reverses, narrows or widens a decision an ADR records,
supersede that ADR. How: `references/glossaries-and-adrs.md`.
