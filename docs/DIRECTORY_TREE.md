# Proposed directory tree

The authoritative tree with owners is in **`AGENTS.md` §3**, and the ownership matrix is in **`AGENTS.md` §4**. This file adds the proposed `package.json` scripts and dependencies so T00 can scaffold everything in one go.

## `package.json` (proposed; T00 creates it)

```jsonc
{
  "name": "proofpay",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "node scripts/start.mjs",          // runs db reset+seed if SEED_ON_BOOT=1, then `next start -p $PORT`
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "npm run lint && npm run typecheck && npm test",
    "db:generate": "drizzle-kit generate",
    "db:reset": "tsx scripts/db-reset.ts",
    "e2e": "playwright test",
    "eval": "tsx scripts/eval.ts",
    "eval:validate": "tsx scripts/eval-validate.ts"
  }
}
```

Dependencies (verify latest versions at install time, and don't pin to versions you haven't installed):
- runtime: `next`, `react`, `react-dom`, `zod`, `ai`, `@ai-sdk/google`, `@ai-sdk/openai`, `@paypal/agent-toolkit`, `@paypal/react-paypal-js`, `drizzle-orm`, `better-sqlite3`, `sharp`, `exifr`, `server-only`, `clsx`, `tailwind-merge`, `lucide-react`, `ag-grid-react`, `ag-grid-community` (F09 escrow/ledger dashboard, MVP)
- dev: `typescript`, `@types/node`, `@types/react`, `@types/better-sqlite3`, `drizzle-kit`, `tsx`, `vitest`, `@playwright/test`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`

## `render.yaml` (proposed; T15 finalises it)

```yaml
services:
  - type: web
    name: proofpay
    runtime: node
    plan: free            # free = ephemeral disk + spin-down (verify current Render free-tier limits)
    buildCommand: npm ci --include=dev && npm run build   # NODE_ENV=production would otherwise skip devDependencies
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: PAYPAL_ENV
        value: sandbox
      - key: PAYPAL_API_BASE
        value: https://api-m.sandbox.paypal.com
      - key: SEED_ON_BOOT
        value: "1"
      - key: VISION_MOCK
        value: "0"
      - key: PAYPAL_CLIENT_ID
        sync: false        # set in dashboard
      - key: PAYPAL_CLIENT_SECRET
        sync: false
      - key: NEXT_PUBLIC_PAYPAL_CLIENT_ID
        sync: false        # NOTE: NEXT_PUBLIC_* is inlined at BUILD time, so set it before the first build
      - key: GOOGLE_GENERATIVE_AI_API_KEY
        sync: false
      - key: REVIEWER_PASSCODE
        sync: false
```
(Check the blueprint keys against https://render.com/docs/blueprint-spec before deploying.)
