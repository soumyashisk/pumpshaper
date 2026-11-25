// Generates the two Max for Live devices from the sources in src/.
//   node build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const UI_FILE = "pumpshaper-ui.js";
const CHANNELS = ["A", "B", "C", "D"];

function patcher({ width, amxdtype }) {
	const boxes = [];
	const lines = [];
	let count = 0;

	// io is [inlets, outlets]. `at` places the box in the device view.
	function add(maxclass, io, extra = {}, at) {
		const id = `obj-${++count}`;
		const box = {
			id, maxclass, numinlets: io[0], numoutlets: io[1],
			patching_rect: [40 + (count % 6) * 170, 220 + Math.floor(count / 6) * 50, 150, 20],
			...(io[1] ? { outlettype: Array(io[1]).fill("") } : {}),
			...extra,
		};
		if (at) Object.assign(box, { presentation: 1, presentation_rect: at });
		boxes.push({ box });
		return id;
	}
	const obj = (text, io, extra) => add("newobj", io, { text, ...extra });
	const msg = (text) => add("message", [2, 1], { text });
	const wire = (from, outlet, to, inlet = 0) =>
		lines.push({ patchline: { source: [from, outlet], destination: [to, inlet] } });
	const label = (text, at) => add("live.comment", [1, 0], { text, textjustification: 1 }, at);

	// A saved, automatable Live parameter.
	function param(maxclass, name, valueof, at, extra = {}) {
		const outlets = maxclass === "live.menu" ? 3 : 2;
		return add(maxclass, [1, outlets], {
			parameter_enable: 1,
			varname: name,
			saved_attribute_attributes: {
				valueof: {
					parameter_longname: name,
					parameter_shortname: name,
					parameter_initial_enable: 1,
					...valueof,
				},
			},
			...extra,
		}, at);
	}
	const dial = (name, min, max, initial, unitstyle, at, more = {}) =>
		param("live.dial", name, {
			parameter_type: 0, parameter_mmin: min, parameter_mmax: max,
			parameter_initial: [initial], parameter_unitstyle: unitstyle, ...more,
		}, at);
	const menu = (name, items, initial, at) =>
		param("live.menu", name, {
			parameter_type: 2, parameter_enum: items, parameter_mmax: items.length - 1,
			parameter_initial: [initial],
		}, at);

	function toJSON() {
		return {
			patcher: {
				fileversion: 1,
				appversion: { major: 9, minor: 1, revision: 5, architecture: "x64", modernui: 1 },
				classnamespace: "box",
				rect: [80, 100, 1100, 700],
				openinpresentation: 1,
				devicewidth: width,
				default_fontsize: 10,
				default_fontname: "Ableton Sans Medium",
				boxes,
				lines,
				dependency_cache: [],
				latency: 0,
				// Max reads these keys without checking they exist: a missing
				// "searchpath" crashes it while loading the .amxd.
				project: {
					version: 1, creationdate: 3590052493, modificationdate: 3590052493,
					viewrect: [0, 0, 300, 500], autoorganize: 1, hideprojectwindow: 1,
					showdependencies: 1, autolocalize: 0, contents: { patchers: {} },
					layout: {}, searchpath: {}, detailsvisible: 0, amxdtype, readonly: 0,
					devpathtype: 0, devpath: ".", sortmode: 0, viewmode: 0,
				},
				autosave: 0,
			},
		};
	}

	return { add, obj, msg, wire, label, param, dial, menu, toJSON };
}

// ------------------------------------------------------------ audio effect

function genPatcher(code) {
	const boxes = [];
	const lines = [];
	const box = (id, maxclass, io, extra) =>
		boxes.push({ box: { id, maxclass, numinlets: io[0], numoutlets: io[1],
			...(io[1] ? { outlettype: Array(io[1]).fill("") } : {}), ...extra } });
	box("code", "codebox", [3, 4], { code, patching_rect: [20, 60, 700, 500], fontname: "Menlo", fontsize: 11 });
	for (let i = 0; i < 3; i++) {
		box(`in${i + 1}`, "newobj", [0, 1], { text: `in ${i + 1}`, patching_rect: [20 + i * 340, 20, 40, 20] });
		lines.push({ patchline: { source: [`in${i + 1}`, 0], destination: ["code", i] } });
	}
	for (let i = 0; i < 4; i++) {
		box(`out${i + 1}`, "newobj", [1, 0], { text: `out ${i + 1}`, patching_rect: [20 + i * 225, 580, 45, 20] });
		lines.push({ patchline: { source: ["code", i], destination: [`out${i + 1}`, 0] } });
	}
	return { fileversion: 1, classnamespace: "dsp.gen", rect: [100, 100, 800, 650], boxes, lines };
}

