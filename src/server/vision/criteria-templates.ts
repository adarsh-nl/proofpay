/**
 * Category criteria templates (shared prompt C5) and the system liveness
 * criterion. Created in T02 (Backend lane) so the seed and the criteria
 * generator fallback share one source of truth; the Vision lane may extend the
 * generator logic in this file after T02.
 */

import type { Criterion, JobCategory } from "@/shared/contracts";

export interface CriterionTemplate {
  id: string;
  label: string;
  howToVerify: string;
  required: boolean;
  weight: number;
  phase: "after" | "before_after";
}

/** System criterion: always appended last, required, weight 0. `{CODE}` is filled at AUTHORIZED. */
export const LIVENESS_CRITERION_TEMPLATE: CriterionTemplate = {
  id: "cL",
  label:
    "Liveness code {CODE} visible in at least one after photo (written on paper or shown on a phone screen)",
  howToVerify:
    "Read the four digits visible in the after photo and compare them with the liveness code generated when the payment was authorized. If the photo does not show a legible four-digit code, the code cannot be verified.",
  required: true,
  weight: 0,
  phase: "after",
};

export const CATEGORY_TEMPLATE_CRITERIA: Readonly<
  Record<JobCategory, readonly CriterionTemplate[]>
> = {
  bike_repair: [
    {
      id: "c1",
      label: "Chain is new/clean and fully seated on the sprockets",
      howToVerify:
        "Look at the chainring and rear cassette: the chain must be uniform, free of heavy rust or grime, and seated on the teeth along its whole visible run.",
      required: true,
      weight: 0.35,
      phase: "after",
    },
    {
      id: "c2",
      label: "Chain tension looks correct (no excessive sag)",
      howToVerify:
        "Check the lower run of the chain: it should be taut with only a small amount of play, not hanging in a deep loop.",
      required: true,
      weight: 0.25,
      phase: "after",
    },
    {
      id: "c3",
      label: "Drivetrain is lubricated without excess oil",
      howToVerify:
        "Look for a light sheen on the chain links; reject if the chain is bone dry or dripping with excess oil.",
      required: false,
      weight: 0.2,
      phase: "after",
    },
    {
      id: "c4",
      label: "Work area and bike left tidy",
      howToVerify:
        "Look around the bike and the floor: no tools, packaging or dirty rags left in the frame.",
      required: false,
      weight: 0.2,
      phase: "after",
    },
  ],
  cleaning: [
    {
      id: "c1",
      label: "Floor is clear of dust and marks",
      howToVerify:
        "Look at the floor in the after photo: no visible dust, crumbs, hair or scuff marks compared with the before photo.",
      required: true,
      weight: 0.2,
      phase: "before_after",
    },
    {
      id: "c2",
      label: "Surfaces wiped, no streaks",
      howToVerify:
        "Look at the cleaned worktops and mirrors: no streaks, water marks or smears visible in the light.",
      required: false,
      weight: 0.2,
      phase: "after",
    },
    {
      id: "c3",
      label: "Sink/bathroom spotless",
      howToVerify:
        "Look at the sink basin and taps: no visible grime, limescale or hair; the surface appears clean and dry.",
      required: true,
      weight: 0.2,
      phase: "after",
    },
    {
      id: "c4",
      label: "Oven interior has no visible grease",
      howToVerify:
        "Look inside the oven through the open door: the interior walls and door glass must have no visible grease or burnt-on residue.",
      required: false,
      weight: 0.2,
      phase: "after",
    },
    {
      id: "c5",
      label: "Rubbish removed",
      howToVerify:
        "Look at the bin area and floors: no filled rubbish bags, packaging or loose litter left in the frame.",
      required: true,
      weight: 0.2,
      phase: "after",
    },
  ],
  assembly: [
    {
      id: "c1",
      label: "Item fully assembled, no leftover parts visible",
      howToVerify:
        "Look at the assembled item and its surroundings: it must match the finished form and no unused screws, panels or parts may be lying around.",
      required: true,
      weight: 0.4,
      phase: "after",
    },
    {
      id: "c2",
      label: "All shelves/panels present and aligned",
      howToVerify:
        "Count the visible shelves or panels: all are present, level and aligned with the frame.",
      required: true,
      weight: 0.3,
      phase: "after",
    },
    {
      id: "c3",
      label: "Item stands stable on a flat floor",
      howToVerify:
        "Look at the base and the floor line: the item sits level with no visible gap, tilt or propped-up corner.",
      required: false,
      weight: 0.15,
      phase: "after",
    },
    {
      id: "c4",
      label: "Packaging removed",
      howToVerify:
        "Look around the item: no cardboard, foam, plastic wrap or instruction sheets remain in the frame.",
      required: false,
      weight: 0.15,
      phase: "after",
    },
  ],
  delivery: [
    {
      id: "c1",
      label: "Parcel visible at the delivery door",
      howToVerify:
        "Look at the after photo: the parcel must be visible on the doorstep or in the doorway.",
      required: true,
      weight: 0.4,
      phase: "after",
    },
    {
      id: "c2",
      label: "Door/house number visible and legible",
      howToVerify:
        "Read the door or house number in the after photo: the digits must be legible and match the job's address.",
      required: true,
      weight: 0.4,
      phase: "after",
    },
    {
      id: "c3",
      label: "Parcel undamaged and not exposed to weather",
      howToVerify:
        "Look at the parcel: no visible dents, tears or wet patches, and it is placed out of direct rain or lying water.",
      required: false,
      weight: 0.2,
      phase: "after",
    },
  ],
  other: [
    {
      id: "c1",
      label: "The requested work result is clearly visible",
      howToVerify:
        "Look at the after photo: the result described in the job description is visible and looks complete.",
      required: true,
      weight: 0.5,
      phase: "after",
    },
    {
      id: "c2",
      label: "Work area is tidy",
      howToVerify:
        "Look around the work area: no tools, packaging or debris left behind.",
      required: false,
      weight: 0.3,
      phase: "after",
    },
    {
      id: "c3",
      label: "Before/after show the same place",
      howToVerify:
        "Compare fixed features in the before and after photos (walls, fixtures, floor): they must be the same location.",
      required: false,
      weight: 0.2,
      phase: "before_after",
    },
  ],
};

/**
 * Full criteria list for a category: the category template plus the system
 * liveness criterion (`cL`, label still carries the `{CODE}` placeholder).
 */
export function buildTemplateCriteria(category: JobCategory): Criterion[] {
  const items =
    CATEGORY_TEMPLATE_CRITERIA[category] ?? CATEGORY_TEMPLATE_CRITERIA.other;
  return [
    ...items.map((template) => ({
      ...template,
      source: "llm" as const,
    })),
    { ...LIVENESS_CRITERION_TEMPLATE, source: "system" as const },
  ];
}

/** Replace the `{CODE}` placeholder in the liveness criterion (T04, at AUTHORIZED). */
export function applyLivenessCode(
  criteria: Criterion[],
  livenessCode: string,
): Criterion[] {
  return criteria.map((criterion) =>
    criterion.id === "cL"
      ? { ...criterion, label: criterion.label.replace("{CODE}", livenessCode) }
      : criterion,
  );
}
