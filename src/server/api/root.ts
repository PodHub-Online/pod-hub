import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "~/server/api/routers/user";
import { whoopRouter } from "~/server/api/routers/whoop";
import { funRouter } from "~/server/api/routers/fun";
import { moreRouter } from "~/server/api/routers/more";
import { statsRouter } from "~/server/api/routers/stats";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  user: userRouter,
  whoop: whoopRouter,
  fun: funRouter,
  more: moreRouter,
  stats: statsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
