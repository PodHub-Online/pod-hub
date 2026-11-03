// "I'm hot" remembers how each side was before, so it can be put back when it ends.
export type HotPrev = Record<string, { on: boolean; level: number | null } | undefined>;

export const parseHotPrev = (raw: string | null): HotPrev => {
  try {
    return raw ? (JSON.parse(raw) as HotPrev) : {};
  } catch {
    return {};
  }
};
