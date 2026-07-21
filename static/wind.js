const altitudeSelect = document.getElementById("altitudeSelect");
const forecastSelect = document.getElementById("forecastSelect");
const refreshWind = document.getElementById("refreshWind");
const loading = document.getElementById("windLoading");
const validTime = document.getElementById("validTime");
const levelLabel = document.getElementById("levelLabel");
const mapSummary = document.getElementById("mapSummary");
const selectedPoint = document.getElementById("selectedPoint");
const animationToggle = document.getElementById("animationToggle");

const REGION_BOUNDS = L.latLngBounds([[16, 20], [42, 64]]);
const map = L.map("windMap", {
  zoomControl: true,
  minZoom: 3,
  maxZoom: 9,
  maxBounds: [[5, 5], [55, 80]],
  maxBoundsViscosity: 0.7,
  preferCanvas: true,
});
map.fitBounds(REGION_BOUNDS, { padding: [8, 8] });

// Esri's international dark-gray basemap keeps country and city labels in English,
// avoiding the mixed local-language labels shown by standard OpenStreetMap tiles.
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 16,
    attribution: "Tiles &copy; Esri",
  }
).addTo(map);

map.createPane("englishLabels");
map.getPane("englishLabels").style.zIndex = 500;
map.getPane("englishLabels").style.pointerEvents = "none";

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  {
    pane: "englishLabels",
    maxZoom: 16,
    attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS",
  }
).addTo(map);

const mapContainer = map.getContainer();
const canvas = document.createElement("canvas");
canvas.className = "wind-particle-canvas";
mapContainer.appendChild(canvas);
const ctx = canvas.getContext("2d", { alpha: true });

let windData = null;
let grid = null;
let particles = [];
let animationFrame = null;
let animationEnabled = true;
let lastFrame = performance.now();

function compass(direction) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(direction / 45) % 8];
}

function formatUtc(value) {
  if (!value) return "Model time unavailable";
  const date = new Date(`${value}:00Z`);
  return `${date.toLocaleString(undefined, {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  })} UTC`;
}

function speedColor(speed, alpha = 0.9) {
  if (speed < 15) return `rgba(70, 232, 173, ${alpha})`;
  if (speed < 35) return `rgba(255, 205, 82, ${alpha})`;
  if (speed < 55) return `rgba(255, 124, 91, ${alpha})`;
  return `rgba(255, 76, 140, ${alpha})`;
}

function createGrid(data) {
  const byKey = new Map();
  data.points.forEach((point) => {
    byKey.set(`${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}`, point);
  });
  return {
    byKey,
    latMin: data.region.lat_min,
    latMax: data.region.lat_max,
    lonMin: data.region.lon_min,
    lonMax: data.region.lon_max,
    latStep: data.region.lat_step,
    lonStep: data.region.lon_step,
  };
}

function lookupPoint(lat, lon) {
  if (!grid) return null;
  if (lat < grid.latMin || lat > grid.latMax || lon < grid.lonMin || lon > grid.lonMax) return null;

  const lat0 = Math.floor((lat - grid.latMin) / grid.latStep) * grid.latStep + grid.latMin;
  const lon0 = Math.floor((lon - grid.lonMin) / grid.lonStep) * grid.lonStep + grid.lonMin;
  const lat1 = Math.min(lat0 + grid.latStep, grid.latMax);
  const lon1 = Math.min(lon0 + grid.lonStep, grid.lonMax);
  const key = (la, lo) => `${la.toFixed(2)}:${lo.toFixed(2)}`;
  const p00 = grid.byKey.get(key(lat0, lon0));
  const p01 = grid.byKey.get(key(lat0, lon1));
  const p10 = grid.byKey.get(key(lat1, lon0));
  const p11 = grid.byKey.get(key(lat1, lon1));
  if (!p00 || !p01 || !p10 || !p11) return p00 || p01 || p10 || p11 || null;

  const tx = lon1 === lon0 ? 0 : (lon - lon0) / (lon1 - lon0);
  const ty = lat1 === lat0 ? 0 : (lat - lat0) / (lat1 - lat0);

  const components = [p00, p01, p10, p11].map((p) => {
    const toward = (p.direction_degrees + 180) * Math.PI / 180;
    return {
      u: Math.sin(toward) * p.speed_knots,
      v: Math.cos(toward) * p.speed_knots,
    };
  });
  const blend = (a, b, c, d) =>
    a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  const u = blend(components[0].u, components[1].u, components[2].u, components[3].u);
  const v = blend(components[0].v, components[1].v, components[2].v, components[3].v);
  const speed = Math.sqrt(u * u + v * v);
  const towardDeg = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
  const fromDeg = (towardDeg + 180) % 360;
  return { speed_knots: speed, direction_degrees: fromDeg, u, v };
}

