// PumpShaper curve editor (v8ui).
//
// Curve model: nodes sorted by x, each {x, y, c}. x is the position in the
// cycle (0..1), y is the volume (0 = silent, 1 = untouched) and c bends the
// segment that STARTS at that node (-1..1).

autowatch = 0;
inlets = 1;
outlets = 1; // timing messages

var TABLE_SIZE = 2048;
var MAX_NODES = 24;
var BAR_HEIGHT = 18;
var HIT = 7;

var RATES = [
	{ note: "1n", beats: 4 },
	{ note: "2n", beats: 2 },
	{ note: "4n", beats: 1 },
	{ note: "8n", beats: 0.5 },
	{ note: "16n", beats: 0.25 },
	{ note: "4nd", beats: 1.5 },
	{ note: "8nd", beats: 0.75 },
	{ note: "4nt", beats: 2 / 3 },
	{ note: "8nt", beats: 1 / 3 }
];

function n(x, y, c) { return { x: x, y: y, c: c || 0 }; }

var PRESETS = [
	{ name: "Pump", nodes: [n(0, 0, -0.35), n(0.7, 1), n(1, 1)] },
	{ name: "Tight", nodes: [n(0, 0, -0.3), n(0.34, 1), n(1, 1)] },
	{ name: "Long", nodes: [n(0, 0, 0.25), n(0.96, 1), n(1, 1)] },
	{ name: "Hold", nodes: [n(0, 0), n(0.25, 0, -0.25), n(0.55, 1), n(1, 1)] },
	{ name: "Smooth", nodes: [n(0, 0, 0.3), n(0.3, 0.35, -0.3), n(0.65, 1), n(1, 1)] },
	{ name: "Soft", nodes: [n(0, 0.35, -0.3), n(0.6, 1), n(1, 1)] },
	{ name: "Snap", nodes: [n(0, 1, 0.5), n(0.04, 0, -0.5), n(0.5, 1), n(1, 1)] },
	{ name: "Gate", nodes: [n(0, 0), n(0.48, 0), n(0.52, 1), n(0.98, 1), n(1, 0)] }
];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function copyNodes(list) { return list.map(function (p) { return n(p.x, p.y, p.c); }); }

function bend(t, c) { return Math.pow(t, Math.pow(2, c * 3)); }

function valueAt(list, x) {
	for (var i = 0; i < list.length - 1; i++) {
		var a = list[i], b = list[i + 1];
		if (x <= b.x) {
			var span = b.x - a.x;
			if (span <= 0) return b.y;
			return a.y + (b.y - a.y) * bend(clamp((x - a.x) / span, 0, 1), a.c);
		}
	}
	return list[list.length - 1].y;
}

// Attenuation table, which is what the DSP reads.
function renderTable(list, size) {
	var table = new Array(size);
	for (var i = 0; i < size; i++) table[i] = 1 - valueAt(list, i / (size - 1));
	return table;
}

function round4(v) { return Math.round(v * 10000) / 10000; }

// Saved form: x, y, c for each node, as one flat list of numbers.
function serialize(list) {
	var out = [];
	list.forEach(function (p) { out.push(round4(p.x), round4(p.y), round4(p.c)); });
	return out;
}

// Returns null for anything that is not a well formed saved curve.
function deserialize(values) {
	var count = values.length / 3;
	if (count !== Math.floor(count) || count < 2 || count > MAX_NODES) return null;
	var list = [];
	for (var i = 0; i < count; i++) {
		var f = values.slice(i * 3, i * 3 + 3).map(Number);
		if (!f.every(isFinite)) return null;
		var x = clamp(f[0], 0, 1);
		if (i > 0 && x < list[i - 1].x) return null;
		list.push(n(x, clamp(f[1], 0, 1), clamp(f[2], -1, 1)));
	}
	if (list[0].x !== 0 || list[list.length - 1].x !== 1) return null;
	return list;
}

function same(a, b) { return serialize(a).join(" ") === serialize(b).join(" "); }

// ---------------------------------------------------------------- state

var nodes = copyNodes(PRESETS[0].nodes);
var buffers = null;
var rateIndex = 2;
var bpm = 120;
var head = -1;
var drag = null;
var width = 400;
var height = 169;

