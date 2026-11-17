export interface FakeGoogle {
  ctx: Record<string, unknown>;
  props: Map<string, string>;
  /** Move the CacheService clock forward (cache entries expire). */
  advance(ms: number): void;
  /** Every UrlFetchApp request Code.gs made, oldest first. */
  fetched: { url: string; options: { payload?: string; [k: string]: unknown } }[];
  /** How the fake internet answers. Default: 204 No Content. */
  onFetch(fn: (url: string, options: Record<string, unknown>) => { code: number; body: string }): void;
  /** Filled rows of each tab (live: changing a cell changes the sheet, like editing it by hand). */
  sheets: {
    get(name: string): string[][] | undefined;
    has(name: string): boolean;
    set(name: string, row: number, col: number, value: string): void;
    dump(): Record<string, string[][] | undefined>;
  };
  tab(name: string): any;
  get(params: Record<string, string>): any;
  post(body: Record<string, unknown>): any;
}
export function fakeGoogle(options?: { adminKey?: string; codePath?: string; rows?: number }): FakeGoogle;
