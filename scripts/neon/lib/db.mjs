import { neon } from "@neondatabase/serverless";

export function requireDatabaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("DATABASE_URL is required for Neon operations");
  }
  return value;
}

export function connectDatabase(env = process.env) {
  return neon(requireDatabaseUrl(env));
}
