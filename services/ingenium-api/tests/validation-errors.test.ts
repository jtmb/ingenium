import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../lib/middleware/errors.js";
import { validate } from "../lib/middleware/validate.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

describe("Zod 4 HTTP validation compatibility", () => {
  it("keeps middleware and directly thrown schema errors at 422 with field details", async () => {
    const schema = z.object({ fields: z.record(z.string(), z.string()), count: z.coerce.number().int().positive() });
    const app = express();
    app.use(express.json());
    app.post("/middleware", validate(schema), (req, res) => res.json(req.body));
    app.post("/parse", (req, res) => res.json(schema.parse(req.body)));
    app.use(errorHandler);
    const server = createServer(app), base = await listenOnLoopback(server);
    try {
      for (const path of ["/middleware", "/parse"]) {
        const response = await fetch(`${base}${path}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fields: { value: 123 }, count: 0 }),
        });
        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.details.map((issue: { field: string }) => issue.field)).toEqual(["fields.value", "count"]);
      }
      const accepted = await fetch(`${base}/middleware`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: { value: "retained" }, count: "2" }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ fields: { value: "retained" }, count: 2 });
    } finally { await closeHttpServer(server); }
  });
});
