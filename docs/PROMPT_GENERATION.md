# Byler Co-Write Prompt Generation System

## Purpose

This document defines the planned prompt-generation system for the Byler co-writing app.

The app always generates writing prompts centered on **Mike Wheeler and Will Byers**. Prompt generation should support three levels of control:

1. **Simple mode** — one-click curated prompts from the existing flat JSON array.
2. **Intermediate mode** — guided customization using a small set of modular prompt components.
3. **Advanced mode** — a full scene-building engine with character objectives, compatibility rules, weighted randomness, and detailed scene constraints.

The goal is to build on the current generator without breaking or replacing it. Each mode should serve a different type of writing session rather than making the previous mode obsolete.

---

## Current Implementation

Simple prompt generation currently reads from JSON shaped like this:

```json
{
  "prompts": [
    "Mike finds the drawing Will made of the party — the one where the wizard looks a little too much like Mike. It's tucked in a book Will lent him. Neither of them mentions it, but the air changes.",
    "Snowball dance, alternate ending. Will doesn't run to the bathroom this time. He asks Mike to dance, and to his own shock, the words actually come out.",
    "It's the summer after Vecna. Will and Mike are the only two awake at 3 a.m. in the Byers' new house in California, sitting on the floor because neither can sleep."
  ]
}
```

This format must remain valid.

Do not require the existing curated prompts to be migrated into modular data before intermediate mode can be added.

---

# Mode Overview

| Mode | Best for | User control | Data source |
|---|---|---:|---|
| Simple | Starting immediately | None or minimal | Curated complete prompts |
| Intermediate | Guided variety | A few high-impact choices | Modular clauses plus templates |
| Advanced | Detailed scene design | Fine-grained controls | Structured scene-generation data |

The modes should be selectable from the prompt-generation interface.

---

# 1. Simple Prompt Generation

## Goal

Preserve the current lightweight experience:

- The user clicks **Generate prompt**.
- The app selects one complete prompt from `prompts`.
- The prompt is ready to use without additional decisions.
- The user can reroll for another prompt.

Simple mode should feel fast, curated, and low-pressure.

## Simple Mode Behavior

```ts
function generateSimplePrompt(prompts: string[]): string {
  return pickRandom(prompts);
}
```

Recommended improvements that do not change the data structure:

- Avoid returning the immediately previous prompt.
- Track a small recent-history list during the session.
- Allow users to favorite or save a generated prompt.
- Optionally expose the random seed in the generated result for shared sessions.
- Preserve exact punctuation and prose from the stored prompt.

## Simple Mode Non-Goals

Simple mode should not:

- Assemble prompt fragments.
- Ask the user to configure an era, location, or tension.
- Attempt to rewrite curated prompts.
- Apply advanced compatibility rules.
- Become dependent on the intermediate or advanced data pools.

---

# 2. Intermediate Prompt Generation

## Goal

Intermediate mode should sit between the existing one-click generator and the planned advanced scene engine.

It should give the user meaningful control without presenting a large form.

The core experience is:

1. The user selects or randomizes a few broad scene properties.
2. The generator selects compatible prompt components.
3. The components are assembled into a polished writing prompt.
4. The user can lock individual results and reroll the rest.

Intermediate mode should produce more variety than the curated simple pool while remaining easy to understand.

---

## Intermediate Mode Design Principles

### Keep the number of controls small

The initial intermediate interface should expose approximately five controls:

- **Time period**
- **Relationship context**
- **Tension intensity**
- **Tone**
- **Optional scenario category**

The generator should randomize these two central elements by default:

- **Location**
- **Tension point**

The user can reroll or lock either one after generation.

### Use complete clauses, not loose keywords

Avoid building prompts from isolated words such as:

```json
{
  "location": "basement",
  "tension": "jealousy",
  "tone": "angsty"
}
```

This would require a complicated natural-language renderer and would often produce repetitive or awkward prose.

Instead, store components as complete, reusable clauses:

```json
{
  "location": "Mike and Will are alone in the Wheeler basement after everyone else leaves.",
  "tension": "Mike has found a drawing Will never meant him to see.",
  "relationship": "Neither has admitted that their friendship has stopped feeling simple."
}
```

The renderer can then combine these clauses with light template logic.

### Constrain randomization without overengineering it

Intermediate mode needs basic compatibility filtering, but it should not yet become the full advanced rule engine.

