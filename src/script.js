document.addEventListener("DOMContentLoaded", () => {
  const assistantFrame = document.querySelector("#ava-voice-assistant");
  const frameError = document.querySelector(".ava-embed-error");
  const configuredUrl = window.BDS_CONFIG?.avaEmbedUrl;

  if (assistantFrame) {
    try {
      const embedUrl = new URL(configuredUrl);
      if (!["http:", "https:"].includes(embedUrl.protocol)) {
        throw new Error("Unsupported embed URL protocol");
      }
      assistantFrame.src = embedUrl.toString();
    } catch {
      assistantFrame.hidden = true;
      if (frameError) frameError.hidden = false;
    }
  }

  document.querySelectorAll(".example-prompts button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(".voice-widget-card")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  });
});