function writeTable() {
	if (!buffers) return;
	buffers.curve.poke(1, 0, renderTable(nodes, TABLE_SIZE));
}

// Tells Max the saved value changed (Live then stores it with the Set).
function save() { notifyclients(); }

function redraw() { mgraphics.redraw(); }

function setup(curveName, inName, outName) {
	buffers = {
		curve: new Buffer(curveName),
		input: new Buffer(inName),
		output: new Buffer(outName)
	};
	writeTable();
	sendTiming();
	redraw();
}

// This object is itself the Live parameter that holds the curve.
function getvalueof() { return serialize(nodes); }

function setvalueof() {
	var values = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
	var list = deserialize(values);
	if (!list || same(list, nodes)) return;
	nodes = list;
	drag = null;
	writeTable();
	redraw();
}

function preset(index) {
	var p = PRESETS[index];
	if (!p) return;
	nodes = copyNodes(p.nodes);
	writeTable();
	save();
	redraw();
}

function sendTiming() {
	var rate = RATES[rateIndex];
	outlet(0, "note", rate.note);
	outlet(0, "oneshot", rate.beats * 60000 / bpm);
}

function rate(index) {
	if (!RATES[index]) return;
	rateIndex = index;
	sendTiming();
	redraw();
}

function bpmchange(value) {
	if (!(value > 0)) return;
	bpm = value;
	outlet(0, "oneshot", RATES[rateIndex].beats * 60000 / bpm);
}

function playhead(value) {
	head = value;
	redraw();
}

// ---------------------------------------------------------------- drawing

function px(x) { return x * (width - 12) + 6; }
function py(y) { return (1 - y) * (height - BAR_HEIGHT - 12) + BAR_HEIGHT + 6; }
function ux(p) { return clamp((p - 6) / (width - 12), 0, 1); }
function uy(p) { return clamp(1 - (p - BAR_HEIGHT - 6) / (height - BAR_HEIGHT - 12), 0, 1); }

function rgba(r, g, b, a) { mgraphics.set_source_rgba(r, g, b, a); }

function block(x, y, w, h) {
	mgraphics.rectangle(x, y, w, h);
	mgraphics.fill();
}

function line(x1, y1, x2, y2) {
	mgraphics.move_to(x1, y1);
	mgraphics.line_to(x2, y2);
	mgraphics.stroke();
}

function drawScope(buffer, alpha) {
	var count = buffer.framecount();
	if (!(count > 0)) return;
	var data = buffer.peek(1, 0, count);
	var floor = py(0);
	var full = floor - py(1);
	rgba(0.55, 0.75, 0.85, alpha);
	var columns = Math.max(1, Math.floor((width - 12) / 2));
	for (var i = 0; i < columns; i++) {
		var from = Math.floor(i * count / columns);
		var to = Math.max(from + 1, Math.floor((i + 1) * count / columns));
		var peak = 0;
		for (var j = from; j < to; j++) peak = Math.max(peak, data[j]);
		var h = Math.min(1, peak) * full;
		if (h > 0.5) block(6 + i * 2, floor - h, 1.5, h);
	}
}

function curvePath() {
	var steps = Math.max(2, Math.floor(width - 12));
	mgraphics.move_to(px(0), py(nodes[0].y));
	var next = 1;
	for (var i = 1; i <= steps; i++) {
		var x = i / steps;
		// Visit nodes exactly so sharp corners are not rounded off.
		while (next < nodes.length && nodes[next].x <= x) {
			mgraphics.line_to(px(nodes[next].x), py(nodes[next].y));
			next++;
		}
		mgraphics.line_to(px(x), py(valueAt(nodes, x)));
	}
}

