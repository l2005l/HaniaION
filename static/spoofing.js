// v2.19 — Android Native GNSS + location consistency / spoofing monitor
(() => {
  const panel = document.getElementById("gnss-advanced");
  if (!panel) return;

  let received = 0;
  let previous = null;
  let spoofScore = 0;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const finite = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const distanceMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  window.addEventListener("haniaion-native-gnss", event => {
    const d = event.detail || {};

    if (d.source !== "android-native") return;

    window.haniaionNativeGnss = d;
    received += 1;

    panel.classList.remove("hidden");

    const view = finite(d.satellitesInView) ?? 0;
    const used = finite(d.satellitesUsed) ?? 0;
    const cn0 = finite(d.avgCn0DbHz);
    const accuracy = finite(d.accuracyM);

    set("nativeSatView", view || "—");
    set("nativeSatUsed", used || "—");
    set(
      "nativeCn0",
      cn0 && cn0 > 0 ? cn0.toFixed(1) : "—"
    );
    set(
      "nativeAccuracy",
      accuracy && accuracy > 0
        ? `±${accuracy.toFixed(1)} m`
        : "—"
    );

    const constellations = d.constellations || {};

    const constellationText = Object.entries(constellations)
      .filter(([, n]) => Number(n) > 0)
      .map(([name, n]) => `${name} ${n}`)
      .join(" · ");

    set(
      "nativeConstellations",
      constellationText || "ממתין לזיהוי מערכות"
    );

    const lat = finite(d.latitude);
    const lon = finite(d.longitude);
    const speed = finite(d.speedMps);
    const locationTime =
      finite(d.locationTimeMs) ||
      finite(d.timestamp) ||
      Date.now();

    // Score naturally falls when measurements stay consistent.
    spoofScore = Math.max(0, spoofScore - 4);

    let lastDistance = null;
    let impliedSpeed = null;

    if (
      previous &&
      lat !== null &&
      lon !== null &&
      previous.lat !== null &&
      previous.lon !== null
    ) {
      const dt =
        (locationTime - previous.time) / 1000;

      if (dt > 0.25 && dt < 15) {
        lastDistance = distanceMeters(
          previous.lat,
          previous.lon,
          lat,
          lon
        );

        impliedSpeed = lastDistance / dt;

        // Sudden large jump with a reasonably good GNSS fix.
        if (
          accuracy !== null &&
          accuracy <= 25 &&
          used >= 4 &&
          lastDistance > Math.max(100, accuracy * 5) &&
          impliedSpeed > 45
        ) {
          spoofScore += 30;
        }

        // Location movement conflicts strongly with Android speed.
        if (
          speed !== null &&
          impliedSpeed > Math.max(35, speed * 4 + 12)
        ) {
          spoofScore += 20;
        }

        // Device reports almost stationary while coordinates jump.
        if (
          speed !== null &&
          speed < 1.5 &&
          lastDistance > 60 &&
          dt < 5
        ) {
          spoofScore += 25;
        }

        // Extremely unrealistic short-term displacement.
        if (
          impliedSpeed > 120 &&
          lastDistance > 150
        ) {
          spoofScore += 30;
        }
      }
    }

    spoofScore = Math.min(100, spoofScore);

    let spoofStatus = "לא זוהו סימני הטעיית מיקום";
    let spoofLevel = "clear";

    if (spoofScore >= 60) {
      spoofStatus = "חשד גבוה להטעיית מיקום";
      spoofLevel = "high";
    } else if (spoofScore >= 35) {
      spoofStatus = "אי־התאמה חשודה במיקום";
      spoofLevel = "warning";
    }

    window.haniaionSpoofing = {
      score: spoofScore,
      status: spoofStatus,
      level: spoofLevel,
      distanceM: lastDistance,
      impliedSpeedMps: impliedSpeed,
      androidSpeedMps: speed,
      timestamp: Date.now()
    };

    const note =
      document.getElementById("nativeGnssNote");

    if (note) {
      let quality = "יציב";

      if (
        used >= 4 &&
        accuracy !== null &&
        accuracy <= 20 &&
        cn0 !== null &&
        cn0 >= 18
      ) {
        quality = "נתוני Native מתאימים לניתוח משולב";
      } else if (view > 10 && used <= 2) {
        quality = "נראים לוויינים אך ה־Fix חלש";
      }

      note.textContent =
        `${quality} · ${spoofStatus}` +
        ` · מדד הטעיה ${Math.round(spoofScore)}/100` +
        ` · מדידה #${received}` +
        ` · ${new Date(
          finite(d.timestamp) || Date.now()
        ).toLocaleTimeString("he-IL")}`;
    }

    previous = {
      lat,
      lon,
      time: locationTime,
      accuracy,
      speed
    };
  });
})();
