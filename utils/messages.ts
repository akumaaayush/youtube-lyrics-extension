export const SET_SELECTION = 'ytl:set-selection';
export const LRCLIB_SEARCH = 'ytl:lrclib-search';
export const TOGGLE = 'ytl:toggle';
export const STATUS = 'ytl:status';

export type SetSelectionMessage = { type: typeof SET_SELECTION; fallback: string };

export type LrclibQuery = { artist: string; track: string; duration: number | null };
export type LrclibSearchMessage = LrclibQuery & { type: typeof LRCLIB_SEARCH };
export type LrclibResult = { artist: string; track: string; synced: string | null; plain: string | null };

/** background → content: toolbar icon click (video) or its right-click menu (channel) */
export type ToggleScope = 'video' | 'channel-on' | 'channel-off';
export type ToggleMessage = { type: typeof TOGGLE; scope: ToggleScope };

/** content → background: drives the per-tab badge */
export type StatusMessage = { type: typeof STATUS; enabled: boolean; via: 'video' | 'channel' | 'tab' | null };
