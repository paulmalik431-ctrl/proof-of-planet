// Ghost Audit cases: fraudulent evidence that Meta's Muse Image generates to attack ECO's own checks.
// Shared by scripts/ghost-audit.ts (local) and functions/ghost-audit (server-side, where the model key lives).
import type { ProtocolId } from "./protocols.ts";

export const FAKES: Array<{ id: string; protocol: ProtocolId; prompts: Record<string, string>; note: string }> = [
  { id: "ai-sapling-1", protocol: "tree_planting", prompts: { planting: "smartphone photo of a young tree sapling freshly planted in dark soil, daylight, slightly blurry, realistic" }, note: "Fully AI-generated planting photo" },
  { id: "ai-sapling-2", protocol: "tree_planting", prompts: { planting: "a person's hands pressing soil around a newly planted mango seedling in a rural garden, phone camera photo" }, note: "AI-generated planting with hands" },
  { id: "potted-plant", protocol: "tree_planting", prompts: { planting: "a small green plant in a plastic pot on a kitchen table indoors, phone photo" }, note: "Potted indoor plant passed off as planting" },
  { id: "mature-tree", protocol: "tree_planting", prompts: { planting: "a large old tree in a city park, phone photo" }, note: "Existing mature tree, nothing planted" },
  { id: "shop-shelf", protocol: "recycling", prompts: { items: "supermarket shelf full of new unopened plastic soda bottles and cans, phone photo" }, note: "New stock on a shop shelf, not collected waste" },
  { id: "ai-recyclables", protocol: "recycling", prompts: { items: "used crushed plastic bottles and drink cans spread out on the ground for counting, phone photo" }, note: "AI-generated recyclables" },
  { id: "cleanup-two-places", protocol: "cleanup", prompts: { before: "a roadside ditch full of plastic litter in a town, phone photo", after: "a clean empty beach with white sand, phone photo" }, note: "Before and after from different places" },
  { id: "cleanup-no-change", protocol: "cleanup", prompts: { before: "plastic bags and bottles littered on an empty lot, phone photo", after: "plastic bags and bottles littered on an empty lot, phone photo, slightly different angle" }, note: "After photo still littered" },
];

/** Loop attacks: AI-made lot photos. The seller's one-time code is CHALLENGE; a fake must never be listed. */
export const LOT_CHALLENGE = "KMRB";
export const LOT_FAKES: Array<{ id: string; prompt: string; note: string }> = [
  { id: "lot-wrong-code", prompt: "phone photo of about twenty used blue and white plastic jerrycans piled in a yard, a sheet of paper on top with the handwritten letters QXZT", note: "AI-made jerrycan lot with the wrong code on paper" },
  { id: "lot-right-code", prompt: `phone photo of about twenty used plastic jerrycans piled in a yard, a sheet of paper on top with the handwritten letters ${"KMRB"}`, note: "AI-made jerrycan lot that copies the right code" },
  { id: "lot-no-code", prompt: "phone photo of about twenty used plastic jerrycans piled in a yard, no paper", note: "AI-made jerrycan lot with no code at all" },
];
