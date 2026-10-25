// Production supplies one SQLite URL on the persistent volume. Local defaults
// preserve the existing development databases; never accept database URLs from
// request input. The presenter deployment runs one backend replica.
export function databaseUrl(localDefault: string) {
  const url = process.env.MING_DATABASE_URL?.trim();
  if (process.env.NODE_ENV === "production" && !url) {
    throw new Error("MING_DATABASE_URL is required in production.");
  }
  return url || localDefault;
}
