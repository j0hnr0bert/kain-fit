import { Capacitor } from "@capacitor/core";

// No-op on web — only the native (Capacitor) shell ever calls the bridge.
export async function tapHaptic(style: "light" | "medium" = "light") {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: style === "light" ? ImpactStyle.Light : ImpactStyle.Medium });
  } catch {
    // Haptics are a nice-to-have — never let this break a save.
  }
}
