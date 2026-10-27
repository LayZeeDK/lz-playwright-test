import assert from 'node:assert/strict';

import { parseSync, traverse, type NodePath, type types } from '@babel/core';

import { defined } from './defined.ts';

/** `code` parsed as TSX by `@babel/core`, with no Babel config file read. */
export function parse(code: string): types.File {
  const file = parseSync(code, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
  });
  assert.ok(file);

  return file;
}

/** The first path of `type` in `file`, in traversal order. */
export function firstPath(file: types.File, type: string): NodePath {
  const paths: NodePath[] = [];

  traverse(file, {
    enter(path) {
      if (path.type === type) {
        paths.push(path);
      }
    },
  });

  return defined(paths[0]);
}