Examples:

- A canon 1980s period should not select a college dorm unless the chosen period places them at college age.
- A California location should not be selected for a Hawkins-only canon period unless the location explicitly supports it.
- A tension marked `adultOnly` should not be available when the selected period treats Mike and Will as minors.
- A supernatural tension should be excluded when the user selects a fully mundane AU, unless the user enables supernatural elements.

---

## Recommended Intermediate Controls

### Time Period

Suggested initial options:

- Random
- 1980s canon
- Post-Vecna
- High school graduation
- Early 1990s
- Adult post-canon
- Modern AU
- College AU

Each period should define broad compatibility tags and an age category.

```ts
type CharacterAgeGroup = "minor" | "adult";

interface TimePeriodOption {
  id: string;
  label: string;
  text: string;
  ageGroup: CharacterAgeGroup;
  tags: string[];
  weight?: number;
}
```

Example:

```json
{
  "id": "post-vecna",
  "label": "Post-Vecna",
  "text": "Set this in the uneasy months after the fight with Vecna.",
  "ageGroup": "minor",
  "tags": ["canon", "hawkins", "post-season-4", "supernatural"]
}
```

### Relationship Context

Suggested options:

- Random
- Best friends with unspoken feelings
- One has realized his feelings
- Both know but neither has confessed
- Recently confessed
- Secretly dating
- Established relationship
- Estranged and reunited
- Adult exes or former almost-somethings

```ts
interface RelationshipOption {
  id: string;
  label: string;
  text: string;
  tags: string[];
  compatibleAgeGroups?: CharacterAgeGroup[];
  weight?: number;
}
```

### Tension Intensity

Use a simple three-level control:

- Low
- Medium
- High

A tension point can contain different text for each intensity.

```ts
type TensionIntensity = "low" | "medium" | "high";

interface IntermediateTension {
  id: string;
  label: string;
  category: string;
  variants: Record<TensionIntensity, string>;
  tags: string[];
  compatiblePeriods?: string[];
  incompatibleTags?: string[];
  adultOnly?: boolean;
  weight?: number;
}
```

Example:

```json
{
  "id": "hidden-drawing",
  "label": "A hidden drawing is discovered",
  "category": "secret",
  "variants": {
    "low": "Mike notices that Will has been sketching him and tries not to make a big deal out of it.",
    "medium": "Mike finds a drawing Will never meant him to see, and Will realizes immediately what he is holding.",
    "high": "Mike finds an entire sketchbook full of drawings of him, including pages that make Will's feelings impossible to dismiss."
  },
  "tags": ["canon-friendly", "secret", "art", "emotional"],
  "weight": 4
}
```

### Tone

Suggested initial options:

- Random
- Tender
- Awkward
- Nostalgic
- Angsty
- Playful
- Suspenseful
- Bittersweet
- Chaotic

Tone should generally become a final writing instruction rather than changing every component.

```json
{
  "id": "nostalgic",
  "label": "Nostalgic",
  "text": "Keep the scene nostalgic, intimate, and aware of how much history exists between them.",
  "tags": ["quiet", "emotional"]
}
```

### Scenario Category

This control can remain optional in the first implementation.

Possible categories:

- Canon divergence
- Quiet conversation
- Forced proximity
- Party or group scene
- Road trip
- Domestic
- Supernatural
- Reunion
- Confession
- Misunderstanding
- Jealousy
- Secret discovered

When set to `Random`, it should not constrain the result.

---

## Randomized Intermediate Components

### Location

Locations should describe the actual scene setup, not only name a place.

```ts
interface IntermediateLocation {
  id: string;
  label: string;
  text: string;
  category: string;
  privacy: "public" | "semi-private" | "private" | "isolated";
  tags: string[];
  compatiblePeriods?: string[];
  incompatibleTags?: string[];
  weight?: number;
}
```

Example:

```json
{
  "id": "wheeler-basement-after-campaign",
  "label": "Wheeler basement",
  "text": "Mike and Will are alone in the Wheeler basement after everyone else leaves an unfinished campaign behind.",
  "category": "home",
  "privacy": "semi-private",
  "tags": ["hawkins", "canon-friendly", "nostalgic", "campaign"],
  "compatiblePeriods": ["1980s-canon", "post-vecna", "early-1990s"],
  "weight": 5
}
```

Other useful locations:

