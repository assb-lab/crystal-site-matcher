// Language-neutral messages produced by library code; the UI translates them (see src/i18n).
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

export class MsgError extends Error {
  msg: Msg;
  constructor(key: string, params?: Msg["params"]) {
    super(key);
    this.msg = { key, params };
  }
}

export const msg = (key: string, params?: Msg["params"]): Msg => ({ key, params });
