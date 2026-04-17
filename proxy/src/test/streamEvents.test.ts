/**
 * Tests for Phase K.K1 — unified streaming event taxonomy.
 */

import assert from "node:assert";
import {
  createStreamEvent,
  formatStreamEvent,
  isEventStreamRequested,
  type StreamEvent,
  type SubagentStartData,
} from "../gateway/streamEvents";

export function testCreateStreamEventSetsTimestamp() {
  const before = Date.now();
  const event = createStreamEvent("subagent.start", {
    taskId: "t1",
    name: "researcher",
    description: "Searches code",
  } satisfies SubagentStartData);
  assert.ok(event.ts >= before);
  assert.strictEqual(event.type, "subagent.start");
  assert.strictEqual((event.data as SubagentStartData).taskId, "t1");
  assert.strictEqual(event.ns, undefined);
}

export function testCreateStreamEventWithNamespace() {
  const event = createStreamEvent(
    "subagent.token",
    { taskId: "t1", content: "hello" },
    "t1",
  );
  assert.strictEqual(event.ns, "t1");
}

export function testFormatStreamEventProducesSSE() {
  const event = createStreamEvent("todo.update", {
    checklist: "- [ ] step 1",
  });
  const sse = formatStreamEvent(event);
  assert.ok(sse.startsWith("event: todo.update\n"));
  assert.ok(sse.includes("data: {"));
  assert.ok(sse.endsWith("\n\n"));
  // Parseable JSON in the data line.
  const dataLine = sse.split("\n").find((l) => l.startsWith("data: "));
  assert.ok(dataLine);
  const parsed = JSON.parse(dataLine!.slice(6)) as StreamEvent;
  assert.strictEqual(parsed.type, "todo.update");
}

export function testIsEventStreamRequestedTrue() {
  assert.strictEqual(isEventStreamRequested({ "x-af-stream": "events" }), true);
  assert.strictEqual(isEventStreamRequested({ "x-af-stream": "Events" }), true);
}

export function testIsEventStreamRequestedFalse() {
  assert.strictEqual(isEventStreamRequested({}), false);
  assert.strictEqual(isEventStreamRequested({ "x-af-stream": "plain" }), false);
  assert.strictEqual(
    isEventStreamRequested({ "x-af-stream": undefined }),
    false,
  );
}

export function testIsEventStreamRequestedArray() {
  assert.strictEqual(
    isEventStreamRequested({ "x-af-stream": ["events", "other"] }),
    true,
  );
  assert.strictEqual(
    isEventStreamRequested({ "x-af-stream": ["plain"] }),
    false,
  );
}