export function buildEffect() {
	const p = patcher({ width: 640, amxdtype: 0x61616161 });
	const { add, obj, msg, wire, label, param, dial, menu } = p;

	const input = obj("plugin~", [2, 2], { outlettype: ["signal", "signal"] });
	const output = obj("plugout~", [2, 2], { outlettype: ["signal", "signal"] });
	const ramp = obj("phasor~ 4n @lock 1", [2, 1], { outlettype: ["signal"] });
	const code = readFileSync(join(root, "src/shaper.genexpr"), "utf8");
	const gen = obj("gen~", [3, 4], {
		outlettype: ["signal", "signal", "signal", "signal"],
		patcher: genPatcher(code),
	});
	wire(input, 0, gen, 0);
	wire(input, 1, gen, 1);
	wire(ramp, 0, gen, 2);
	wire(gen, 0, output, 0);
	wire(gen, 1, output, 1);

	obj("buffer~ ---ps_curve @samps 2048", [1, 2]);
	obj("buffer~ ---ps_in @samps 512", [1, 2]);
	obj("buffer~ ---ps_out @samps 512", [1, 2]);

	// The editor doubles as the (hidden) blob parameter that saves the curve.
	const ui = add("v8ui", [1, 1], {
		varname: "curve_editor",
		saved_attribute_attributes: {
			valueof: {
				parameter_longname: "Curve", parameter_shortname: "Curve",
				parameter_type: 3, parameter_invisible: 1,
			},
		},
		filename: UI_FILE,
		textfile: { filename: UI_FILE, flags: 0, embed: 0, autowatch: 0 },
		parameter_enable: 1,
		border: 0,
	}, [0, 0, 460, 169]);

	for (const [bufferName, genName] of [["ps_curve", "curve"], ["ps_in", "scopein"], ["ps_out", "scopeout"]]) {
		wire(obj(`loadmess ${genName} ---${bufferName}`, [1, 1]), 0, gen);
	}
	wire(obj("loadmess setup ---ps_curve ---ps_in ---ps_out", [1, 1]), 0, ui);

	// Parameter -> optional math -> "message $1" -> destination.
	function send(source, message, target, math, outlet = 0) {
		let from = source;
		if (math) {
			const m = obj(math, [2, 1]);
			wire(source, outlet, m);
			from = m;
		}
		const out = obj(`prepend ${message}`, [1, 1]);
		wire(from, math ? 0 : outlet, out);
		wire(out, 0, target);
	}

	// Right-hand control panel.
	label("Rate", [466, 4, 82, 16]);
	const rate = menu("Rate", ["1 Bar", "1/2", "1/4", "1/8", "1/16", "1/4 D", "1/8 D", "1/4 T", "1/8 T"], 2, [468, 20, 78, 15]);
	send(rate, "rate", ui);

	label("Trigger", [552, 4, 82, 16]);
	const mode = menu("Trigger", ["Sync", "MIDI"], 0, [554, 20, 78, 15]);
	send(mode, "mode", gen);

	const depth = dial("Mix", 0, 100, 100, 5, [468, 40, 52, 48]);
	send(depth, "depth", gen, "* 0.01");
	const smooth = dial("Smooth", 0, 30, 2, 2, [524, 40, 52, 48], { parameter_exponent: 2 });
	send(smooth, "smoothms", gen);
	const shift = dial("Shift", -50, 50, 0, 5, [580, 40, 52, 48]);
	send(shift, "shift", gen, "* 0.01");

	const low = param("live.text", "Low Only", {
		parameter_type: 2, parameter_enum: ["off", "on"], parameter_mmax: 1, parameter_initial: [0],
	}, [468, 104, 54, 18], { text: "Low Only", texton: "Low Only", mode: 1 });
	send(low, "lowonly", gen);
	const cross = dial("Crossover", 40, 1000, 150, 3, [524, 92, 52, 48], { parameter_exponent: 3 });
	send(cross, "xover", gen);

	label("MIDI Ch", [578, 92, 58, 16]);
	const channel = menu("Channel", CHANNELS, 0, [586, 108, 42, 15]);

	// Triggers: from the companion MIDI device, or the Test button.
	const receive = obj("r pumpshaper_kick", [0, 1]);
	const match = obj("== 1", [2, 1]);
	const wanted = obj("+ 1", [2, 1]);
	wire(channel, 0, wanted);
	wire(wanted, 0, match, 1);
	wire(receive, 0, match, 0);
	const gate = obj("sel 1", [2, 2]);
	wire(match, 0, gate);
	const button = add("live.text", [1, 2], {
		text: "Test Trigger", texton: "Test Trigger", mode: 0, parameter_enable: 0,
	}, [468, 146, 164, 18]);
	const counter = obj("counter 1 1000000", [5, 4]);
	wire(gate, 0, counter);
	wire(button, 0, counter);
	send(counter, "trig", gen);

	// Live tempo sets the one-shot length.
	const device = obj("live.thisdevice", [1, 3]);
	const path = msg("path live_set");
	const livePath = obj("live.path", [1, 3]);
	const observer = obj("live.observer tempo", [2, 2]);
	wire(device, 0, path);
	wire(path, 0, livePath);
	wire(livePath, 0, observer, 1);
	send(observer, "bpmchange", ui);

	const timing = obj("route note oneshot", [3, 3]);
	wire(ui, 0, timing);
	const frequency = obj("prepend frequency", [1, 1]);
	wire(timing, 0, frequency);
	wire(frequency, 0, ramp);
	send(timing, "oneshotms", gen, null, 1);

	// Playhead for the editor.
	const snapshot = obj("snapshot~ 33", [2, 1]);
	wire(gen, 2, snapshot);
	send(snapshot, "playhead", ui);

	return p.toJSON();
}