function paint() {
	var size = mgraphics.size;
	width = size[0];
	height = size[1];

	rgba(0.09, 0.1, 0.12, 1);
	block(0, 0, width, height);

	rgba(1, 1, 1, 0.07);
	mgraphics.set_line_width(1);
	for (var i = 1; i < 4; i++) {
		line(px(i / 4), py(1), px(i / 4), py(0));
		line(px(0), py(i / 4), px(1), py(i / 4));
	}

	if (buffers) {
		drawScope(buffers.input, 0.18);
		drawScope(buffers.output, 0.45);
	}

	curvePath();
	mgraphics.line_to(px(1), py(1));
	mgraphics.line_to(px(0), py(1));
	mgraphics.close_path();
	rgba(1, 0.6, 0.15, 0.13);
	mgraphics.fill();

	curvePath();
	rgba(1, 0.65, 0.2, 1);
	mgraphics.set_line_width(2);
	mgraphics.stroke();

	for (var k = 0; k < nodes.length; k++) {
		rgba(1, 0.85, 0.6, 1);
		mgraphics.ellipse(px(nodes[k].x) - 3.5, py(nodes[k].y) - 3.5, 7, 7);
		mgraphics.fill();
	}

	if (head >= 0) {
		rgba(1, 1, 1, 0.6);
		mgraphics.set_line_width(1);
		line(px(head), py(1), px(head), py(0));
	}

	// Preset strip.
	var w = width / PRESETS.length;
	mgraphics.select_font_face("Arial");
	mgraphics.set_font_size(10);
	for (var p = 0; p < PRESETS.length; p++) {
		var on = same(PRESETS[p].nodes, nodes);
		if (on) rgba(1, 0.65, 0.2, 1);
		else rgba(0.18, 0.2, 0.23, 1);
		block(p * w + 1, 1, w - 2, BAR_HEIGHT - 2);
		if (on) rgba(0.05, 0.05, 0.05, 1);
		else rgba(0.8, 0.82, 0.85, 1);
		var text = PRESETS[p].name;
		var measure = mgraphics.text_measure(text);
		mgraphics.move_to(p * w + (w - measure[0]) / 2, 12.5);
		mgraphics.show_text(text);
	}
}

// ---------------------------------------------------------------- mouse

function nodeAt(x, y) {
	var best = -1, distance = HIT * HIT;
	for (var i = 0; i < nodes.length; i++) {
		var dx = px(nodes[i].x) - x, dy = py(nodes[i].y) - y;
		var d = dx * dx + dy * dy;
		if (d <= distance) { best = i; distance = d; }
	}
	return best;
}

function segmentAt(x) {
	var u = ux(x);
	for (var i = 0; i < nodes.length - 1; i++) if (u <= nodes[i + 1].x) return i;
	return nodes.length - 2;
}

function onclick(x, y) {
	drag = null;
	if (y < BAR_HEIGHT) {
		preset(clamp(Math.floor(x / (width / PRESETS.length)), 0, PRESETS.length - 1));
		return;
	}
	var hit = nodeAt(x, y);
	if (hit >= 0) {
		drag = { type: "node", index: hit };
	} else {
		var s = segmentAt(x);
		drag = { type: "bend", index: s, y: y, c: nodes[s].c };
	}
}

function ondrag(x, y, button) {
	if (!drag) return;
	if (drag.type === "node") {
		var i = drag.index;
		var p = nodes[i];
		if (i > 0 && i < nodes.length - 1) p.x = clamp(ux(x), nodes[i - 1].x, nodes[i + 1].x);
		p.y = uy(y);
	} else {
		var a = nodes[drag.index], b = nodes[drag.index + 1];
		// Dragging up always lifts the line, whichever way the segment slopes.
		var direction = b.y >= a.y ? 1 : -1;
		a.c = clamp(drag.c + direction * (y - drag.y) / 60, -1, 1);
	}
	writeTable();
	redraw();
	if (!button) {
		drag = null;
		save();
	}
}

function ondblclick(x, y) {
	drag = null;
	if (y < BAR_HEIGHT) return;
	var hit = nodeAt(x, y);
	if (hit > 0 && hit < nodes.length - 1) {
		nodes.splice(hit, 1);
	} else if (hit < 0 && nodes.length < MAX_NODES) {
		var s = segmentAt(x);
		nodes.splice(s + 1, 0, n(clamp(ux(x), nodes[s].x, nodes[s + 1].x), uy(y), 0));
	} else {
		return;
	}
	writeTable();
	save();
	redraw();
}

// Names above that are only called internally must not be Max messages.
if (typeof mgraphics !== "undefined") {
	mgraphics.init();
	mgraphics.relative_coords = 0;
	mgraphics.autofill = 0;
}

if (typeof module !== "undefined") {
	module.exports = { valueAt: valueAt, renderTable: renderTable, serialize: serialize, deserialize: deserialize, PRESETS: PRESETS, RATES: RATES };
}
