// =====================================================================
//  AEROMAT VT WRG 1100 – Stufensteuerung mit Shelly Plus Uni + Loxone
// ---------------------------------------------------------------------
//  OUT1 (switch:0)  drückt den Folientaster   (Pin 6 <-> Pin 1)
//  Stufenzyklus:    Aus(0) -> 1 -> 2 -> 3 -> Aus(0)
//
//  Steuerung von Loxone (Virtueller Ausgang, HTTP, ohne Login):
//    /script/<ID>/lueftung?stufe=0..3   direkt auf Stufe
//    /script/<ID>/lueftung?prozent=0..100  Lüftergeschwindigkeit in %, wird in Stufe umgerechnet
//    /script/<ID>/lueftung?cmd=on       letzte Stufe (mind. 1)
//    /script/<ID>/lueftung?cmd=off      Aus
//    /script/<ID>/lueftung?cmd=next     eine Stufe weiter (Zyklus)
//    /script/<ID>/lueftung?cmd=up       eine Stufe höher (max. 3)
//    /script/<ID>/lueftung?cmd=down     eine Stufe tiefer (min. 0)
//    /script/<ID>/lueftung?sync=0..3    Zähler korrigieren, ohne zu drücken
//    /script/<ID>/lueftung              nur Status abfragen (JSON)
//
//  Rückmeldung an Loxone per UDP (keine Zugangsdaten nötig):
//    Das Skript erzeugt ein Shelly-Ereignis "aeromat". Der Shelly
//    schickt es über "RPC over UDP" an den Miniserver, z. B.:
//    ..."data":{"aeromat_stufe":2,"aeromat_an":1,"aeromat_s1":0,
//               "aeromat_s2":1,"aeromat_s3":0}...
//    Voraussetzung: rpc_udp.dst_addr = MINISERVER-IP:PORT im Shelly.
// =====================================================================

let CFG = {
  // false: Stufe wird über die eigenen Pulse mitgezählt (passend, wenn IN1 nicht an Pin 6 hängt).
  // true:  IN1 an Pin 6 zählt jeden Druck, auch manuelle am Gerät.
  useInput: false,

  startStage: 1,      // Stufe nach Stromausfall (Gerät startet in Stufe 1)
  pulseMs: 300,       // Dauer eines Tastendrucks
  gapMs: 700,         // Pause nach jedem Druck
  debounceMs: 250,    // Entprellung für IN1

  // Umrechnung Lüftergeschwindigkeit in % (z. B. von der Loxone-Raumlüftungssteuerung)
  // 0 % = Aus, bis pct1 = Stufe 1, bis pct2 = Stufe 2, darüber Stufe 3
  pct1: 40,
  pct2: 75,

  reportDelayMs: 1500, // erst melden, wenn die Stufe stabil ist
  heartbeatS: 60       // Status zusätzlich regelmäßig senden (0 = aus)
};

// ---------------------------------------------------------------------
let stage = CFG.startStage;
let target = CFG.startStage;
let lastOn = CFG.startStage > 0 ? CFG.startStage : 1;
let busy = false;
let pulseActive = false;
let edgeSeen = false;
let lastEdge = 0;
let reportTimer = null;

function advance() {
  stage = (stage + 1) % 4;
  if (stage > 0) lastOn = stage;
  scheduleReport();
}

function pulse() {
  busy = true;
  pulseActive = true;
  edgeSeen = false;
  Shelly.call("Switch.Set", { id: 0, on: true, toggle_after: CFG.pulseMs / 1000 });
  Timer.set(CFG.pulseMs + CFG.gapMs, false, function () {
    pulseActive = false;
    if (!CFG.useInput) {
      advance();
    } else if (!edgeSeen) {
      print("Warnung: Puls an IN1 nicht erkannt, zähle trotzdem weiter");
      advance();
    }
    busy = false;
    process();
  });
}

function process() {
  if (busy || stage === target) return;
  pulse();
}

function setTarget(s) {
  if (!(s >= 0 && s <= 3)) return false;
  target = s;
  process();
  return true;
}

// --- IN1: Tastendrücke mitlesen (nur mit useInput: true) ---------------
Shelly.addStatusHandler(function (e) {
  if (!CFG.useInput) return;
  if (e.component !== "input:0" || !e.delta || e.delta.state !== true) return;
  let now = Date.now();
  if (now - lastEdge < CFG.debounceMs) return;
  lastEdge = now;
  advance();
  if (pulseActive) {
    edgeSeen = true;
  } else {
    target = stage;
    print("Manuell geschaltet: Stufe " + stage);
  }
});

// --- Rückmeldung per UDP (Shelly-Ereignis) -----------------------------
function report() {
  Shelly.emitEvent("aeromat", {
    aeromat_stufe: stage,
    aeromat_an: stage > 0 ? 1 : 0,
    aeromat_s1: stage === 1 ? 1 : 0,
    aeromat_s2: stage === 2 ? 1 : 0,
    aeromat_s3: stage === 3 ? 1 : 0
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

// --- HTTP-Schnittstelle für Loxone ------------------------------------
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

HTTPServer.registerEndpoint("lueftung", function (req, res) {
  let q = parseQuery(req.query);
  let ok = true;
  if (q.stufe !== undefined) ok = setTarget(Math.round(Number(q.stufe)));
  else if (q.prozent !== undefined) {
    let p = Number(q.prozent);
    if (!(p >= 0 && p <= 100)) ok = false;
    else ok = setTarget(p <= 0 ? 0 : (p <= CFG.pct1 ? 1 : (p <= CFG.pct2 ? 2 : 3)));
  }
  else if (q.cmd === "on") ok = setTarget(stage > 0 ? stage : lastOn);
  else if (q.cmd === "off") ok = setTarget(0);
  else if (q.cmd === "next") ok = setTarget((target + 1) % 4);
  else if (q.cmd === "up") ok = setTarget(Math.min(3, target + 1));
  else if (q.cmd === "down") ok = setTarget(Math.max(0, target - 1));
  else if (q.sync !== undefined) {
    let s = Math.round(Number(q.sync));
    if (s >= 0 && s <= 3) {
      stage = s;
      target = s;
      if (s > 0) lastOn = s;
      scheduleReport();
    } else {
      ok = false;
    }
  }
  res.code = ok ? 200 : 400;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify({ stufe: stage, ziel: target, an: stage > 0 ? 1 : 0, busy: busy, ok: ok });
  res.send();
});

// --- Start --------------------------------------------------------------
Shelly.call("Switch.Set", { id: 0, on: false });
scheduleReport();
print("AEROMAT-Skript gestartet, Stufe " + stage + ", IN1 " + (CFG.useInput ? "aktiv" : "aus"));