// ------------------------------------------------------------ MIDI trigger

export function buildTrigger() {
	const p = patcher({ width: 130, amxdtype: 0x6d6d6d6d });
	const { obj, wire, label, param, menu } = p;

	// MIDI passes straight through so the kick still plays.
	const midiin = obj("midiin", [1, 1]);
	const midiout = obj("midiout", [1, 0]);
	wire(midiin, 0, midiout);

	const notein = obj("notein", [1, 3]);
	const strip = obj("stripnote", [2, 2]);
	wire(notein, 0, strip, 0);
	wire(notein, 1, strip, 1);

	label("Note (-1 = any)", [4, 6, 122, 16]);
	const note = param("live.numbox", "Note", {
		parameter_type: 1, parameter_mmin: -1, parameter_mmax: 127,
		parameter_initial: [-1], parameter_unitstyle: 0,
	}, [40, 24, 50, 15]);
	// Passes the note number only when it matches the filter (or filter is -1).
	const filter = obj("expr $i2 < 0 || $i1 == $i2", [2, 1]);
	const pack = obj("t b i", [1, 2]);
	wire(strip, 0, pack);
	wire(note, 0, filter, 1);
	wire(pack, 1, filter, 0);
	const pass = obj("sel 1", [2, 2]);
	wire(filter, 0, pass);

	label("Channel", [4, 52, 122, 16]);
	const channel = menu("Channel", CHANNELS, 0, [44, 70, 42, 15]);
	const number = obj("+ 1", [2, 1]);
	wire(channel, 0, number);
	const hold = obj("i 1", [2, 1]);
	wire(number, 0, hold, 1);
	wire(pass, 0, hold, 0);
	const send = obj("s pumpshaper_kick", [1, 0]);
	wire(hold, 0, send);

	return p.toJSON();
}

// ------------------------------------------------------------ output

// .amxd = chunked header followed by the patcher JSON.
export function amxd(type, json) {
	const body = Buffer.from(JSON.stringify(json, null, "\t") + "\n\0", "utf8");
	const chunk = (tag, data) => {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(data.length);
		return Buffer.concat([Buffer.from(tag), size, data]);
	};
	return Buffer.concat([chunk("ampf", Buffer.from(type)), chunk("meta", Buffer.alloc(4)), chunk("ptch", body)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dist = join(root, "dist");
	mkdirSync(dist, { recursive: true });
	writeFileSync(join(dist, "PumpShaper.amxd"), amxd("aaaa", buildEffect()));
	writeFileSync(join(dist, "PumpShaper Trigger.amxd"), amxd("mmmm", buildTrigger()));
	copyFileSync(join(root, "src", UI_FILE), join(dist, UI_FILE));
	console.log("Built devices in", dist);
}
