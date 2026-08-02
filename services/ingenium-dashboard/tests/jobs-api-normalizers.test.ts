import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  normalizeJobEventDelivery,
  normalizeJobPage,
  normalizeJobRun,
  normalizeJobRunLog,
  normalizeTrustedJobEvent,
  sanitizeJobDisplayText,
} from "../src/lib/api";

const timestamp = "2026-08-02T00:00:00.000Z";
const event = {
  id: "event-00000000-0000-0000-0000-000000000001",
  event_type: "context.conversation.archived",
  source_audit_event_id: "audit-00000000-0000-0000-0000-000000000001",
  created_at: timestamp,
};

const delivery = {
  id: "delivery-00000000-0000-0000-0000-000000000001",
  trusted_event_id: event.id,
  event_type: event.event_type,
  job_id: "job-00000000-0000-0000-0000-000000000001",
  job_name: "Archive handler",
  state: "dead_letter",
  attempt_count: 5,
  next_attempt_at: null,
  lease_expires_at: null,
  last_error_code: "request_failed",
  last_error_message: "Bearer token-should-not-survive",
  created_at: timestamp,
  updated_at: timestamp,
};

afterEach(() => vi.unstubAllGlobals());

describe("Jobs response allowlisting", () => {
  it("keeps only exact trusted-event and delivery fields", () => {
    const normalizedEvent = normalizeTrustedJobEvent({
      ...event,
      payload: "payload-must-not-survive",
      dedupe_key: "dedupe-must-not-survive",
      schema_version: 1,
      title: "title-must-not-survive",
    });
    const normalizedDelivery = normalizeJobEventDelivery({
      ...delivery,
      lease_owner_hash: "lease-owner-must-not-survive",
      process_id: 7331,
      prompt_template: "prompt-must-not-survive",
      nested: { AWS_SECRET_ACCESS_KEY: "secret-must-not-survive" },
    });

    expect(normalizedEvent).toEqual(event);
    expect(Object.keys(normalizedDelivery)).toEqual([
      "id", "trusted_event_id", "event_type", "job_id", "job_name", "state",
      "attempt_count", "next_attempt_at", "lease_expires_at", "last_error_code",
      "last_error_message", "created_at", "updated_at",
    ]);
    expect(JSON.stringify(normalizedDelivery)).not.toContain("token-should-not-survive");
    expect(JSON.stringify(normalizedDelivery)).not.toContain("lease-owner-must-not-survive");
    expect(JSON.stringify(normalizedDelivery)).not.toContain("secret-must-not-survive");
  });

  it("normalizes run metadata and successful log lines before callers receive them", () => {
    const run = normalizeJobRun({
      id: "run-00000000-0000-0000-0000-000000000001",
      job_id: delivery.job_id,
      status: "running",
      trigger: "event",
      started_at: timestamp,
      created_at: timestamp,
      event_delivery: {
        delivery_id: delivery.id,
        trusted_event_id: event.id,
        attempt_number: 1,
        delivery_state: "leased",
        lease_owner_hash: "lease-owner-must-not-survive",
      },
      environment: { OPENAI_API_KEY: "secret-must-not-survive" },
    });
    const log = normalizeJobRunLog({
      id: 1,
      run_id: run.id,
      seq: 1,
      stream: "stdout",
      line: "completed OPENAI_API_KEY = real-secret and normal queue item",
      created_at: timestamp,
      process_id: 7331,
    });

    expect(run).toEqual({
      id: run.id,
      job_id: delivery.job_id,
      status: "running",
      trigger: "event",
      started_at: timestamp,
      created_at: timestamp,
      event_delivery: {
        delivery_id: delivery.id,
        trusted_event_id: event.id,
        attempt_number: 1,
        delivery_state: "leased",
      },
    });
    expect(log.line).toBe("completed OPENAI_API_KEY = [REDACTED] and normal queue item");
    expect(JSON.stringify({ run, log })).not.toContain("secret-must-not-survive");
    expect(JSON.stringify({ run, log })).not.toContain("lease-owner-must-not-survive");
  });

  it("rejects invalid required fields, states, and cursors instead of returning partial raw DTOs", () => {
    expect(() => normalizeJobEventDelivery({ ...delivery, state: "replay" })).toThrow("Invalid delivery state");
    expect(() => normalizeJobRunLog({ id: 1, run_id: "run", seq: 1, stream: "stdout", line: 7, created_at: timestamp })).toThrow("Invalid log response");
    expect(() => normalizeJobPage({ data: [event], nextCursor: "x".repeat(513) }, normalizeTrustedJobEvent)).toThrow("Invalid job page response");
    expect(() => normalizeTrustedJobEvent({ ...event, created_at: "2026-02-31T00:00:00.000Z" })).toThrow("Invalid trusted event timestamp");
    expect(() => api.jobs.trustedEvents("fixture-project", { cursor: "x".repeat(513) })).toThrow("Job request cursor is invalid");
  });

  it("redacts headers, JSON, URL credentials, generic environment names, and preserves ordinary text", () => {
    const secretText = [
      "Bearer bearer-secret",
      "authorization : Basic basic-secret",
      'cookie = "cookie-secret"',
      'JSON {"refresh_token":"refresh-secret","AWS_SECRET_ACCESS_KEY":"aws-secret"}',
      "https://example.test/?access_token=url-secret&safe=one",
      "OPENAI_API_KEY = openai-secret",
    ].join("\n");
    const redacted = sanitizeJobDisplayText(secretText, "fallback", { maxBytes: 1_024, maxLines: 16 });

    for (const secret of ["bearer-secret", "basic-secret", "cookie-secret", "refresh-secret", "aws-secret", "url-secret", "openai-secret"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain("[REDACTED]");
    expect(sanitizeJobDisplayText("worker failed after 3 attempts for queue-item-7", "fallback")).toBe("worker failed after 3 attempts for queue-item-7");
  });

  it("normalizes opaque server responses through the Jobs client before returning them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ ...delivery, lease_owner_hash: "lease-owner-must-not-survive", payload: "payload-must-not-survive" }],
      nextCursor: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await api.jobs.eventDeliveries("fixture project", { limit: 20 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/jobs/event-deliveries?project=fixture+project&limit=20");
    expect(JSON.stringify(page)).not.toContain("lease-owner-must-not-survive");
    expect(JSON.stringify(page)).not.toContain("payload-must-not-survive");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...delivery, state: "replay" }], nextCursor: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(api.jobs.eventDeliveries("fixture-project")).rejects.toMatchObject({ message: "Invalid job response." });
  });
});
