# Satellite Live data model

This build uses the public CelesTrak **Earth Resources** GP/TLE group and propagates each orbit with SGP4 on the FastAPI server.

`/api/satellites/coverage?minutes=90` returns current sub-satellite positions, coarse future tracks, candidate observation windows and no-coverage windows.

## Important limitation

Orbit position is based on real public TLE data. Sensor pointing, tasking and collection state are not public. The app therefore labels coverage as an estimated geometric candidate using conservative category footprints:

- Optical: 600 km ground-distance estimate
- SAR: 900 km
- Earth science: 1,000 km
- Other Earth-resource missions: 700 km

The feature does not include classified objects and must not be described as proof that a satellite is photographing Israel.