function resizeCanvas() {
  const size = map.getSize();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size.x * ratio);
  canvas.height = Math.round(size.y * ratio);
  canvas.style.width = `${size.x}px`;
  canvas.style.height = `${size.y}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  resetParticles();
}

function randomLatLngInView() {
  const bounds = map.getBounds().pad(-0.02);
  const south = Math.max(bounds.getSouth(), grid?.latMin ?? 16);
  const north = Math.min(bounds.getNorth(), grid?.latMax ?? 42);
  const west = Math.max(bounds.getWest(), grid?.lonMin ?? 20);
  const east = Math.min(bounds.getEast(), grid?.lonMax ?? 64);
  return L.latLng(south + Math.random() * (north - south), west + Math.random() * (east - west));
}

function resetParticle(particle) {
  const latlng = randomLatLngInView();
  particle.lat = latlng.lat;
  particle.lon = latlng.lng;
  particle.age = Math.floor(Math.random() * 100);
  particle.maxAge = 70 + Math.floor(Math.random() * 100);
  particle.prevX = null;
  particle.prevY = null;
}

function particleCount() {
  const area = map.getSize().x * map.getSize().y;
  const mobile = window.innerWidth < 700;
  return Math.max(500, Math.min(mobile ? 1400 : 2600, Math.round(area / (mobile ? 420 : 300))));
}

function resetParticles() {
  particles = Array.from({ length: particleCount() }, () => {
    const p = {};
    resetParticle(p);
    return p;
  });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function animate(now) {
  animationFrame = requestAnimationFrame(animate);
  if (!animationEnabled || !grid) return;
  const dt = Math.min((now - lastFrame) / 16.67, 2.2);
  lastFrame = now;

  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "rgba(0, 0, 0, 0.91)";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1.15;

  const zoomScale = Math.pow(1.35, map.getZoom() - 4);
  for (const p of particles) {
    const wind = lookupPoint(p.lat, p.lon);
    if (!wind || p.age++ > p.maxAge) {
      resetParticle(p);
      continue;
    }

    const point = map.latLngToContainerPoint([p.lat, p.lon]);
    if (point.x < -20 || point.y < -20 || point.x > canvas.clientWidth + 20 || point.y > canvas.clientHeight + 20) {
      resetParticle(p);
      continue;
    }

    if (p.prevX !== null) {
      ctx.beginPath();
      ctx.strokeStyle = speedColor(wind.speed_knots, 0.82);
      ctx.moveTo(p.prevX, p.prevY);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    p.prevX = point.x;
    p.prevY = point.y;

    const speedFactor = 0.00042 * dt / zoomScale;
    p.lat += wind.v * speedFactor;
    p.lon += wind.u * speedFactor / Math.max(Math.cos(p.lat * Math.PI / 180), 0.35);
  }
}

function showPoint(latlng) {
  const wind = lookupPoint(latlng.lat, latlng.lng);
  if (!wind || !windData) return;
  const direction = Math.round(wind.direction_degrees);
  const text = `${wind.speed_knots.toFixed(1)} kt · ${String(direction).padStart(3, "0")}° ${compass(direction)}`;
  selectedPoint.textContent = `${latlng.lat.toFixed(3)}°, ${latlng.lng.toFixed(3)}° — ${text}`;
  L.popup({ className: "wind-popup" })
    .setLatLng(latlng)
    .setContent(`
      <div class="wind-popup-content">
        <span>Selected wind</span>
        <strong>${wind.speed_knots.toFixed(1)} kt</strong>
        <b>From ${String(direction).padStart(3, "0")}° (${compass(direction)})</b>
        <small>${windData.level_label}<br>${formatUtc(windData.valid_time_utc)}</small>
      </div>
    `)
    .openOn(map);
}

async function loadWind() {
  loading.classList.remove("hidden");
  refreshWind.disabled = true;
  mapSummary.textContent = "Retrieving GFS wind field…";

  try {
    const params = new URLSearchParams({
      altitude_ft: altitudeSelect.value,
      forecast_hour: forecastSelect.value,
    });
    const response = await fetch(`/api/wind/grid?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Unable to load wind data.");
    if (!data.points?.length) throw new Error("The forecast returned no usable wind samples.");

    windData = data;
    grid = createGrid(data);
    levelLabel.textContent = data.level_label;
    validTime.textContent = formatUtc(data.valid_time_utc);
    mapSummary.textContent = `${data.points.length} grid samples · ${data.cached ? "cached" : "updated"}`;
    selectedPoint.textContent = "Tap anywhere on the map for exact interpolated wind.";
    resetParticles();
  } catch (error) {
    mapSummary.textContent = error.message;
  } finally {
    loading.classList.add("hidden");
    refreshWind.disabled = false;
  }
}

refreshWind.addEventListener("click", loadWind);
altitudeSelect.addEventListener("change", loadWind);
forecastSelect.addEventListener("change", loadWind);
animationToggle.addEventListener("click", () => {
  animationEnabled = !animationEnabled;
  animationToggle.classList.toggle("is-off", !animationEnabled);
  animationToggle.textContent = animationEnabled ? "Pause flow" : "Resume flow";
  if (!animationEnabled) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  else resetParticles();
});
map.on("click", (event) => showPoint(event.latlng));
map.on("move zoom resize", resizeCanvas);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
requestAnimationFrame(animate);
loadWind();
