import type { Context } from "hono";
import type { AuthenticatedUser, Env } from "./types";

export type Variables = {
  user: AuthenticatedUser;
};

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

export type Ctx = Context<AppContext>;
