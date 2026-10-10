# Devices, MQTT and firmware

Each line is a question to answer with a location in the code, not a yes from memory.

## Identity and credentials

- **No default or shared credentials**: each device has its own, set at provisioning, and a
  device ships unable to operate until they are set.
- **No keys in firmware or source**: secrets live in secure storage (secure element, encrypted
  NVS partition), not in the image, where anyone who dumps the flash can read them.

## Transport

- **TLS with verification**: certificate validation is on (no `setInsecure()`, no disabled
  hostname checks), with the server certificate or CA pinned where the device cannot update
  its trust store.
- **MQTT**: the broker requires authentication, not anonymous access; topic ACLs let a device
  publish and subscribe only to its own topics; the broker is not reachable from the internet
  without TLS.
- **Local APIs** on the device (HTTP, BLE, mDNS services) require pairing or a key.

## Updates

- **Signed OTA**: firmware updates are signature-checked on the device before they are
  applied, downgrades to older vulnerable versions are refused, and a failed update rolls
  back.

## Input and physical access

- **Parsers** of network or sensor data check lengths before copying into buffers (buffer
  overflows).
- **Debug interfaces** (UART console, JTAG, open serial shells) are disabled or locked in
  production builds.
- **Commands from the network** that move hardware (relays, motors, locks) are authenticated
  and rate limited, and fail safe when the connection drops.
