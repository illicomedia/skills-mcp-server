# Typography & Font Strategy: Privacy-First, Self-Hosted Design

**Document Status:** Active  
**Scope:** Illicomedia Ecosystem, Web Agency & Model Context Protocol (MCP) Showcase  
**Decision Driver:** Privacy (GDPR/CNIL), Performance (Core Web Vitals), and Professional Modern Tech Aesthetic

---

## 1. Context & Motivation

The website previously loaded typography via external third-party servers:
```html
<!-- Previous external dependency -->
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

While **Work Sans** provided an expressive grotesque style, two major drivers motivate a fundamental reconsideration:

1. **User Privacy & Regulatory Compliance (GDPR / CNIL):**  
   Calling `fonts.googleapis.com` and `fonts.gstatic.com` transmits visitor personal data (IP address, user-agent, referer) to third-party US infrastructure without user consent on the initial page view.
   - *Legal Precedent:* The Munich Regional Court ruling (*LG München, Az. 3 O 17493/20*) established that transmitting IP addresses to Google via Google Fonts violates GDPR without prior consent.
   - *CNIL / European Privacy Directives:* Loading third-party tracking assets during pre-consent rendering breaks zero-tracking guarantees.
   - *Ethical Alignment:* An AI and developer tooling agency must champion data sovereignty and user privacy by default.

2. **Aesthetic & Brand Realignment:**  
   Work Sans was designed with 19th-century wood-type characteristics (wide letterforms, loose tracking, quirky terminal angles). While charming for print or cultural editorial, it lacks the crisp, engineered precision expected of an AI engineering agency and high-density developer tools (such as MCP servers and registries).

3. **Performance & Network Latency:**  
   External fonts introduce 2 extra DNS lookups, 2 TLS handshakes, and a render-blocking stylesheet request. Self-hosting enables immediate HTTP/2 or HTTP/3 multiplexing from the origin or first-party CDN.

---

## 2. Font Evaluation Matrix

All evaluated candidates are licensed under the **SIL Open Font License 1.1** (or Apache 2.0), permitting free local self-hosting, bundling, and distribution without royalties.

| Typeface | Visual Profile | Monospace Companion | Self-Hosted Size (WOFF2 Variable) | Best Suited For |
| :--- | :--- | :--- | :--- | :--- |
| **Geist** *(Recommended)* | Ultra-modern, Swiss neo-grotesque, high precision | **Geist Mono** | ~28 KB (Latin subset) | AI platforms, MCP tools, developer tooling, modern web agency |
| **Inter** | Highly engineered, neutral, interface-optimized | **JetBrains Mono** / Inter Mono | ~32 KB (Latin subset) | SaaS dashboards, high-density documentation |
| **Plus Jakarta Sans** | Geometric, warm, polished, balanced | **Fira Code** | ~30 KB (Latin subset) | Corporate agency showcases, marketing landing pages |
| **System Font Stack** | Native OS native UI (San Francisco, Segoe UI, Roboto) | `ui-monospace` | **0 KB (Zero payload)** | Maximum performance, absolute zero external asset |

---

## 3. Recommended Choice: Geist & Geist Mono

### Why Geist?
1. **Designed for the AI & Developer Era:** Developed by Vercel & Basement Studio, Geist was engineered specifically for technical platforms, developer tooling, and modern interfaces.
2. **Superior Screen Legibility:** 
   - Generous x-height ensuring crisp readability at small text sizes (12px–14px).
   - Clear glyph disambiguation: distinct shapes for uppercase `I`, lowercase `l`, and digit `1`.
3. **Unified Brand Language with Geist Mono:** 
   - MCP servers deal with schemas, JSON objects, CLI commands, and tool definitions.
   - Geist Mono shares the exact geometric proportions and metrics of Geist Sans, creating seamless visual cohesion when switching between prose and code blocks.
4. **Lightweight Variable Font:**
   - Supports continuous weights from Light (300) to Bold (700) in a single compact `.woff2` file (~28 KB).

---

## 4. Architecture: Self-Hosting & Zero-Tracking Setup

### 4.1 Asset Placement
Store optimized WOFF2 files directly in the repository's static/public directory:
```text
website/public/fonts/
├── geist-sans-variable.woff2      # ~28 KB (Latin / Latin-ext subset)
└── geist-mono-variable.woff2      # ~24 KB (Latin subset)
```

### 4.2 Declarative `@font-face` Definition
In your base CSS or theme stylesheet (e.g. `src/styles/fonts.css`):

```css
/* Geist Sans (Variable: Weights 300 to 700) */
@font-face {
  font-family: 'Geist';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('/fonts/geist-sans-variable.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
                 U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193,
                 U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Geist Mono (Variable: Weights 400 to 700) */
@font-face {
  font-family: 'Geist Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/geist-mono-variable.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
                 U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193,
                 U+2212, U+2215, U+FEFF, U+FFFD;
}
```

### 4.3 Preloading for Core Web Vitals (Zero CLS, Fast LCP)
In `index.html`, preload the primary body font to guarantee instant rendering before layout paint:
```html
<!-- In <head>: Immediate first-party preload, no external connection -->
<link
  rel="preload"
  href="/fonts/geist-sans-variable.woff2"
  as="font"
  type="font/woff2"
  crossorigin="anonymous"
/>
```

### 4.4 Typography CSS Tokens & Fallback Stack
```css
:root {
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

body {
  font-family: var(--font-sans);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code, kbd, pre, samp, .font-mono {
  font-family: var(--font-mono);
}
```

---

## 5. Alternative Package-Managed Integration (Node/Vite)

If using a modern frontend build system (Vite / Next.js / Astro), Fontsource packages can manage versions and hashing automatically without manual file downloads:

```bash
pnpm add @fontsource-variable/geist @fontsource-variable/geist-mono
```

Import directly in your entry point (`src/main.tsx` or `src/index.css`):
```typescript
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
```
*Vite/Rollup will extract the WOFF2 files, hash them for immutable caching (`Cache-Control: max-age=31536000, immutable`), and host them strictly from the origin.*

---

## 6. Verification & Privacy Checklist

When changing fonts, verify compliance and performance using the following tests:
1. **Network Privacy Verification:**
   - Open browser DevTools Network tab.
   - Filter by domain or search for `google`, `gstatic`, or third-party URLs.
   - Confirm: **0 requests to external font domains.**
2. **Lighthouse & Core Web Vitals:**
   - **Cumulative Layout Shift (CLS):** `0.00` (guaranteed by preloading and `font-display: swap`).
   - **Largest Contentful Paint (LCP):** Improved by 100–300ms by removing cross-origin SSL handshakes.
3. **Offline Mode:**
   - Disconnect network in DevTools.
   - Reload page: fonts render natively with zero fallback flash.
