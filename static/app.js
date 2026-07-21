const calculateButton =
  document.getElementById("calculateButton");

const refreshButton =
  document.getElementById("refreshButton");

const copyButton =
  document.getElementById("copyButton");

const progressPanel =
  document.getElementById("progressPanel");

const resultsPanel =
  document.getElementById("resultsPanel");

const errorPanel =
  document.getElementById("errorPanel");

const errorText =
  document.getElementById("errorText");

let latestResult = null;

function setLoading(loading) {
  calculateButton.disabled = loading;

  progressPanel.classList.toggle(
    "hidden",
    !loading
  );

  if (loading) {
    errorPanel.classList.add("hidden");
  }
}

function showError(message) {
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
}

function displayResult(data) {
  latestResult = data;

  document.getElementById("fileName").textContent =
    data.file_name;

  document.getElementById("sourceDate").textContent =
    data.source_date;

  document.getElementById("data1").textContent =
    data.data1;

  document.getElementById("data2").textContent =
    data.data2;

  document.getElementById("data3").textContent =
    data.data3;

  document.getElementById("data4").textContent =
    data.data4;

  document.getElementById("tls").textContent =
    data.tls;

  document.getElementById("alpha").textContent =
    data.alpha.join(", ");

  document.getElementById("beta").textContent =
    data.beta.join(", ");

  document.getElementById("cacheBadge").textContent =
    data.cached
      ? "תוצאה שמורה"
      : "עודכן כעת";

  resultsPanel.classList.remove("hidden");
}

async function calculate() {
  setLoading(true);

  try {
    const response = await fetch(
      "/api/calculate",
      {
        method: "POST",
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.detail ||
        "אירעה שגיאה לא ידועה."
      );
    }

    displayResult(payload);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function copyResults() {
  if (!latestResult) {
    return;
  }

  const text = [
    `Data1: ${latestResult.data1}`,
    `Data2: ${latestResult.data2}`,
    `Data3: ${latestResult.data3}`,
    `Data4: ${latestResult.data4}`,
    `tLS: ${latestResult.tls}`,
  ].join("\n");

  await navigator.clipboard.writeText(text);

  copyButton.textContent = "הועתק";

  setTimeout(
    () => (
      copyButton.textContent = "העתק תוצאות"
    ),
    1500
  );
}

calculateButton.addEventListener(
  "click",
  calculate
);

refreshButton.addEventListener(
  "click",
  calculate
);

copyButton.addEventListener(
  "click",
  copyResults
);

if ("serviceWorker" in navigator) {
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register(
        "/service-worker.js"
      );
    }
  );
}
