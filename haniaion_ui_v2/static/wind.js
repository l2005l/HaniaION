(() => {
  const $ = (id) => document.getElementById(id);
  const weatherCodes = {
    0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",
    51:"Light drizzle",53:"Drizzle",55:"Dense drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",
    71:"Light snow",73:"Snow",75:"Heavy snow",80:"Rain showers",81:"Rain showers",82:"Heavy showers",
    95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm with hail"
  };

  function message(text, error=false) {
    $("weatherMessage").textContent = text;
    $("weatherMessage").className = error ? "message error" : "message";
  }

  async function loadWeather() {
    const lat = Number($("latitude").value);
    const lon = Number($("longitude").value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return message("Enter valid coordinates.", true);
    message("Loading weather…");
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        current: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m",
        timezone: "UTC"
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
      const data = await res.json();
      const c = data.current;
      $("temperature").textContent = `${c.temperature_2m} ${data.current_units.temperature_2m}`;
      $("windSpeed").textContent = `${c.wind_speed_10m} ${data.current_units.wind_speed_10m}`;
      $("windDirection").textContent = `${c.wind_direction_10m}°`;
      $("conditions").textContent = weatherCodes[c.weather_code] || `Code ${c.weather_code}`;
      $("weatherUpdated").textContent = `Updated ${c.time} UTC`;
      $("weatherCard").classList.remove("hidden");
      message("");
    } catch (e) { message(`Could not load weather: ${e.message}`, true); }
  }

  $("locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return message("Location is not supported on this device.", true);
    message("Requesting location…");
    navigator.geolocation.getCurrentPosition(
      pos => {
        $("latitude").value = pos.coords.latitude.toFixed(5);
        $("longitude").value = pos.coords.longitude.toFixed(5);
        loadWeather();
      },
      err => message(`Location unavailable: ${err.message}`, true),
      {enableHighAccuracy:false, timeout:10000, maximumAge:300000}
    );
  });
  $("weatherBtn").addEventListener("click", loadWeather);
})();
