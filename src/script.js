document.addEventListener("DOMContentLoaded", () => {
  const assistantFrame = document.querySelector("#ava-voice-assistant");
  const assistantCard = document.querySelector("#ava-assistant");
  const frameShell = assistantFrame?.closest(".ava-embed-shell");
  const frameLoading = frameShell?.querySelector(".ava-embed-loading");
  const frameError = frameShell?.querySelector(".ava-embed-error");
  const configuredUrl = window.BDS_CONFIG?.avaEmbedUrl;

  if (assistantFrame) {
    let loadingTimeout;

    const showAssistant = () => {
      window.clearTimeout(loadingTimeout);
      frameLoading?.setAttribute("hidden", "");
      frameError?.setAttribute("hidden", "");
      assistantFrame.removeAttribute("hidden");
      assistantFrame.classList.add("is-loaded");
      frameShell?.setAttribute("aria-busy", "false");
    };

    const showAssistantError = () => {
      window.clearTimeout(loadingTimeout);
      frameLoading?.setAttribute("hidden", "");
      assistantFrame.setAttribute("hidden", "");
      frameError?.removeAttribute("hidden");
      frameShell?.setAttribute("aria-busy", "false");
    };

    try {
      const embedUrl = new URL(configuredUrl);
      if (!["http:", "https:"].includes(embedUrl.protocol)) {
        throw new Error("Unsupported embed URL protocol");
      }

      assistantFrame.addEventListener("load", showAssistant);
      assistantFrame.addEventListener("error", showAssistantError, { once: true });
      assistantFrame.src = embedUrl.toString();
      loadingTimeout = window.setTimeout(showAssistantError, 20000);
    } catch {
      showAssistantError();
    }
  }

  document.querySelectorAll(".example-prompts button").forEach((button) => {
    button.addEventListener("click", () => {
      assistantCard?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  });

  document.querySelectorAll('a[href="#ava-assistant"]').forEach((link) => {
    link.addEventListener("click", () => {
      window.setTimeout(() => assistantFrame?.focus({ preventScroll: true }), 600);
    });
  });
});
