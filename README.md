# aeromat-smart

Smart-Home-Anbindung eines **Siegenia AEROMAT VT WRG 1100** (dezentraler Fassadenlüfter mit Wärmerückgewinnung) über einen **Shelly Plus Uni** und **Loxone**.

Das Gerät hat keine Smart-Home-Schnittstelle. Der Shelly simuliert den Folientaster am Bedienteil, ein Skript merkt sich die Stufe und meldet sie per UDP an den Loxone Miniserver. Optional kommen Feuchte (DHT22 am Shelly) und CO₂ (ESP32 + SCD41) dazu.

> Kein offizielles Projekt von Siegenia, Shelly oder Loxone. Eingriffe ins Gerät auf eigene Gefahr. Arbeiten an 230 V nur durch eine Elektrofachkraft.

## Inhalt

| Datei | Zweck |
|---|---|
| [`shelly/aeromat-loxone.js`](shelly/aeromat-loxone.js) | Skript für den Shelly Plus Uni: Stufensteuerung per HTTP, Rückmeldung per UDP |
| [`esphome/co2-raum.yaml`](esphome/co2-raum.yaml) | Optional: ESPHome-Konfiguration für einen CO₂-Sensor (SCD40/41) am ESP32 |
| [`docs/schaltplan.html`](docs/schaltplan.html) | Schaltplan mit Belegung, im Browser öffnen |

## Das Gerät

- Bedienung über einen Folientaster, Zyklus **Aus → 1 → 2 → 3 → Aus**
- Nach Stromausfall startet das Gerät in **Stufe 1**
- Taster 5 s halten setzt die Filterwechselanzeige zurück
- LED-Anzeige: Stufe 1 = LED 1, Stufe 2 = beide LEDs, Stufe 3 = beide blinken
- Luftleistung laut Anleitung ca. 21 / 37 / 56 m³/h
- Versorgung über externes Netzteil 24 V DC / 2,5 A
- Variante ohne Sensoren: kein Automatikmodus, vermutlich kein eigener Frostschutz

### Hauptplatine

ATmega328P als Controller, P82B96 als I²C-Puffer zum Bedienteil, MC34063 für die 5-V-Logik, 5-fach-DIP-Schalter. Kein Hersteller aufgedruckt, keine öffentlichen Unterlagen.

| Klemme | Belegung |
|---|---|
| 1–6 | frei, Funktion unbekannt |
| 7–10 | frei, vermutlich Sensoranschluss |
| 11–13, 14–16 | Lüfter 1 und 2 (Gelb / Schwarz / Rot) |
| 12 | GND |
| 17 | GND (Einspeisung) |
| 18 | +24 V (Einspeisung) |

### Roter Stecker zum Bedienteil (6-polig, Flachbandkabel)

| Pin | Funktion |
|---|---|
| 1 | GND |
| 2, 3 | sehr wahrscheinlich I²C-Datenbus zum Bedienteil, **nichts anschließen** |
| 4, 5 | nicht gemessen |
| 6 | Tasterleitung: 5 V in Ruhe, 0 V gedrückt |

## Verdrahtung Shelly Plus Uni

| Shelly-Ader | Anschluss |
|---|---|
| Rot (VAC1) | Klemme 18 (+24 V) |
| Schwarz (VAC2) | Klemme 17 (GND) |
| Grün (GND) | Klemme 12 |
| OUT1 a | Pin 1 (GND) |
| OUT1 b | Pin 6 (Taster) |
| Orange (IN1) | Pin 1 |
| Blau / Gelb / Grün | optional DHT22 (DATA / VCC / GND) |
| übrige Adern | frei, einzeln isolieren |

**Nicht anschließen:** Shelly-Eingänge an Pin 2/3 legen die LEDs lahm. Masse an Pin 6 wirkt wie ein dauerhaft gedrückter Taster.

## Shelly einrichten

1. Eingänge **entkoppelt**, OUT1 **Auto-Aus 0,3 s**, Zustand nach Stromausfall **Aus**.
2. Skript `shelly/aeromat-loxone.js` anlegen, starten, **Run on startup** aktivieren.
3. UDP-Ziel setzen (Port frei wählbar):
   `http://SHELLY-IP/rpc/Sys.SetConfig?config={"rpc_udp":{"dst_addr":"MINISERVER-IP:7010"}}`

### HTTP-Schnittstelle

`http://SHELLY-IP/script/<ID>/lueftung` mit:

| Parameter | Wirkung |
|---|---|
| `?stufe=0..3` | direkt auf Stufe |
| `?prozent=0..100` | Lüftergeschwindigkeit in %, wird in eine Stufe umgerechnet |
| `?cmd=on` / `off` / `next` / `up` / `down` | ein, aus, weiter, höher, tiefer |
| `?sync=0..3` | Zähler korrigieren, ohne zu drücken |
| ohne Parameter | Status als JSON |

Das Skript zählt seine eigenen Pulse (`useInput: false`). Ein Druck am Gerät verstellt den Zähler, bis Loxone den nächsten Wert schickt oder `?sync=` aufgerufen wird.

## Loxone einrichten

**Rückmeldung:** Virtueller UDP-Eingang (Absender = Shelly-IP, Port wie oben) mit diesen Befehlen:

| Eingang | Befehlserkennung | Typ |
|---|---|---|
| AEROMAT An | `"aeromat_an":\v` | digital |
| AEROMAT Stufe 1–3 | `"aeromat_s1":\v` … `"aeromat_s3":\v` | digital |
| AEROMAT Stufe | `"aeromat_stufe":\v` | analog |
| Feuchte (DHT22) | `humidity:100\i"rh":\i\v` | analog |
| Temperatur (DHT22) | `temperature:100\i"tC":\i\v` | analog |

**Steuerung:** Virtueller Ausgang `http://SHELLY-IP`, Ausgangsbefehl analog („Als Digitalausgang verwenden“ abwählen):
`/script/1/lueftung?prozent=<v>` oder `/script/1/lueftung?stufe=<v>`

**Regelung:** Baustein **Lüftung** der Intelligenten Raumregelung zuordnen, Feuchte an `Hi` (oder an die IRR), Ausgang `F` an den Prozent-Befehl. Sinnvolle Anpassungen:

- `Ivp` auf ca. 50–60 %, sonst wird bei Anwesenheit trotz hoher Feuchte nicht stärker gelüftet
- `Hmax` 55–60 %
- `Fpt` (Frostschutz) passend zur Außentemperatur
- im Sommer Feuchte-Intensivlüftung begrenzen, schwüle Außenluft bringt sonst zusätzliche Feuchte

## Optional: CO₂

ESP32 + Sensirion SCD41 mit [`esphome/co2-raum.yaml`](esphome/co2-raum.yaml). Loxone liest den Wert per Virtuellem HTTP-Eingang `http://ESP-IP/sensor/co2` mit Befehlserkennung `"value":\v` und gibt ihn an den CO2-Eingang des Lüftungsbausteins.

## Lizenz

[MIT](LICENSE)
