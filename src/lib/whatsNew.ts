// The "What's new" card on Home: the latest update first. Add an entry when you ship
// something people would notice (plain words, like the changelog).

export interface NewsEntry {
  /** YYYY-MM-DD; also the key that remembers the card was seen */
  date: string;
  items: string[];
}

export const NEWS: NewsEntry[] = [
  {
    date: "2026-10-28",
    items: [
      "Weekend nights: their own bedtime and wake-up (Schedule tab)",
      "Auto-tune now suggests a level for every stage, not just deep sleep",
      "One \"Hot nights\" setting: your Pod's room sensor and/or the weather; tonight's curve shows the change",
      "Phone notifications fixed, and a tour that points at the real screen",
      "Send feedback straight from Settings",
      "A Sunday digest notification and a year-in-sleep picture",
    ],
  },
  {
    date: "2026-10-27",
    items: [
      "Nightstand follows your °C setting and shows whole levels",
      "A clear Exit button on the nightstand; Back closes it",
      "Auto-tune works without WHOOP",
    ],
  },
];