- Castle Byers during rain
- The Byers kitchen at 3 a.m.
- Mike's bedroom during a sleepover
- An empty Hawkins High gym
- The back room of a record store
- A stalled car on a rural road
- A motel room during a road trip
- A college dorm hallway
- A tiny shared apartment
- A party reunion years later
- A hospital waiting room
- A quiet spot outside a graduation party
- A van during a long drive
- A cabin during a storm
- A supernatural version of a familiar Hawkins location

### Tension Point

The tension point is the central unresolved pressure in the prompt.

Suggested categories:

- Secret
- Jealousy
- Miscommunication
- Abandonment
- Confession
- Forced proximity
- Shared memory
- Hurt and comfort
- Supernatural danger
- Interrupted intimacy
- Future plans
- Resentment
- Protectiveness
- Identity and self-realization

Intermediate tensions should define the scene problem, but they do not need the advanced mode's separate source, trigger, escalation, and pressure fields.

### Optional Catalyst

A catalyst creates movement after the initial setup.

Examples:

- The power goes out.
- Someone finds a letter.
- A song begins playing.
- The door locks.
- One of them learns the other planned to leave.
- The walkie-talkie crackles to life.
- Someone else assumes they are dating.
- A familiar supernatural sensation returns.
- One of them says something that cannot be passed off as a joke.

Catalysts can be added in the second intermediate iteration rather than the first MVP.

---

# Intermediate JSON Structure

The existing root-level `prompts` array should remain intact.

Add intermediate data beside it:

```json
{
  "prompts": [
    "Existing complete curated prompt one.",
    "Existing complete curated prompt two."
  ],
  "intermediate": {
    "timePeriods": [],
    "relationshipContexts": [],
    "tones": [],
    "locations": [],
    "tensions": [],
    "catalysts": [],
    "templates": []
  }
}
```

A fuller example:

```json
{
  "prompts": [
    "Mike finds the drawing Will made of the party — the one where the wizard looks a little too much like Mike. It's tucked in a book Will lent him. Neither of them mentions it, but the air changes."
  ],
  "intermediate": {
    "timePeriods": [
      {
        "id": "post-vecna",
        "label": "Post-Vecna",
        "text": "Set this in the uneasy months after the fight with Vecna.",
        "ageGroup": "minor",
        "tags": ["canon", "hawkins", "post-season-4", "supernatural"],
        "weight": 4
      },
      {
        "id": "adult-post-canon",
        "label": "Adult post-canon",
        "text": "Mike and Will are now adults, carrying years of unfinished history with them.",
        "ageGroup": "adult",
        "tags": ["adult", "post-canon", "reunion"],
        "weight": 3
      }
    ],
    "relationshipContexts": [
      {
        "id": "mutual-unspoken",
        "label": "Mutual but unspoken",
        "text": "Both of them know their friendship is no longer simple, but neither has said it aloud.",
        "tags": ["mutual-feelings", "unspoken"],
        "compatibleAgeGroups": ["minor", "adult"],
        "weight": 5
      },
      {
        "id": "estranged-reunion",
        "label": "Estranged reunion",
        "text": "They have not been close in years, and every old feeling returns faster than either expected.",
        "tags": ["reunion", "estranged", "adult"],
        "compatibleAgeGroups": ["adult"],
        "weight": 2
      }
    ],
    "tones": [
      {
        "id": "nostalgic",
        "label": "Nostalgic",
        "text": "Keep the scene nostalgic, intimate, and aware of how much history exists between them.",
        "tags": ["quiet", "emotional"],
        "weight": 4
      }
    ],
    "locations": [
      {
        "id": "wheeler-basement-after-campaign",
        "label": "Wheeler basement",
        "text": "Mike and Will are alone in the Wheeler basement after everyone else leaves an unfinished campaign behind.",
        "category": "home",
        "privacy": "semi-private",
        "tags": ["hawkins", "canon-friendly", "nostalgic", "campaign"],
        "compatiblePeriods": ["post-vecna"],
        "weight": 5
      },
      {
        "id": "adult-reunion-party",
        "label": "Party reunion",
        "text": "Mike and Will find themselves alone on the back porch during a party reunion years after they last saw each other.",
        "category": "reunion",
        "privacy": "semi-private",
        "tags": ["adult", "reunion", "post-canon"],
        "compatiblePeriods": ["adult-post-canon"],
        "weight": 3
      }
    ],
    "tensions": [
      {
        "id": "hidden-drawing",
        "label": "A hidden drawing is discovered",
        "category": "secret",
        "variants": {
          "low": "Mike notices that Will has been sketching him and tries not to make a big deal out of it.",
          "medium": "Mike finds a drawing Will never meant him to see, and Will realizes immediately what he is holding.",
          "high": "Mike finds an entire sketchbook full of drawings of him, including pages that make Will's feelings impossible to dismiss."
        },
        "tags": ["canon-friendly", "secret", "art", "emotional"],
        "weight": 4
      },
      {
        "id": "future-separation",
        "label": "One of them may leave",
        "category": "abandonment",
        "variants": {
          "low": "A casual conversation about future plans reveals that they have been imagining very different lives.",
          "medium": "Mike learns that Will is considering leaving without telling him.",
          "high": "Will has already accepted an opportunity far away, and Mike discovers that everyone else knew first."
        },
        "tags": ["future", "separation", "angst"],
        "weight": 4
      }
    ],
    "catalysts": [
      {
        "id": "power-outage",
        "label": "Power outage",
        "text": "Before either can escape the conversation, the power goes out.",
        "tags": ["storm", "forced-proximity", "canon-friendly"],
        "weight": 3
      }
    ],
    "templates": [
      {
        "id": "standard-five-part",
        "parts": [
          "timePeriod",
          "location",
          "relationshipContext",
          "tension",
          "tone"
        ],
        "weight": 5
      },
      {
        "id": "with-catalyst",
        "parts": [
          "timePeriod",
          "location",
          "relationshipContext",
          "tension",
          "catalyst",
          "tone"
        ],
        "weight": 3
      }
    ]
  }
}
```

