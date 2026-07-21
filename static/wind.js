const altitudeSelect = document.getElementById("altitudeSelect");
const loadButton = document.getElementById("loadButton");
const frame = document.getElementById("windFrame");
const openDirect = document.getElementById("openDirect");

function windyEmbedUrl(level) {
  const params = new URLSearchParams({
    lat: "29.5",
    lon: "39.5",
    detailLat: "31.8",
    detailLon: "35.2",
    width: "1200",
    height: "760",
    zoom: "4",
    level,
    overlay: "wind",
    product: "ecmwf",
    menu: "",
    message: "true",
    marker: "",
    calendar: "now",
    pressure: "true",
    type: "map",
    location: "coordinates",
    detail: "true",
    metricWind: "kt",
    metricTemp: "default",
    radarRange: "-1"
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

function loadMap() {
  const level = altitudeSelect.value;
  const url = windyEmbedUrl(level);
  frame.src = url;
  openDirect.href = url;
  localStorage.setItem("haniaion-wind-level", level);
}

loadButton.addEventListener("click", loadMap);
altitudeSelect.addEventListener("change", loadMap);

const saved = localStorage.getItem("haniaion-wind-level");
if (saved && [...altitudeSelect.options].some(option => option.value === saved)) {
  altitudeSelect.value = saved;
}

loadMap();
