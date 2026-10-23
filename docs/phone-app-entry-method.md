# Phone app → dashboard: how a serial / MID was entered

In each unit of the record sent to `field_sync_record`, add these optional fields:

    "units": [{ "unit_no": 1, "kind": "INSTALL", "serial": "WP0001", "mid": "200123456789012",
                "serial_input": "SCAN",     // "SCAN" when read by the camera / barcode scanner, "TYPED" when keyed in
                "mid_input": "TYPED" }]

Optional, same values: `old_serial_input`, `tid_input`. Missing means "Not reported" (older app versions).
No database change is needed: the whole unit is stored in `field_events.payload.unit`.
Phone Review shows Scanned / Typed under the serial and "Entered by" in the details.
