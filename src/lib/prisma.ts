import { PrismaClient } from "@prisma/client";

// Neon cold-start handling: a serverless Postgres instance that's been idle
// can take a couple of seconds to accept connections, which surfaces to
// Prisma as P1001 "Can't reach database server at …". Without a retry, the
// first request after an idle period crashes the page. We wrap every query
// through $extends so one transient whiff re-tries up to three times with a
// 2s delay before giving up, then lets the original error propagate.
function isReachabilityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const anyErr = err as { code?: string; errorCode?: string };
  if (anyErr.code === "P1001" || anyErr.errorCode === "P1001") return true;
  return /Can't reach database server/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

function makeClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  return base.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        let lastErr: unknown;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastErr = err;
            if (!isReachabilityError(err)) throw err;
            if (attempt === MAX_ATTEMPTS) break;
            // Surface the wait in dev logs so a slow Neon cold start looks
            // like a deliberate pause, not a hang.
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.warn(
                `[prisma] cold-start retry ${attempt}/${MAX_ATTEMPTS - 1} after ${RETRY_DELAY_MS}ms (Can't reach database server)`,
              );
            }
            await sleep(RETRY_DELAY_MS);
          }
        }
        throw lastErr;
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makeClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
