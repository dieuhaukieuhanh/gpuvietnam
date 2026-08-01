/**
 * GPUVietnam Filmmaker Resume — web endpoint for auto-recover trigger.
 * Worker calls POST /gpuvietnam/filmmaker/resume after GPU auto-replace completes.
 */
import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "gpuvietnam.filmmaker.resume",
    async setup() {
        const resumePath = "/gpuvietnam/filmmaker/resume";

        // Register HTTP route on ComfyUI PromptServer
        try {
            const resp = await fetch("/gpuvietnam/filmmaker/ping", { method: "HEAD" });
            // Route already registered — noop
        } catch {
            // Register route via PromptServer
            if (typeof window !== "undefined" && window.comfyAPI) {
                window.comfyAPI.registerRoute(resumePath, async (req) => {
                    return { status: "ok", message: "Filmmaker resume endpoint ready" };
                });
            }
        }
    },
});
