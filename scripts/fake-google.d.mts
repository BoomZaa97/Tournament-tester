export interface FakeGoogle {
  ctx: Record<string, unknown>;
  props: Map<string, string>;
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
