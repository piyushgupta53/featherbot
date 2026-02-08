---
name: weather
description: "Check weather forecasts using wttr.in"
requires:
  bins: []
  env: []
always: false
---

# Weather Skill

You can check weather forecasts using the wttr.in service.

## Usage

Use the `exec` tool to run curl commands against wttr.in:

### Current weather for a city
```
curl -s "wttr.in/London?format=3"
```

### Detailed forecast
```
curl -s "wttr.in/London?format=j1"
```
This returns JSON with current conditions and a 3-day forecast.

### Short one-line format
```
curl -s "wttr.in/London?format=%l:+%c+%t+%w+%h"
```
Shows: location, condition icon, temperature, wind, humidity.

## Notes

- No API key required
- Supports city names, airport codes (e.g., `JFK`), and coordinates
- Add `?lang=XX` for localized output
- The JSON format (`?format=j1`) is best for structured data extraction
