const altitudeSelect = document.getElementById("altitudeSelect");
const loadButton = document.getElementById("loadButton");
const frame = document.getElementById("windFrame");
const loading = document.getElementById("loading");

function windyUrl(level) {
  const params = new URLSearchParams({
    type: "map",
    location: "coordinates",
    metricWind: "kt",
    metricTemp: "°C",
    overlay: "wind",
    product: "ecmwf",
    level,
    lat: "29.5",
    lon: "39.5",
    zoom: "4",
    detailLat: "31.8",
    detailLon: "35.2",
    marker: "true",
    message: "true",
    calendar: "now",
    pressure: "true",
    menu: "true"
  });
  return `https://embed.windy.com/embed.html?${params.toString()}`;
}

function loadMap() {
  loading.hidden = false;
  frame.src = windyUrl(altitudeSelect.value);
  localStorage.setItem("haniaion-wind-level", altitudeSelect.value);
}

frame.addEventListener("load", () => {
  setTimeout(() => { loading.hidden = true; }, 500);
});
loadButton.addEventListener("click", loadMap);
altitudeSelect.addEventListener("change", loadMap);

const saved = localStorage.getItem("haniaion-wind-level");
if (saved && [...altitudeSelect.options].some(o => o.value === saved)) altitudeSelect.value = saved;
loadMap();
