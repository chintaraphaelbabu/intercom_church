# 02: Migrate director screens

**What to build:** Apply new flat-black, sharp-border, square-button, full-width, mono-font styles to the director web app (`styles.css` and `App.tsx` inline styles) for Setup/Mixer, Live, and Diagnostics views.

**Blocked by:** 01 Expand design tokens

**Status:** ready-for-agent

- [ ] `styles.css`: `#000` body/bg, `1px #333` borders on cards/status/buttons, `border-radius: 0`, `font-family` mono, full width (`max-width: 100%`)
- [ ] `App.tsx` inline styles: remove gradients / rounded styles, match sharp theme
- [ ] All three screens (Setup, Live, Diagnostics) render with new design
