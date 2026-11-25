import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Load the editor with stand-ins for the Max globals it touches.
function editor() {
	let saves = 0;
	const mgraphics = { size: [460, 169], redraw() {}, init() {} };
	const source = readFileSync(new URL("../src/pumpshaper-ui.js", import.meta.url), "utf8");
	const api = new Function("mgraphics", "outlet", "notifyclients",
		source + "\nreturn { onclick, ondrag, ondblclick, getvalueof, setvalueof, px, py };")(mgraphics, () => {}, () => saves++);
	return { ...api, saves: () => saves, nodes: () => api.getvalueof().length / 3 };
}

test("clicking the preset strip loads a preset and saves it", () => {
	const e = editor();
	e.onclick(460 * 3.5 / 8, 8); // "Hold"
	assert.equal(e.nodes(), 4);
	assert.equal(e.saves(), 1);
});

test("double click adds a node, double click on it removes it", () => {
	const e = editor();
	e.ondblclick(e.px(0.4), e.py(0.2));
	assert.equal(e.nodes(), 4);
	e.ondblclick(e.px(0.4), e.py(0.2));
	assert.equal(e.nodes(), 3);
	assert.equal(e.saves(), 2);
});

test("end nodes cannot be removed or moved sideways", () => {
	const e = editor();
	e.ondblclick(e.px(0), e.py(0));
	assert.equal(e.nodes(), 3);
	e.onclick(e.px(0), e.py(0));
	e.ondrag(e.px(0.5), e.py(0.5), 1);
	assert.deepEqual(e.getvalueof().slice(0, 2), [0, 0.5]);
});

test("dragging a node saves once on release and cannot pass its neighbour", () => {
	const e = editor();
	e.onclick(e.px(0.7), e.py(1));
	e.ondrag(e.px(0.5), e.py(0.8), 1);
	assert.equal(e.saves(), 0);
	e.ondrag(e.px(2), e.py(0.8), 0);
	assert.equal(e.saves(), 1);
	assert.equal(e.getvalueof()[3], 1);
});

test("dragging a line up bends it upward", () => {
	const e = editor();
	const before = e.getvalueof()[2];
	e.onclick(e.px(0.3), 100);
	e.ondrag(e.px(0.3), 70, 0);
	assert.ok(e.getvalueof()[2] < before);
});

test("a saved curve restores into a fresh editor", () => {
	const a = editor(), b = editor();
	a.ondblclick(a.px(0.2), a.py(0.6));
	b.setvalueof(...a.getvalueof());
	assert.deepEqual(b.getvalueof(), a.getvalueof());
});
