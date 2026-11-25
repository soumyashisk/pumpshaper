import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { buildEffect, buildTrigger, amxd } from "../build.mjs";

// The UI script is plain Max JS; evaluate it with a stub module object.
const module_ = { exports: {} };
new Function("module", readFileSync(new URL("../src/pumpshaper-ui.js", import.meta.url), "utf8"))(module_);
const { valueAt, renderTable, serialize, deserialize, PRESETS } = module_.exports;

test("every preset is valid, bounded and survives save/restore", () => {
	for (const p of PRESETS) {
		const table = renderTable(p.nodes, 2048);
		assert.ok(table.every((v) => v >= 0 && v <= 1), p.name);
		assert.deepEqual(deserialize(serialize(p.nodes)), p.nodes, p.name);
	}
});

test("segments hit their nodes and bend stays monotonic", () => {
	for (const c of [-1, 0, 1]) {
		const nodes = [{ x: 0, y: 0, c }, { x: 1, y: 1, c: 0 }];
		assert.equal(valueAt(nodes, 0), 0);
		assert.equal(valueAt(nodes, 1), 1);
		for (let i = 1; i <= 100; i++) assert.ok(valueAt(nodes, i / 100) >= valueAt(nodes, (i - 1) / 100));
	}
});

test("bad saved data is rejected", () => {
	for (const bad of [[], [0], [0, 0, 0], [0.5, 0, 0, 1, 1, 0], [0, "a", 0, 1, 1, 0], [0, 0, 0, 0.8, 1, 0, 0.2, 1, 0, 1, 1, 0]]) {
		assert.equal(deserialize(bad), null, String(bad));
	}
});

test("every patch cord points at a real inlet and outlet", () => {
	for (const { patcher } of [buildEffect(), buildTrigger()]) {
		const check = (patch) => {
			const byId = new Map(patch.boxes.map((b) => [b.box.id, b.box]));
			for (const { patchline: { source, destination } } of patch.lines) {
				assert.ok(source[1] < byId.get(source[0]).numoutlets, `outlet ${source} ${byId.get(source[0]).text}`);
				assert.ok(destination[1] < byId.get(destination[0]).numinlets, `inlet ${destination} ${byId.get(destination[0]).text}`);
			}
			for (const b of byId.values()) if (b.patcher) check(b.patcher);
		};
		check(patcher);
	}
});

test("amxd container lengths are consistent", () => {
	const file = amxd("aaaa", buildEffect());
	assert.equal(file.toString("latin1", 0, 4), "ampf");
	assert.equal(file.toString("latin1", 8, 12), "aaaa");
	assert.equal(file.readUInt32LE(28), file.length - 32);
	JSON.parse(file.subarray(32, -1).toString());
});

test("project block has the keys Max needs to load an .amxd without crashing", () => {
	for (const { patcher } of [buildEffect(), buildTrigger()]) {
		for (const key of ["searchpath", "contents", "layout", "amxdtype"]) assert.ok(key in patcher.project, key);
	}
});
