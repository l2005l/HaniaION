const altitudeSelect = document.getElementById("altitudeSelect");
const forecastSelect = document.getElementById("forecastSelect");
const refreshWind = document.getElementById("refreshWind");
const loading = document.getElementById("windLoading");
const validTime = document.getElementById("validTime");
const levelLabel = document.getElementById("levelLabel");
const mapSummary = document.getElementById("mapSummary");

const map = L.map("windMap", {
  zoomControl: true,
  minZoom: 3,
  maxZoom: 8,
}).setView([30.5, 31.5], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const arrows = L.layerGroup().addTo(map);

function speedClass(speed) {
  if (speed >= 35) return "high";
  if (speed >= 15) return "mid";
  return "low";
}

function compass(direction) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(direction / 45) % 8];
}

function formatUtc(value) {
  if (!value) return "Model time unavailable";
  const date = new Date(`${value}:00Z`);
  return `${date.toLocaleString(undefined, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
}

async function loadWind() {
  loading.classList.remove("hidden");
  refreshWind.disabled = true;
  mapSummary.textContent = "Retrieving model wind field…";

  try {
    const params = new URLSearchParams({
      altitude_ft: altitudeSelect.value,
      forecast_hour: forecastSelect.value,
    });
    const response = await fetch(`/api/wind/grid?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Unable to load wind data.");

    arrows.clearLayers();
    data.points.forEach(point => {
      const windClass = speedClass(point.speed_knots);
      const icon = L.divIcon({
        className: "wind-arrow-icon",
        html: `<div class="wind-arrow ${windClass}" style="transform:rotate(${point.direction_degrees}deg)">↑</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      L.marker([point.latitude, point.longitude], { icon })
        .bindPopup(`
          <strong>${point.speed_knots.toFixed(1)} kt</strong><br>
          From ${String(point.direction_degrees).padStart(3, "0")}° (${compass(point.direction_degrees)})<br>
          ${data.level_label}<br>
          ${formatUtc(data.valid_time_utc)}
        `)
        .addTo(arrows);
    });

    levelLabel.textContent = data.level_label;
    validTime.textContent = formatUtc(data.valid_time_utc);
    mapSummary.textContent = `${data.points.length} forecast samples · ${data.cached ? "cached" : "updated"}`;
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
loadWind();
