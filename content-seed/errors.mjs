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
  process.exit(1);
}

process.on('uncaughtException', report);
process.on('unhandledRejection', report);
