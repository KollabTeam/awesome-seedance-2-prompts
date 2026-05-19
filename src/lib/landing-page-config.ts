/**
 * landing-page-config.ts declares the single public landing page exposed by this standalone project.
 * It sits in the App Router configuration layer and is shared by pages, API routes, metadata, CTA links,
 * and locale helpers so the exported open-source project does not carry unrelated landing page routes.
 */
import type { LandingPageCopyKey } from '@/lib/landing-copy';
import { LANDING_LANGUAGE_OPTIONS, type LandingLanguage } from '@/lib/landing-language';

export type LandingPageVisualVariant = 'arcade' | 'handdrawn';
export type LandingPromptCommand = '/gpt-image-2' | '/seedance-2';
export type LandingPromptCommandConfig = {
  primary: LandingPromptCommand;
  secondary?: LandingPromptCommand;
};

export type LandingPageConfig = {
  routeSlug: string;
  sourceSlug: string;
  copyKey: LandingPageCopyKey;
  visualVariant: LandingPageVisualVariant;
  promptCommand: LandingPromptCommandConfig;
  supportedLanguages: LandingLanguage[];
};

const LANDING_PAGE_CONFIGS: LandingPageConfig[] = [
  {
    routeSlug: 'seedance-2-prompts',
    sourceSlug: 'seedance-2',
    copyKey: 'seedance2Prompts',
    visualVariant: 'handdrawn',
    promptCommand: {
      primary: '/seedance-2',
    },
    supportedLanguages: LANDING_LANGUAGE_OPTIONS.map((option) => option.code),
  },
];

/**
 * Returns the only landing page configuration bundled in this standalone project.
 * Dynamic route helpers still consume an array because the source application was shared, but this copy intentionally
 * exposes one route so it can be published as an independent repository without dragging in sibling pages.
 */
export function getLandingPageConfigs(): LandingPageConfig[] {
  return LANDING_PAGE_CONFIGS;
}

/**
 * Finds the landing page config for a public route slug.
 * Page and API handlers call this guard before rendering so unknown marketing paths return 404 instead of reusing
 * this project's data under an accidental URL.
 */
export function getLandingPageConfigByRouteSlug(routeSlug: string): LandingPageConfig | null {
  return LANDING_PAGE_CONFIGS.find((config) => config.routeSlug === routeSlug.trim()) || null;
}

/**
 * Finds the landing page config for a data source slug.
 * The database read path uses this helper when local development proxies to a public prompts API; keeping it here
 * avoids a second source-to-route mapping in server code.
 */
export function getLandingPageConfigBySourceSlug(sourceSlug: string): LandingPageConfig | null {
  return LANDING_PAGE_CONFIGS.find((config) => config.sourceSlug === sourceSlug.trim()) || null;
}
