import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS } from "./tools/index.js";

function getRawExecutorKeys(source) {
  const match = source.match(
    /export const TOOL_EXECUTORS = \{([\s\S]*?)\n\};/,
  );
  if (!match) return [];

  return [...match[1].matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)].map(
    (item) => item[1],
  );
}

test("tool executors are unique functions", () => {
  const source = fs.readFileSync(
    new URL("./tools/index.js", import.meta.url),
    "utf8",
  );
  const rawExecutorKeys = getRawExecutorKeys(source);
  const duplicateExecutorKeys = rawExecutorKeys.filter(
    (key, index) => rawExecutorKeys.indexOf(key) !== index,
  );

  assert.deepEqual(
    duplicateExecutorKeys,
    [],
    `Duplicate executor keys found: ${duplicateExecutorKeys.join(", ")}`,
  );

  for (const [name, executor] of Object.entries(TOOL_EXECUTORS)) {
    assert.equal(
      typeof executor,
      "function",
      `Executor "${name}" must be a function`,
    );
  }
});

test("tool definitions stay aligned with executors", () => {
  const definitionNames = TOOL_DEFINITIONS.map((item) => item?.function?.name)
    .filter(Boolean)
    .sort();
  const duplicateDefinitionNames = definitionNames.filter(
    (name, index) => definitionNames.indexOf(name) !== index,
  );

  assert.deepEqual(
    duplicateDefinitionNames,
    [],
    `Duplicate tool definitions found: ${duplicateDefinitionNames.join(", ")}`,
  );
  assert.deepEqual(
    definitionNames,
    Object.keys(TOOL_EXECUTORS).sort(),
    "Tool definitions and executors must stay in sync",
  );
});

test("pikora only plans tools that exist in the registry", () => {
  const source = fs.readFileSync(
    new URL("./pikoraService.js", import.meta.url),
    "utf8",
  );
  const plannedToolNames = [
    ...new Set(
      [...source.matchAll(/name:\s*"([a-z_][a-z0-9_]*)"/g)].map(
        (item) => item[1],
      ),
    ),
  ].sort();
  const missingToolNames = plannedToolNames.filter(
    (name) => !(name in TOOL_EXECUTORS),
  );

  assert.deepEqual(
    missingToolNames,
    [],
    `Pikora references unknown tools: ${missingToolNames.join(", ")}`,
  );
});
