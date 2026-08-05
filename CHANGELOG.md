# HaniaION v1.2.1

- The 3D globe now initializes independently of the satellite API.
- Added automatic CelesTrak retry using both canonical host forms.
- Added persistent last-good TLE cache.
- Added a bundled bootstrap TLE set for temporary upstream outages.
- The UI clearly labels live versus cached orbit data.
- A failed refresh no longer removes the globe.