---

# Intermediate Generation Flow

## Input

```ts
interface IntermediatePromptOptions {
  timePeriodId?: string | "random";
  relationshipContextId?: string | "random";
  toneId?: string | "random";
  scenarioCategory?: string | "random";
  tensionIntensity: TensionIntensity;
  includeCatalyst?: boolean;
  locked?: {
    timePeriodId?: string;
    relationshipContextId?: string;
    toneId?: string;
    locationId?: string;
    tensionId?: string;
    catalystId?: string;
  };
  seed?: string;
}
```

## Output

Return both the rendered prompt and the selected component IDs.

```ts
interface GeneratedIntermediatePrompt {
  mode: "intermediate";
  prompt: string;
  seed: string;
  selections: {
    timePeriodId: string;
    relationshipContextId: string;
    toneId: string;
    locationId: string;
    tensionId: string;
    catalystId?: string;
  };
}
```

Returning the component IDs is important because the UI needs to:

- Display the selected attributes as chips.
- Lock individual values.
- Reroll only unlocked values.
- Rebuild the same prompt from a shared seed.
- Save a generated prompt with its source data.
- Avoid parsing the rendered prose later.

---

## Generation Algorithm

```ts
function generateIntermediatePrompt(
  data: IntermediatePromptData,
  options: IntermediatePromptOptions
): GeneratedIntermediatePrompt {
  const rng = createSeededRandom(options.seed);

  const timePeriod = resolveSelectedOrRandom(
    data.timePeriods,
    options.locked?.timePeriodId ?? options.timePeriodId,
    rng
  );

  const relationshipContext = resolveCompatibleRelationship(
    data.relationshipContexts,
    options.locked?.relationshipContextId ?? options.relationshipContextId,
    timePeriod,
    rng
  );

  const location = resolveCompatibleLocation(
    data.locations,
    options.locked?.locationId,
    {
      timePeriod,
      relationshipContext,
      scenarioCategory: options.scenarioCategory
    },
    rng
  );

  const tension = resolveCompatibleTension(
    data.tensions,
    options.locked?.tensionId,
    {
      timePeriod,
      relationshipContext,
      location,
      scenarioCategory: options.scenarioCategory
    },
    rng
  );

  const tone = resolveSelectedOrRandom(
    data.tones,
    options.locked?.toneId ?? options.toneId,
    rng
  );

  const catalyst = options.includeCatalyst
    ? resolveCompatibleCatalyst(
        data.catalysts,
        options.locked?.catalystId,
        { timePeriod, location, tension },
        rng
      )
    : undefined;

  return renderIntermediatePrompt({
    timePeriod,
    relationshipContext,
    location,
    tension,
    tone,
    catalyst,
    intensity: options.tensionIntensity
  });
}
```

