import { drizzle } from "drizzle-orm/better-sqlite3";
import sqliteDatabase from "./database";
import * as schema from "./schema";

// Create and export the Drizzle ORM instance initialized with the existing better-sqlite3 connection
export const db = drizzle(sqliteDatabase, { schema });
