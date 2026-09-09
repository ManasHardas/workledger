/**
 * Loaded by `src/index.css`'s `@config` (Tailwind v4 no longer auto-detects a JS config). Its only
 * content is the generated preset: every color, spacing, radius and type value apps/web can name
 * comes from `packages/tokens/tokens.json` (design spec §14.1).
 */
import tokens from "@workledger/tokens/tailwind.preset.js";

/** @type {import("tailwindcss").Config} */
export default {
  presets: [tokens],
};