---

## Rendering

Prefer predictable clause assembly over AI generation.

```ts
function renderIntermediatePrompt(
  selections: IntermediateSelections
): GeneratedIntermediatePrompt {
  const parts = [
    selections.timePeriod.text,
    selections.location.text,
    selections.relationshipContext.text,
    selections.tension.variants[selections.intensity],
    selections.catalyst?.text,
    selections.tone.text
  ].filter(Boolean);

  return {
    mode: "intermediate",
    prompt: parts.join(" "),
    seed: selections.seed,
    selections: {
      timePeriodId: selections.timePeriod.id,
      relationshipContextId: selections.relationshipContext.id,
      toneId: selections.tone.id,
      locationId: selections.location.id,
      tensionId: selections.tension.id,
      catalystId: selections.catalyst?.id
    }
  };
}
```

The first version does not need a generative model to rewrite the result. Carefully written clauses should produce consistent results without latency, cost, or unpredictable output.

A later enhancement may add an optional prose-polishing pass, but the structured prompt should remain the source of truth.

---

# Intermediate UI

## Initial Controls

Recommended layout:

```text
Time period:          [Random             ▼]
Relationship:         [Random             ▼]
Tension intensity:    [Low | Medium | High]
Tone:                 [Random             ▼]
Scenario category:    [Random             ▼]

[Generate prompt]
```

After generation:

```text
[🔒 Post-Vecna]
[🔒 Wheeler basement]
[↻ Hidden drawing]
[↻ Mutual but unspoken]
[↻ Nostalgic]

[Generate with unlocked options]
```

Each generated component should support:

- Lock
- Unlock
- Reroll only this component
- Display a readable label
- Preserve the component ID internally

Recommended actions:

- **Generate prompt**
- **Reroll unlocked**
- **Surprise me**
- **Save prompt**
- **Start co-write**
- **Switch to simple**
- **Open advanced mode**

---

# Intermediate Compatibility Rules

Start with simple tag filtering.

```ts
function isCompatible(
  item: CompatiblePromptItem,
  context: GenerationContext
): boolean {
  if (
    item.compatiblePeriods?.length &&
    !item.compatiblePeriods.includes(context.timePeriod.id)
  ) {
    return false;
  }

  if (
    item.compatibleAgeGroups?.length &&
    !item.compatibleAgeGroups.includes(context.timePeriod.ageGroup)
  ) {
    return false;
  }

  if (item.adultOnly && context.timePeriod.ageGroup !== "adult") {
    return false;
  }

  if (
    item.incompatibleTags?.some(tag =>
      context.activeTags.has(tag)
    )
  ) {
    return false;
  }

  return true;
}
```

Avoid introducing a complex expression language in intermediate mode.

The advanced mode can later support richer rules such as conditional weighting, transformations, and multi-field exclusions.

---

# Weighted Randomness

Each item may define an optional weight.

```ts
interface WeightedItem {
  weight?: number;
}
```

Default weight:

```ts
const DEFAULT_WEIGHT = 1;
```

Higher-weight options appear more often but should not become guaranteed.

Use weighted selection after compatibility filtering.

Also maintain a short history of recently selected component IDs and temporarily reduce their effective weights. This prevents repeated combinations during the same co-writing session.

Suggested recent-history behavior:

- Remember the last 5 generated prompts.
- Avoid returning the exact same location-and-tension combination.
- Reduce the weight of a component each time it appears in recent history.
- Clear history when the user explicitly resets the generator.

---

# Safety and Age-Aware Content Rules

Time periods should explicitly determine whether Mike and Will are treated as minors or adults.

```ts
ageGroup: "minor" | "adult"
```

Rules:

- Any component marked `adultOnly` must be excluded from minor periods.
- Rating or content controls must never allow explicit sexual scenarios for minor versions of the characters.
- Adult relationship scenarios should require a period explicitly marked `adult`.
- Saved or shared prompts should preserve the selected time period and age group.
- Do not infer adult status merely from a location such as a motel, apartment, or college. Use the selected period's `ageGroup`.

These rules should exist in generation logic, not only in the UI.

---

# 3. Advanced Prompt Generation

Advanced mode is the future full scene-building system.

