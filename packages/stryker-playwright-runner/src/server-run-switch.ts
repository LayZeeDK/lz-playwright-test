import fs from 'node:fs';
import path from 'node:path';

import { isRecord } from './is-record.ts';
import type { StrykerNamespace } from './namespace.ts';
import { serializeSnapshot } from './protocol.ts';
import {
  controlFile,
  parseServerControl,
  readServerControlText,
  type ServerControl,
} from './server-protocol.ts';

export interface RunSwitch {
  readonly control: () => ServerControl | undefined;
  readonly isIssued: (testId: string) => boolean;
  readonly startRequest: () => void;
  readonly flush: () => void;
}

export function runSwitch(
  dir: string,
  namespace: StrykerNamespace,
  fileName: string,
): RunSwitch {
  let run:
    | {
        control: ServerControl;
        writtenHits: number;
        writtenInstrumented: boolean;
      }
    | undefined;
  let text: string | undefined;
  let issued: ReadonlySet<string> = new Set();
  let warnedRead = false;

  function currentControl(): ServerControl | undefined {
    let read: string | undefined;

    try {
      read = readServerControlText(dir);
    } catch (error) {
      if (!warnedRead) {
        warnedRead = true;
        process.emitWarning(
          `${path.join(dir, controlFile)} cannot be read (${String(error)}), so requests keep the run they had until it can`,
        );
      }

      return run?.control;
    }

    if (read === text) {
      return run?.control;
    }

    text = read;
    const next = parseServerControl(read);
    issued = new Set(next?.issuedTestIds);

    if (read !== undefined && next === undefined) {
      process.emitWarning(
        `${path.join(dir, controlFile)} holds no valid server control, so requests switch no mutant and count for no run until the runner writes a valid one`,
      );
    }

    return next;
  }

  return {
    control: () => run?.control,
    isIssued: (testId) => issued.has(testId),
    startRequest: () => {
      const next = currentControl();

      if (run !== undefined && next?.outDir === run.control.outDir) {
        run.control = next;
      } else {
        namespace.hitLimit = next?.hitLimit;
        namespace.hitCount = next?.hitLimit === undefined ? undefined : 0;
        run =
          next === undefined
            ? undefined
            : { control: next, writtenHits: 0, writtenInstrumented: false };
      }

      namespace.activeMutant = next?.activeMutant;
    },
    // A throw here would end the server; after the run its folder is gone, so the write is dropped.
    flush: () => {
      if (run === undefined) {
        return;
      }

      const { control, writtenHits, writtenInstrumented } = run;
      const hits =
        typeof namespace.hitCount === 'number' ? namespace.hitCount : 0;
      const coverage = takeCoverage(namespace);
      const instrumented = namespace.instrumented === true;

      if (
        coverage === undefined &&
        hits === writtenHits &&
        instrumented === writtenInstrumented
      ) {
        return;
      }

      try {
        fs.appendFileSync(
          path.join(control.outDir, fileName),
          serializeSnapshot({
            mutantCoverage: coverage,
            hitCount: hits - writtenHits,
            outlivedItsTest: false,
            instrumented: namespace.instrumented,
          }) + '\n',
        );
      } catch {
        // Dropped, as above.
      }

      run.writtenHits = hits;
      run.writtenInstrumented = instrumented;
    },
  };
}

/** Copies the coverage and empties it in place: instrumented code holds the object it first created. */
function takeCoverage(namespace: StrykerNamespace): unknown {
  const coverage = namespace.mutantCoverage;

  if (
    !isRecord(coverage) ||
    !isRecord(coverage['static']) ||
    !isRecord(coverage['perTest'])
  ) {
    return undefined;
  }

  const { static: hits, perTest } = coverage;

  if (Object.keys(hits).length === 0 && Object.keys(perTest).length === 0) {
    return undefined;
  }

  const copy = structuredClone(coverage);
  Object.keys(hits).forEach((key) => {
    delete hits[key];
  });
  Object.keys(perTest).forEach((key) => {
    delete perTest[key];
  });

  return copy;
}
