import { test } from "node:test";
import assert from "node:assert/strict";
import { probeLiveWorker } from "../../scripts/live-worker-probe.mjs";

const invalid = () => Response.json({ error: "The AI provider returned an unrecognized response format. Please try again." }, { status: 502 });
const valid = () => Response.json({ type: "report", markdown: "Visa requirements" });

test("production probe retries invalid format once and accepts a usable report", async () => {
  let calls = 0;
  const result = await probeLiveWorker({ request: {}, fetchImpl: async () => (++calls === 1 ? invalid() : valid()) });
  assert.equal(calls, 2);
  assert.equal(result.data.markdown, "Visa requirements");
});

test("production probe classifies a repeated invalid format as a product defect", async () => {
  let calls = 0;
  await assert.rejects(probeLiveWorker({ request: {}, fetchImpl: async () => { calls += 1; return invalid(); } }), (error) => {
    assert.equal(error.classification, "product defect");
    assert.equal(error.httpStatus, 502);
    return /unrecognized response format/i.test(error.message);
  });
  assert.equal(calls, 2);
});

test("production probe keeps other availability failures unexercised", async () => {
  let calls = 0;
  await assert.rejects(probeLiveWorker({ request: {}, fetchImpl: async () => { calls += 1; return Response.json({ error: "upstream unavailable" }, { status: 503 }); } }), /provider\/request unavailable/);
  assert.equal(calls, 1);
});

test("production probe rejects an unusable retry as a product defect", async () => {
  let calls = 0;
  await assert.rejects(probeLiveWorker({ request: {}, fetchImpl: async () => (++calls === 1 ? invalid() : Response.json({ type: "report", markdown: " " })) }), (error) => error.classification === "product defect");
  assert.equal(calls, 2);
});

test("production probe classifies a rejected retry request as a product defect", async () => {
  let calls = 0;
  await assert.rejects(probeLiveWorker({ request: {}, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return invalid();
    throw new Error("connection reset");
  } }), (error) => error.classification === "product defect" && /connection reset/.test(error.message));
  assert.equal(calls, 2);
});

test("production probe classifies a retry response body read failure as a product defect", async () => {
  let calls = 0;
  await assert.rejects(probeLiveWorker({ request: {}, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return invalid();
    return { ok: true, status: 200, text: async () => { throw new Error("body stream reset"); } };
  } }), (error) => error.classification === "product defect" && /body stream reset/.test(error.message));
  assert.equal(calls, 2);
});