It should build on the same component IDs and tags where practical, but it may use richer records and additional data pools.

## Advanced Fields

Suggested scene seed:

```ts
interface AdvancedPromptSeed {
  continuity: string;
  timePeriod: string;
  ageGroup: CharacterAgeGroup;

  relationshipState: string;
  mutualAwareness: string;

  location: string;
  sublocation: string;
  timeOfDay: string;
  weather: string;
  privacyLevel: string;

  activity: string;
  mikeObjective: string;
  willObjective: string;

  primaryTension: AdvancedTensionPoint;
  secondaryTension?: AdvancedTensionPoint;
  catalyst: string;
  stakes: string;

  tone: string;
  intensity: number;
  pov: string;

  motif?: string;
  endingType: string;
  rating: string;
}
```

## Advanced Tension Model

```ts
interface AdvancedTensionPoint {
  id: string;
  category: string;
  source: string;
  trigger: string;
  escalation: string;
  pressure: string;
  intensity: number;

  compatibleRelationshipStates?: string[];
  compatibleLocations?: string[];
  excludedTags?: string[];
}
```

Advanced mode may add:

- Separate objectives for Mike and Will
- Primary and secondary tension
- Stakes
- Catalyst
- Time of day
- Weather
- Privacy level
- Activity
- Point of view
- Ending instruction
- Motifs
- Canon fidelity
- Supernatural intensity
- Dialogue-to-action preference
- Private information for each co-writer
- A full compatibility validator
- Conditional weight changes
- Rule-based transformations
- Detailed prompt cards

Do not require these advanced fields for the intermediate MVP.

---

# Shared Architecture

## Suggested Type Structure

```ts
interface PromptGenerationData {
  prompts: string[];
  intermediate?: IntermediatePromptData;
  advanced?: AdvancedPromptData;
}

interface IntermediatePromptData {
  timePeriods: TimePeriodOption[];
  relationshipContexts: RelationshipOption[];
  tones: ToneOption[];
  locations: IntermediateLocation[];
  tensions: IntermediateTension[];
  catalysts: CatalystOption[];
  templates: IntermediateTemplate[];
}
```

## Suggested Generator API

```ts
type PromptMode = "simple" | "intermediate" | "advanced";

function generatePrompt(
  mode: PromptMode,
  data: PromptGenerationData,
  options?: PromptGenerationOptions
): GeneratedPrompt {
  switch (mode) {
    case "simple":
      return generateSimplePromptResult(data.prompts);

    case "intermediate":
      if (!data.intermediate) {
        throw new Error("Intermediate prompt data is unavailable.");
      }

      return generateIntermediatePrompt(
        data.intermediate,
        options as IntermediatePromptOptions
      );

    case "advanced":
      if (!data.advanced) {
        throw new Error("Advanced prompt data is unavailable.");
      }

      return generateAdvancedPrompt(
        data.advanced,
        options as AdvancedPromptOptions
      );
  }
}
```

---

# Migration Plan

## Phase 1: Preserve and clean up simple mode

- Keep the existing `prompts` array.
- Move simple-mode random selection into a dedicated generator function.
- Add recent-prompt avoidance.
- Return a structured result object even when the content is still a simple string.

Example:

```ts
interface GeneratedSimplePrompt {
  mode: "simple";
  prompt: string;
  sourceIndex: number;
}
```

## Phase 2: Add intermediate data

- Add the `intermediate` object beside `prompts`.
- Create TypeScript interfaces.
- Add a schema validation step during app startup or development.
- Build compatible weighted selection helpers.
- Build clause rendering.
- Add intermediate UI controls.
- Add lock and reroll behavior.

## Phase 3: Expand the intermediate library

Begin with a modest data set:

- 8 time periods
- 8 relationship contexts
- 10 tones
- 20 locations
- 25 tension points
- 10 catalysts
- 2 to 4 templates

The number of possible combinations will already be much larger than the original curated pool.

## Phase 4: Add advanced mode

- Reuse IDs and tags from intermediate data where appropriate.
- Introduce character objectives, stakes, and richer tension records.
- Add advanced validation and transformation rules.
- Add detailed prompt cards and optional private role information.

---

# Data Authoring Guidelines

## Every component should:

