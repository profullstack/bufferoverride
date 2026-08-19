#!/usr/bin/env node
import { main } from '../src/main.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    // Anything reaching here is a bug rather than a refusal; refusals are
    // printed and returned as an exit code by the command that raised them.
    console.error(`bo: ${err?.stack ?? err}`);
    process.exitCode = 70;
  },
);
