/**
 * Turns a thrown Error into a readable message and a non-zero exit code.
 *
 * Imported first by `seed.mjs`, before `locality.mjs`, because ESM evaluates imports in source
 * order — so this is registered by the time the locality guard runs, and its refusal reaches the
 * operator as the message it was written to be rather than as the middle of a stack trace. The
 * guard's whole job is to say which knob to turn; burying that under ten lines of node internals
 * would waste it.
 *
 * Handles both paths: a throw during module evaluation (the guard) arrives as an uncaught
 * exception, while a throw from `seed.mjs`'s top-level `await` arrives as an unhandled rejection.
 */

function report(error) {
  const parts = [];
  if (error instanceof Error) {
    parts.push(error.message);
    // `fetch` reports every transport failure as a bare "fetch failed"; the actionable detail
    // (ECONNREFUSED, DNS failure) is only on the cause.
    if (error.cause instanceof Error) {
      parts.push(`  cause: ${error.cause.message}`);
      if (error.cause.code === 'ECONNREFUSED') {
        parts.push(
          `  Nothing is listening there. Start the backend first:\n` +
            `    cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev`,
        );
      }
    }
  } else {
    parts.push(String(error));
  }
  console.error(`\n${parts.join('\n')}\n`);
  fail();
}

/**
 * Fail with exit code 1 — by *setting* the code, never by calling `process.exit()`.
 *
 * Calling `process.exit(1)` from this handler tears the process down while undici's keep-alive
 * socket is still closing, and libuv trips an assertion:
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
 *
 * The process then dies with 0xC0000409 instead of 1, printing a C-level assertion directly under
 * the message this module exists to keep readable — so a caller cannot tell a handled failure from
 * a crash. Reproduced on Node 24.14.0 / Windows on two independent paths: an unexpected HTTP
 * status mid-apply, and `--remove` refusing an ambiguous title.
 *
 * Deferring the exit by a tick was tried and is *not* enough — the second path still asserted.
 * Setting `exitCode` and letting the loop drain naturally is what actually works, and it does not
 * hang: undici unrefs idle keep-alive sockets, so they do not hold the loop open. Measured on both
 * failure paths at ~250-360ms to exit, versus the keep-alive timeout one might expect.
 *
 * The rule this encodes: nothing in this directory may call `process.exit()` after a `fetch`.
 */
function fail() {
  process.exitCode = 1;
}

process.on('uncaughtException', report);
process.on('unhandledRejection', report);
