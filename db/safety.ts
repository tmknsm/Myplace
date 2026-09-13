/** Hosted-database guards. Never wipe Neon / RDS unless the operator is explicit. */

export function isHostedDatabase(url: string): boolean {
  return /neon\.tech|amazonaws\.com/i.test(url);
}

export function assertSafeToWipe(url = process.env.DATABASE_URL ?? ""): void {
  if (isHostedDatabase(url) && process.env.ALLOW_HOSTED_DB_RESET !== "1") {
    throw new Error(
      "Refusing to wipe or delete county data on a hosted database. Set ALLOW_HOSTED_DB_RESET=1 only for an intentional full reset.",
    );
  }
}
