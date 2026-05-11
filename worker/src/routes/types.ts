import type { Hono } from "hono";
import type { AppContext } from "../app-context";

export type RouteApp = Hono<AppContext>;
export type RouteDeps = Record<string, any>;
