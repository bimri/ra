// Ra's names. UI copy, prompts and code use these words and no others.
export const NAMES = {
  ray: "Ray", // one spoken session
  star: "Star", // your mission; only you write it
  horizon: "Horizon", // where the world is going
  dial: "Dial", // timing calls, kept apart from direction
  islands: "Islands",
  landfall: "Landfall",
  trip: "Scouting trip",
  rings: "Rings", // the growth record
  crews: "Crews",
  beacon: "Beacon", // consent takes two yeses
  ear: "the Ear", // quick thoughts from WhatsApp
  watch: "the Watch", // the nightly pass
  chart: "the Chart",
  pocket: "Pocket", // the phone's vault, waiting captures and export
} as const;

export type RaName = keyof typeof NAMES;
