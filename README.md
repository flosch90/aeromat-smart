# aeromat-smart

Smart home integration of a **Siegenia AEROMAT VT WRG 1100** (decentralised façade ventilation unit with heat recovery) using a **Shelly Plus Uni** and **Loxone**.

The unit has no smart home interface. The Shelly simulates the membrane button on the control panel, a script keeps track of the fan level and reports it to the Loxone Miniserver via UDP. Optionally, humidity (DHT22 on the Shelly) and CO₂ (ESP32 + SCD41) can be added.

> Not an official project of Siegenia, Shelly or Loxone. Modifying the unit is at your own risk. Work on 230 V must be done by a qualified electrician.

## Contents

| File | Purpose |
|---|---|
| [`shelly/aeromat-loxone.js`](shelly/aeromat-loxone.js) | Script for the Shelly Plus Uni: level control via HTTP, feedback via UDP |
| [`esphome/co2-room.yaml`](esphome/co2-room.yaml) | Optional: ESPHome configuration for a CO₂ sensor (SCD40/41) on an ESP32 |
| [`docs/wiring.html`](docs/wiring.html) | Wiring diagram with pin assignment, open in a browser |

## The unit

- Operated with a membrane button, cycle **Off → 1 → 2 → 3 → Off**
- After a power failure the unit starts in **level 1**
- Holding the button for 5 s resets the filter change indicator
- LED indication: level 1 = LED 1, level 2 = both LEDs, level 3 = both blinking
- Airflow according to the manual approx. 21 / 37 / 56 m³/h
- Powered by an external 24 V DC / 2.5 A power supply
- Variant without sensors: no automatic mode, probably no built-in frost protection

### Main board

ATmega328P as controller, P82B96 as I²C buffer to the control panel, MC34063 for the 5 V logic supply, 5-way DIP switch. No manufacturer marking, no public documentation.

| Terminal | Assignment |
|---|---|
| 1–6 | unused, function unknown |
| 7–10 | unused, probably a sensor connection |
| 11–13, 14–16 | fan 1 and fan 2 (yellow / black / red) |
| 12 | GND |
| 17 | GND (supply) |
| 18 | +24 V (supply) |

### Red connector to the control panel (6-pin, ribbon cable)

| Pin | Function |
|---|---|
| 1 | GND |
| 2, 3 | most likely the I²C data bus to the control panel, **do not connect anything** |
| 4, 5 | not measured |
| 6 | button line: 5 V idle, 0 V pressed |

## Shelly Plus Uni wiring

| Shelly wire | Connection |
|---|---|
| Red (VAC1) | terminal 18 (+24 V) |
| Black (VAC2) | terminal 17 (GND) |
| Green (GND) | terminal 12 |
| OUT1 a | pin 1 (GND) |
| OUT1 b | pin 6 (button) |
| Orange (IN1) | pin 1 |
| Blue / yellow / green | optional DHT22 (DATA / VCC / GND) |
| remaining wires | unused, insulate individually |

**Do not connect:** Shelly inputs on pins 2/3 stop the LEDs from working. Ground on pin 6 acts like a permanently pressed button.

## Shelly setup

1. Inputs **detached**, OUT1 **auto-off 0.3 s**, state after power failure **off**.
2. Create the script `shelly/aeromat-loxone.js`, start it and enable **Run on startup**.
3. Set the UDP target (any free port):
   `http://SHELLY-IP/rpc/Sys.SetConfig?config={"rpc_udp":{"dst_addr":"MINISERVER-IP:7010"}}`

### HTTP interface

`http://SHELLY-IP/script/<ID>/ventilation` with:

| Parameter | Effect |
|---|---|
| `?level=0..3` | go directly to a level |
| `?percent=0..100` | fan speed in %, mapped to a level |
| `?cmd=on` / `off` / `next` / `up` / `down` | on, off, next, up, down |
| `?sync=0..3` | correct the counter without pressing |
| no parameter | status as JSON |

The script counts its own pulses (`useInput: false`). A press on the unit puts the counter out of step until Loxone sends the next value or `?sync=` is called.

## Loxone setup

**Feedback:** Virtual UDP Input (sender = Shelly IP, port as above) with these commands:

| Input | Command recognition | Type |
|---|---|---|
| AEROMAT on | `"aeromat_on":\v` | digital |
| AEROMAT level 1–3 | `"aeromat_l1":\v` … `"aeromat_l3":\v` | digital |
| AEROMAT level | `"aeromat_level":\v` | analog |
| Humidity (DHT22) | `humidity:100\i"rh":\i\v` | analog |
| Temperature (DHT22) | `temperature:100\i"tC":\i\v` | analog |

**Control:** Virtual Output `http://SHELLY-IP`, analog output command (untick "Use as digital output"):
`/script/1/ventilation?percent=<v>` or `/script/1/ventilation?level=<v>`

**Control logic:** Assign the **Ventilation** block to the Intelligent Room Controller, connect humidity to `Hi` (or to the IRC), and output `F` to the percent command. Useful adjustments:

- `Ivp` to approx. 50–60 %, otherwise ventilation is not increased during presence despite high humidity
- `Hmax` 55–60 %
- `Fpt` (frost protection) to suit the outdoor temperature
- limit humidity-driven intensive ventilation in summer, humid outdoor air would otherwise add moisture

## Optional: CO₂

ESP32 + Sensirion SCD41 with [`esphome/co2-room.yaml`](esphome/co2-room.yaml). Loxone reads the value via a Virtual HTTP Input `http://ESP-IP/sensor/co2` with command recognition `"value":\v` and feeds it into the CO2 input of the ventilation block.

## License

[MIT](LICENSE)