- Be understandable without seeing its ID.
- Mention Mike and Will where necessary.
- Be written as a complete sentence or clause.
- Avoid relying on another component to repair its grammar.
- Use consistent tense.
- Avoid locking the scene into a single ending unless it is an ending instruction.
- Carry tags that describe compatibility, not every possible theme.
- Define a stable unique ID.
- Include a weight only when a non-default frequency is intentional.

## Avoid:

- Single-word prose fragments.
- Duplicate components with slightly different wording.
- Components that secretly assume an era not represented in their tags.
- Components that imply adult status without an adult period.
- Tensions that solve themselves in the same sentence.
- Tone text that contradicts the selected intensity.
- Overly detailed prompts that leave co-writers no room to invent.

---

# Example Intermediate Results

## Example 1

Selections:

```json
{
  "timePeriodId": "post-vecna",
  "relationshipContextId": "mutual-unspoken",
  "locationId": "wheeler-basement-after-campaign",
  "tensionId": "hidden-drawing",
  "toneId": "nostalgic",
  "tensionIntensity": "medium"
}
```

Rendered prompt:

> Set this in the uneasy months after the fight with Vecna. Mike and Will are alone in the Wheeler basement after everyone else leaves an unfinished campaign behind. Both of them know their friendship is no longer simple, but neither has said it aloud. Mike finds a drawing Will never meant him to see, and Will realizes immediately what he is holding. Keep the scene nostalgic, intimate, and aware of how much history exists between them.

## Example 2

Selections:

```json
{
  "timePeriodId": "adult-post-canon",
  "relationshipContextId": "estranged-reunion",
  "locationId": "adult-reunion-party",
  "tensionId": "future-separation",
  "toneId": "bittersweet",
  "tensionIntensity": "high"
}
```

Rendered prompt:

> Mike and Will are now adults, carrying years of unfinished history with them. They find themselves alone on the back porch during a party reunion years after they last saw each other. They have not been close in years, and every old feeling returns faster than either expected. Will has already accepted an opportunity far away, and Mike discovers that everyone else knew first. Keep the scene bittersweet, restrained, and unresolved until one of them finally says what the separation would actually cost.

---

# Testing Requirements

## Simple Mode

- Returns a prompt from the existing array.
- Does not mutate prompt text.
- Avoids the immediately previous prompt when more than one prompt exists.
- Handles an empty array with a readable error state.

## Intermediate Mode

- Honors explicitly selected controls.
- Honors locked component IDs.
- Randomizes unlocked components.
- Never selects an incompatible period and location.
- Never selects adult-only data for a minor period.
- Uses the selected tension intensity variant.
- Produces deterministic results when given the same seed and options.
- Avoids identical recent combinations when alternatives exist.
- Returns all selected component IDs.
- Handles missing optional catalysts.
- Fails gracefully when filtering produces no compatible options.

## Data Validation

Validate:

- Unique IDs within each collection.
- Required text fields.
- All referenced period IDs exist.
- All tension records contain low, medium, and high variants.
- Weights are positive numbers.
- Template part names are recognized.
- Adult-only flags are respected.
- No empty component pools are shipped for an enabled mode.

---

# Acceptance Criteria for Intermediate MVP

Intermediate mode is complete when:

1. The existing simple prompt generator still works without data migration.
2. The user can select a time period, relationship context, tone, and tension intensity.
3. Location and tension are randomized from compatible pools.
4. Generated components appear as lockable chips.
5. The user can reroll one component or all unlocked components.
6. The generator returns a polished multi-sentence prompt.
7. The result includes stable component IDs and a seed.
8. The same seed and selections recreate the same prompt.
9. Recent duplicate combinations are reduced.
10. Minor and adult periods are kept logically and safely distinct.
11. Unit tests cover selection, compatibility, locking, rendering, and deterministic randomness.

---

# Implementation Priority

Build in this order:

1. Preserve the current simple generator.
2. Introduce shared generated-result types.
3. Add intermediate TypeScript interfaces.
4. Add a small intermediate JSON sample.
5. Implement seeded weighted selection.
6. Implement compatibility filtering.
7. Implement clause rendering.
8. Build the intermediate controls.
9. Add lock and reroll behavior.
10. Add tests.
11. Expand the content library.
12. Begin advanced-mode architecture only after intermediate mode is stable.

The intermediate generator should remain intentionally smaller than the advanced scene engine. Its purpose is to provide guided variety, not exhaustive scene control.
