import type { Context } from "hono";
import type { AppUser, Env } from "./types";

export type Variables = {
  user: AppUser;
};

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

export type Ctx = Context<AppContext>;
