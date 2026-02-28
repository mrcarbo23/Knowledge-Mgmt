import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Return a proxy that throws on actual usage (allows build to succeed)
    return new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
      get(_target, prop) {
        if (prop === "then" || prop === "catch") return undefined;
        return () => {
          throw new Error("DATABASE_URL is not configured");
        };
      },
    });
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export const db = createDb();

export type Database = ReturnType<typeof drizzle<typeof schema>>;
