# Skyfall Tower Drop — WebXR roller coaster

A VR roller coaster through a procedurally built city. A cable lift takes the train 490 m straight up the side of a skyscraper. The train holds at the edge of the roof, then drops down the far face of the tower at up to about 285 km/h.

Built with Three.js (r170), which loads from a CDN through an import map. It's plain ES modules with no build step and no assets: the city, the sky and all the sound are generated in code.

## Put it on GitHub Pages
1. Create a repo and upload everything in this folder (`index.html`, `js/`, `.nojekyll`).
2. In the repo, go to **Settings → Pages → Deploy from a branch → `main` / root**.
3. On the Quest, open `https://<you>.github.io/<repo>/` in the Meta Quest Browser and press **ENTER VR**.

WebXR needs HTTPS, and GitHub Pages provides it.

## Controls
- **Quest:** sit down and pull either trigger to send the train out. When the ride ends, pull the trigger again to ride again. Hold the Meta button to recenter your view.
- **Desktop:** drag to look around, press **Space** to send the train out, hold **F** to fast-forward.

## Testing locally
ES modules don't load from `file://`, so you need a local web server. For example: `python3 -m http.server`, then open http://localhost:8000.

These URL parameters help with debugging:
- `?s=820`: start the train at track position 820 m (the hold point at the top).
- `&v=30`: starting speed in m/s.
- `&pause=1`: freeze the train in place.
- `&cam=x,y,z&look=x,y,z`: view from an outside camera.

## Files
- `js/layout.js`: the track design, written as a list of straights, turns and pitch changes.
- `js/trackPath.js`: turns the layout into a smooth 3D path with easing and closes the loop.
- `js/ride.js`: train physics (gravity on every car, drag, rolling resistance, cable lift, hold brake, LSM booster, brakes). It also simulates a lap to work out how much to bank each curve.
- `js/city.js`: builds the city from instanced buildings. The windows, glass reflections and lit offices are drawn by a shader. Also streets, parks, trees and traffic.
- `js/trackMesh.js`: the track, supports, tower details and station.
- `js/train.js`: the cars and the speed/height/G display on the front car.
- `js/audio.js`: sound generated in code (wind, wheel roar, lift clicks, cable hum, brakes, city).
