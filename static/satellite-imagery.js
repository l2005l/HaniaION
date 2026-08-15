(() => {
  "use strict";
  const nav = document.querySelector(".mode-tabs");
  const warning = document.getElementById("sourceWarning");
  const globe = document.getElementById("globeMode");
  if (!nav || !warning || !globe) return;

  nav.querySelectorAll(".mode-tab").forEach(button => button.classList.remove("active"));
  globe.classList.remove("active");

  const button = document.createElement("button");
  button.className = "mode-tab active";
  button.dataset.mode = "imagery";
  button.textContent = "📡 תמונה עדכנית";
  nav.prepend(button);

  const section = document.createElement("section");
  section.id = "imageryMode";
  section.className = "mode-panel active";
  section.innerHTML = `
    <article class="imagery-card">
      <header class="imagery-head">
        <div><span class="eyebrow">METEOSAT-12 · EUMETSAT</span>
          <h2>אירופה, הים התיכון וישראל — כמעט בזמן אמת</h2>
          <p>תמונה חדשה מתקבלת בערך בכל 10 דקות. השידור מוצג בעיכוב עיבוד של כ־30 דקות.</p>
        </div><span class="imagery-live"><i></i> NEAR LIVE</span>
      </header>
      <div class="imagery-frame"><iframe src="https://www.youtube-nocookie.com/embed/live_stream?channel=UCiN59j5b1fAGnXVzIYFpaMw&autoplay=0&mute=1&playsinline=1" title="EUMETSAT Earth View — Meteosat near-real-time imagery" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
      <div class="imagery-meta"><div><small>זמן תמונה משוער</small><strong id="imageryEstimatedTime">מחשב…</strong></div><div><small>קצב עדכון</small><strong>כל 10 דקות</strong></div><div><small>סוג התמונה</small><strong>צבע ביום · אינפרה־אדום בלילה</strong></div></div>
      <div class="imagery-actions"><a href="https://www.eumetsat.int/real-time-imagery/earth-view" target="_blank" rel="noopener">פתח תצוגת EUMETSAT</a><a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener">פתח NASA Worldview</a></div>
      <p class="imagery-note">זו תמונת מזג־אוויר ציבורית של אזור רחב, לא צילום ממוקד של אדם, בית או רחוב. אם אין כרגע שידור בנגן, אפשר לפתוח את אחד המקורות בכפתורים.</p>
    </article>`;
  warning.before(section);

  const target = document.getElementById("imageryEstimatedTime");
  const update = () => {
    const estimated = new Date(Date.now() - 30 * 60 * 1000);
    target.textContent = `${new Intl.DateTimeFormat("he-IL", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"UTC"}).format(estimated)} UTC (משוער)`;
  };
  update();
  window.setInterval(update, 60_000);
})();
