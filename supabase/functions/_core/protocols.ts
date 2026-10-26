// Climate-action protocols: what evidence each action needs, what Meta's models look for,
// and how much ECOIN verified work earns. Protocols are data, so new actions are added
// without touching the verifier, the agent or the ledger.

export type Tri = "yes" | "no" | "unclear";

export interface PhotoRole {
  role: string;
  label: string;          // shown on the Evidence File
  ask: string;            // what the agent asks the person to send
  sam: string[];          // SAM 3.1 noun phrases counted in this photo
  minCount: number;       // fewer detections than this raises a doubt
}

export interface Question {
  key: string;
  ask: string;            // asked of Muse Spark, answered yes / no / unclear
  expect: "yes" | "no";
  hard: boolean;          // a confident wrong answer contradicts the claim (otherwise it only raises a doubt)
}

export interface Protocol {
  id: ProtocolId;
  title: string;
  summary: string;
  photos: PhotoRole[];
  questions: Question[];
  /** Earlier claim this one follows up (e.g. survival check of a planting). */
  parent?: { protocol: ProtocolId; minDays: number; maxDistanceM: number };
  /** ECOIN for a consistent claim, from SAM counts per photo role. */
  reward: (counts: Record<string, number>) => number;
}

export type ProtocolId = "tree_planting" | "tree_survival" | "cleanup" | "recycling";

export const PROTOCOLS: Record<ProtocolId, Protocol> = {
  tree_planting: {
    id: "tree_planting",
    title: "Tree planting",
    summary: "Plant a tree, send a photo and your location. Earn 100 ECOIN now and 400 more when it is still alive after 30 days.",
    photos: [{ role: "planting", label: "Newly planted tree", ask: "a photo of the tree you just planted, in the ground", sam: ["sapling"], minCount: 1 }],
    questions: [
      { key: "young_tree_in_ground", ask: "Is a young tree or sapling visibly planted in the ground?", expect: "yes", hard: true },
      { key: "recently_planted", ask: "Does the soil around it look freshly dug or recently planted?", expect: "yes", hard: false },
      { key: "potted_or_indoor", ask: "Is the plant in a pot, bag or indoors rather than in open ground?", expect: "no", hard: true },
    ],
    reward: () => 100,
  },
  tree_survival: {
    id: "tree_survival",
    title: "Tree survival check",
    summary: "30 days after planting, send a new photo from the same spot. Earn 400 ECOIN if the tree is alive.",
    photos: [{ role: "survival", label: "Same tree after 30+ days", ask: "a new photo of the same tree, from the same spot", sam: ["sapling"], minCount: 1 }],
    questions: [
      { key: "same_site", ask: "Comparing with the original planting photo, is this the same site (same ground, fences, buildings, nearby plants)?", expect: "yes", hard: true },
      { key: "tree_alive", ask: "Is the tree alive (green leaves, upright)?", expect: "yes", hard: true },
    ],
    parent: { protocol: "tree_planting", minDays: 25, maxDistanceM: 50 },
    reward: () => 400,
  },
  cleanup: {
    id: "cleanup",
    title: "Cleanup",
    summary: "Clean up a littered place. Send a before photo and an after photo from the same spot. Earn up to 300 ECOIN.",
    photos: [
      { role: "before", label: "Before cleanup", ask: "a BEFORE photo of the littered place", sam: ["litter"], minCount: 1 },
      { role: "after", label: "After cleanup", ask: "an AFTER photo from the same spot", sam: ["litter"], minCount: 0 },
    ],
    questions: [
      { key: "same_place", ask: "Do the before and after photos show the same place?", expect: "yes", hard: true },
      { key: "visibly_cleaner", ask: "Is the place visibly cleaner in the after photo?", expect: "yes", hard: true },
    ],
    reward: (c) => Math.min(300, 50 + 10 * Math.max(0, (c.before ?? 0) - (c.after ?? 0))),
  },
  recycling: {
    id: "recycling",
    title: "Recycling drop-off",
    summary: "Collect plastic bottles and cans and hand them in at a collection point. Earn 5 ECOIN per item counted, up to 200.",
    photos: [{ role: "items", label: "Collected recyclables", ask: "one photo with all the bottles and cans spread out so each is visible", sam: ["plastic bottle", "drink can"], minCount: 1 }],
    questions: [
      { key: "recyclables_visible", ask: "Are plastic bottles or drink cans clearly visible?", expect: "yes", hard: true },
      { key: "collected_not_in_shop", ask: "Do the items look collected/used rather than new stock on a shop shelf?", expect: "yes", hard: true },
    ],
    reward: (c) => Math.min(200, 5 * (c.items ?? 0)),
  },
};

export const STARTABLE: ProtocolId[] = ["tree_planting", "cleanup", "recycling"];

export function nextMissingPhoto(p: Protocol, have: string[]): PhotoRole | null {
  return p.photos.find((r) => !have.includes(r.role)) ?? null;
}
