import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { demoRouter } from "~/server/demo/router";
import { isDemoCookie } from "~/server/demo/session";


const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    // a demo session gets pretend data and never reaches the real router
    router: isDemoCookie(req.headers.get("cookie")) ? demoRouter : appRouter,
    createContext: ({ }) => createTRPCContext({ headers: req.headers}),
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`
            );
          }
        : undefined,
  });

export { handler as GET, handler as POST };
