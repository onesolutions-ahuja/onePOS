import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schemaPath = new URL("../database/schema.sql", import.meta.url);

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function findForwardReferences(source) {
  const tables = new Map();
  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
  let match;
  while ((match = createTable.exec(source))) {
    tables.set(match[1].toLowerCase(), match.index);
  }

  const references = [
    { kind: "REFERENCES", pattern: /REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)/gi },
    { kind: "INDEX", pattern: /\bON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi },
    { kind: "ALTER TABLE", pattern: /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi },
  ];
  const defects = [];
  for (const { kind, pattern } of references) {
    while ((match = pattern.exec(source))) {
      const relation = match[1].toLowerCase();
      const createOffset = tables.get(relation);
      if (createOffset !== undefined && match.index < createOffset) {
        defects.push({
          kind,
          relation,
          line: lineNumber(source, match.index),
          createdOnLine: lineNumber(source, createOffset),
        });
      }
    }
  }
  return defects;
}

test("canonical schema has no forward relation references", async () => {
  const source = await readFile(schemaPath, "utf8");
  const defects = findForwardReferences(source);
  assert.deepEqual(defects, [], JSON.stringify(defects, null, 2));
});
