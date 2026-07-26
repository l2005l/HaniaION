(() => {
  const root = document.documentElement;
  const stored = localStorage.getItem("haniaion-theme");
  const initial = stored || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  root.dataset.theme = initial;

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("haniaion-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#0b1020" : "#f4f7fb");
  });

  const clock = document.getElementById("utcClock");
  const tick = () => {
    if (!clock) return;
    const now = new Date();
    clock.textContent = `UTC ${now.toISOString().slice(11,19)}`;
  };
  tick();
  setInterval(tick, 1000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();
