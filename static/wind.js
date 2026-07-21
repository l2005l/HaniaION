const altitudeSelect = document.getElementById("altitudeSelect");
const forecastSelect = document.getElementById("forecastSelect");
const refreshWind = document.getElementById("refreshWind");
const windFrame = document.getElementById("windFrame");
const loading = document.getElementById("windLoading");
const levelLabel = document.getElementById("levelLabel");
const mapSummary = document.getElementById("mapSummary");

const LEVEL_LABELS = {
  surface: "Surface wind",
  "850h": "850 hPa · approximately 5,000 ft",
  "700h": "700 hPa · approximately 10,000 ft",
  "600h": "600 hPa · approximately 14,000 ft",
  "500h": "500 hPa · approximately 18,000 ft",
  "400h": "400 hPa · approximately 24,000 ft",
  "300h": "300 hPa · approximately 30,000 ft",
  "250h": "250 hPa · approximately 34,000 ft",
  "200h": "200 hPa · approximately 39,000 ft",
  "150h": "150 hPa · approximately 44,000 ft",
  "100h": "100 hPa · approximately 52,000 ft",
};

function buildWindyUrl() {
  const level = altitudeSelect.value;
  const forecast = Number(forecastSelect.value || 0);
  const params = new URLSearchParams({
    lat: "30.5",
    lon: "42.0",
    detailLat: "31.8",
    detailLon: "35.2",
    zoom: "4",
    level,
    overlay: "wind",
    product: "ecmwf",
    menu: "true",
    message: "true",
    marker: "true",
    calendar: "now",
    pressure: "true",
    type: "map",
    location: "coordinates",
    detail: "true",
    metricWind: "kt",
    metricTemp: "°C",
    radarRange: "-1",
    forecast: String(forecast),
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

function loadWindMap() {
  loading.classList.remove("hidden");
  refreshWind.disabled = true;
  levelLabel.textContent = LEVEL_LABELS[altitudeSelect.value] || altitudeSelect.value;
  mapSummary.textContent = forecastSelect.value === "0"
    ? "Current model time"
    : `Forecast +${forecastSelect.value} hours`;

  // Assigning a fresh URL forces the embedded map to apply the selected level/time.
  windFrame.src = buildWindyUrl();
}

windFrame.addEventListener("load", () => {
  loading.classList.add("hidden");
  refreshWind.disabled = false;
});

// Fail-safe: never leave the loading shade covering a successfully rendered iframe.
setTimeout(() => {
  loading.classList.add("hidden");
  refreshWind.disabled = false;
}, 12000);

refreshWind.addEventListener("click", loadWindMap);
altitudeSelect.addEventListener("change", loadWindMap);
forecastSelect.addEventListener("change", loadWindMap);

loadWindMap();
