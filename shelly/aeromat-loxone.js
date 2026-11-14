// =====================================================================
//  AEROMAT VT WRG 1100 – fan level control with Shelly Plus Uni + Loxone
// ---------------------------------------------------------------------
//  Output 1 (switch:1)  presses the membrane button   (pin 6 <-> pin 1)
//  Input 0 (input:0)    reads the button line (optional, see useInput)
//  Level cycle:     Off(0) -> 1 -> 2 -> 3 -> Off(0)
//
//  Control from Loxone (Virtual Output, HTTP, no login):
//    /script/<ID>/ventilation?level=0..3      go to level
//    /script/<ID>/ventilation?percent=0..100  fan speed in %, mapped to a level
//    /script/<ID>/ventilation?cmd=on          last level (at least 1)
//    /script/<ID>/ventilation?cmd=off         off
//    /script/<ID>/ventilation?cmd=next        one level further (cycle)
//    /script/<ID>/ventilation?cmd=up          one level up (max. 3)
//    /script/<ID>/ventilation?cmd=down        one level down (min. 0)
//    /script/<ID>/ventilation?sync=0..3       correct the counter without pressing
//    /script/<ID>/ventilation                 status only (JSON)
//
//  Feedback to Loxone via UDP (no credentials needed):
//    The script emits a Shelly event "aeromat". The Shelly sends it to the
//    Miniserver via "RPC over UDP", e.g.:
//    ..."data":{"aeromat_level":2,"aeromat_on":1,"aeromat_l1":0,
//               "aeromat_l2":1,"aeromat_l3":0}...
//    Requirement: rpc_udp.dst_addr = MINISERVER-IP:PORT on the Shelly.
// =====================================================================

let CFG = {
  // true:  input 0 counts every press, including manual ones on the unit
  //        (a normal press pulls the button line low for approx. 0.2 s).
  // false: the level is tracked only by counting the script's own pulses
  //        (use this if input 0 does not see the button presses).
  useInput: true,
  debug: false,       // true: print every input edge to the script console

  outputId: 1,        // Shelly output that presses the button (switch:1)
  inputId: 0,         // Shelly input that reads the button line (input:0)

  startLevel: 1,      // level after a power failure (the unit starts in level 1)
  pulseMs: 300,       // duration of one button press
  gapMs: 700,         // pause after each press
  debounceMs: 150,    // ignore further presses within this time

  // Mapping of fan speed in % (e.g. from the Loxone ventilation block)
  // 0 % = off, up to pct1 = level 1, up to pct2 = level 2, above = level 3
  pct1: 40,
  pct2: 75,

  reportDelayMs: 1500, // report only once the level is stable
  heartbeatS: 60       // also send the status periodically (0 = off)
};

// ---------------------------------------------------------------------
let level = CFG.startLevel;
let target = CFG.startLevel;
let lastOn = CFG.startLevel > 0 ? CFG.startLevel : 1;
let busy = false;
let pulseActive = false;
let edgeSeen = false;
let lastEdge = 0;
let reportTimer = null;

function nowMs() {
  return typeof Shelly.getUptimeMs === "function" ? Shelly.getUptimeMs() : Date.now();
}

function advance() {
  level = (level + 1) % 4;
  if (level > 0) lastOn = level;
  scheduleReport();
}

function pulse() {
  busy = true;
  pulseActive = true;
  edgeSeen = false;
  Shelly.call("Switch.Set", { id: CFG.outputId, on: true, toggle_after: CFG.pulseMs / 1000 });
  Timer.set(CFG.pulseMs + CFG.gapMs, false, function () {
    pulseActive = false;
    if (!CFG.useInput) {
      advance();
    } else if (!edgeSeen) {
      print("Warning: pulse not detected on input " + CFG.inputId + ", counting anyway");
      advance();
    }
    busy = false;
    process();
  });
}

function process() {
  if (busy || level === target) return;
  pulse();
}

function setTarget(l) {
  if (!(l >= 0 && l <= 3)) return false;
  target = l;
  process();
  return true;
}

// --- Input: detect button presses (only with useInput: true) -----------
Shelly.addStatusHandler(function (e) {
  if (!CFG.useInput) return;
  if (e.component !== "input:" + CFG.inputId || !e.delta || typeof e.delta.state !== "boolean") return;
  if (CFG.debug) print("Input " + CFG.inputId + ": " + (e.delta.state ? "pressed" : "released"));
  if (e.delta.state !== true) return;
  let now = nowMs();
  if (now - lastEdge < CFG.debounceMs) return;
  lastEdge = now;
  advance();
  if (pulseActive) {
    edgeSeen = true;
  } else {
    target = level;
    print("Manual press detected: level " + level);
  }
});

// --- Feedback via UDP (Shelly event) ------------------------------------
function report() {
  Shelly.emitEvent("aeromat", {
    aeromat_level: level,
    aeromat_on: level > 0 ? 1 : 0,
    aeromat_l1: level === 1 ? 1 : 0,
    aeromat_l2: level === 2 ? 1 : 0,
    aeromat_l3: level === 3 ? 1 : 0
  });
}

function scheduleReport() {
  if (reportTimer !== null) Timer.clear(reportTimer);
  reportTimer = Timer.set(CFG.reportDelayMs, false, function () {
    reportTimer = null;
    report();
  });
}

if (CFG.heartbeatS > 0) {
  Timer.set(CFG.heartbeatS * 1000, true, function () {
    if (!busy) report();
  });
}

// --- HTTP interface for Loxone -------------------------------------------
function parseQuery(q) {
  let r = {};
  if (!q) return r;
  let parts = q.split("&");
  for (let i = 0; i < parts.length; i++) {
    let kv = parts[i].split("=");
    r[kv[0]] = kv.length > 1 ? kv[1] : "";
  }
  return r;
}

HTTPServer.registerEndpoint("ventilation", function (req, res) {
  let q = parseQuery(req.query);
  let ok = true;
  if (q.level !== undefined) ok = setTarget(Math.round(Number(q.level)));
  else if (q.percent !== undefined) {
    let p = Number(q.percent);
    if (!(p >= 0 && p <= 100)) ok = false;
    else ok = setTarget(p <= 0 ? 0 : (p <= CFG.pct1 ? 1 : (p <= CFG.pct2 ? 2 : 3)));
  }
  else if (q.cmd === "on") ok = setTarget(level > 0 ? level : lastOn);
  else if (q.cmd === "off") ok = setTarget(0);
  else if (q.cmd === "next") ok = setTarget((target + 1) % 4);
  else if (q.cmd === "up") ok = setTarget(Math.min(3, target + 1));
  else if (q.cmd === "down") ok = setTarget(Math.max(0, target - 1));
  else if (q.sync !== undefined) {
    let l = Math.round(Number(q.sync));
    if (l >= 0 && l <= 3) {
      level = l;
      target = l;
      if (l > 0) lastOn = l;
      scheduleReport();
    } else {
      ok = false;
    }
  }
  res.code = ok ? 200 : 400;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify({ level: level, target: target, on: level > 0 ? 1 : 0, busy: busy, ok: ok });
  res.send();
});

// --- Start ----------------------------------------------------------------
Shelly.call("Switch.Set", { id: CFG.outputId, on: false });
scheduleReport();
print("AEROMAT script started, level " + level + ", input " + (CFG.useInput ? "enabled" : "disabled"));
