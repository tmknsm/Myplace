import { afterEach, expect, test } from "vitest";
import { assertSafeToWipe, isHostedDatabase } from "./safety.ts";

const original = process.env.ALLOW_HOSTED_DB_RESET;

afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_HOSTED_DB_RESET;
  else process.env.ALLOW_HOSTED_DB_RESET = original;
});

test("isHostedDatabase flags Neon and RDS URLs", () => {
  expect(isHostedDatabase("postgres://ubuntu:myplace@localhost:5432/myplace")).toBe(false);
  expect(isHostedDatabase("postgresql://user:pass@ep-blue-glade-a5bxkx3q.us-east-1.aws.neon.tech/neondb")).toBe(true);
  expect(isHostedDatabase("postgres://user:pass@myplace.cluster-abc.us-east-1.rds.amazonaws.com/myplace")).toBe(true);
});

test("assertSafeToWipe refuses hosted URLs unless explicitly allowed", () => {
  delete process.env.ALLOW_HOSTED_DB_RESET;
  expect(() => assertSafeToWipe("postgres://x@ep-test.neon.tech/db")).toThrow(/hosted database/);
  process.env.ALLOW_HOSTED_DB_RESET = "1";
  expect(() => assertSafeToWipe("postgres://x@ep-test.neon.tech/db")).not.toThrow();
  expect(() => assertSafeToWipe("postgres://ubuntu@localhost/myplace")).not.toThrow();
});
