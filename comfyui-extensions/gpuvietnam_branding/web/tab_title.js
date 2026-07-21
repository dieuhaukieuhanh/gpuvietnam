import { app } from "../../scripts/app.js";

const TITLE = "Character & Art";

function applyTitle() {
  if (document.title !== TITLE) {
    document.title = TITLE;
  }
}

app.registerExtension({
  name: "gpuvietnam.tabTitle",
  async setup() {
    applyTitle();
    const timer = setInterval(applyTitle, 1500);
    setTimeout(() => clearInterval(timer), 60000);
    try {
      const obs = new MutationObserver(applyTitle);
      const el = document.querySelector("title");
      if (el) obs.observe(el, { childList: true, characterData: true, subtree: true });
    } catch (_) {}
  },
});