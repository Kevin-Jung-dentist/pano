"use strict";
(() => {
  const before = document.getElementById("demo-before");
  const after = document.getElementById("demo-after");
  function showExample(mode) {
    const isAfter = mode === "after";
    document.getElementById("example-before").hidden = isAfter;
    document.getElementById("example-after").hidden = !isAfter;
    before.setAttribute("aria-pressed", String(!isAfter));
    after.setAttribute("aria-pressed", String(isAfter));
    const status = document.getElementById("demo-status-label");
    status.dataset.i18n = mode;
    status.textContent = LoDI18n.t(mode);
  }
  before.addEventListener("click", () => showExample("before"));
  after.addEventListener("click", () => showExample("after"));
  document.querySelectorAll("[data-practice]").forEach(button => {
    button.addEventListener("click", () => document.getElementById("practice").click());
  });
  function imageLabels() {
    document.getElementById("example-before").alt = LoDI18n.t("beforeAlt");
    document.getElementById("example-after").alt = LoDI18n.t("afterAlt");
  }
  document.addEventListener("lod-language", imageLabels);
  imageLabels();
})();