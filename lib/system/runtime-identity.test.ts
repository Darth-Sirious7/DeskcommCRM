import { describe, expect, it } from "vitest";
import { confirmedRuntime } from "@/tests/helpers/runtime-confirmation";
import {
  failureSupersededByRuntime,
  newerOfficialRelease,
  RUNTIME_MAX_AGE_MS,
  runtimeIdentity,
} from "./runtime-identity";

const at = "2026-10-20T12:00:00.000Z";
const now = new Date(at);
const identity = (snapshot: unknown) => runtimeIdentity(snapshot, at, now);

describe("host observation of applicable running services", () => {
  it("recognizes official and customized images on the same verified base", () => {
    expect(identity(confirmedRuntime("1.89.0", at))).toMatchObject({
      status: "confirmed",
      customized: false,
      base_version: "1.89.0",
    });
    expect(identity(confirmedRuntime("1.89.0", at, true))).toMatchObject({
      status: "confirmed",
      customized: true,
      base_version: "1.89.0",
    });
    expect(newerOfficialRelease("1.89.0", "v1.89.0")).toBe(false);
    expect(newerOfficialRelease("1.89.0", "v1.90.0")).toBe(true);
    expect(newerOfficialRelease("1.89.0", "v1.9.0")).toBe(false);
    expect(newerOfficialRelease("aabbcc", "v1.90.0")).toBeNull();
  });

  it.each(["revision", "base_version", "base_revision"] as const)(
    "does not confirm divergent %s",
    (field) => {
      const snapshot = confirmedRuntime("1.89.0", at);
      snapshot.services[1]![field] = field === "base_version" ? "1.88.0" : "c".repeat(40);
      expect(identity(snapshot).status).toBe("divergent");
    },
  );

  it("does not infer identity from a missing, unhealthy or unverified service", () => {
    for (const field of ["healthy", "running", "source_verified"] as const) {
      const snapshot = confirmedRuntime("1.89.0", at);
      snapshot.services[1]![field] = false;
      expect(identity(snapshot)).toMatchObject({ status: "partial", base_version: null });
    }
    const snapshot = confirmedRuntime("1.89.0", at);
    snapshot.services.pop();
    expect(identity(snapshot).status).toBe("unknown");
    expect(identity(null).status).toBe("legacy");
  });

  it("checks optional voice when present and refuses duplicate roles/containers", () => {
    const snapshot = confirmedRuntime("1.89.0", at);
    snapshot.services.push({
      ...snapshot.services[0]!,
      role: "voice-agent",
      container_id: "f".repeat(64),
      healthy: false,
    });
    expect(identity(snapshot).status).toBe("partial");
    snapshot.services[3] = { ...snapshot.services[0]! };
    expect(identity(snapshot).status).toBe("unknown");
  });

  it("expires observations, rejects future clocks and does not refresh old evidence on receive", () => {
    const snapshot = confirmedRuntime("1.89.0", at);
    expect(
      runtimeIdentity(snapshot, at, new Date(now.getTime() + RUNTIME_MAX_AGE_MS + 1)).status,
    ).toBe("stale");
    snapshot.collected_at = new Date(now.getTime() + 120_000).toISOString();
    expect(identity(snapshot).status).toBe("stale");
    snapshot.collected_at = new Date(now.getTime() - RUNTIME_MAX_AGE_MS - 1).toISOString();
    expect(identity(snapshot).status).toBe("stale");
  });

  it("a complete later reinstall clears the failure; a rollback or earlier observation does not", () => {
    const run = {
      status: "failed_rolled_back",
      from_version: "1.88.0",
      to_version: "v1.89.0",
      finished_at: "2026-10-20T11:59:00.000Z",
    };
    expect(failureSupersededByRuntime(identity(confirmedRuntime("1.89.0", at)), run)).toBe(true);
    expect(failureSupersededByRuntime(identity(confirmedRuntime("1.88.0", at)), run)).toBe(false);
    expect(
      failureSupersededByRuntime(identity(confirmedRuntime("1.89.0", at)), {
        ...run,
        finished_at: at,
      }),
    ).toBe(false);
    expect(
      failureSupersededByRuntime(
        { ...identity(confirmedRuntime("1.89.0", at)), status: "partial" },
        run,
      ),
    ).toBe(false);
  });
});
