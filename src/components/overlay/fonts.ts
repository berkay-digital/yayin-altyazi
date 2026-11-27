import type { FontId } from "@/shared/settings"

// Each font is its own CSS chunk, loaded only when a streamer picks it.
const loaders: Record<FontId, (() => Promise<unknown>) | null> = {
  inter: () => import("@fontsource-variable/inter"),
  montserrat: () => import("@fontsource-variable/montserrat"),
  roboto: () => import("@fontsource-variable/roboto"),
  nunito: () => import("@fontsource-variable/nunito"),
  rubik: () => import("@fontsource-variable/rubik"),
  oswald: () => import("@fontsource-variable/oswald"),
  geist: () => import("@fontsource-variable/geist"),
  system: null,
}

const loaded = new Set<FontId>()

export function loadFont(id: FontId) {
  if (typeof window === "undefined" || loaded.has(id)) return
  loaded.add(id)
  void loaders[id]?.().catch(() => loaded.delete(id))
}
