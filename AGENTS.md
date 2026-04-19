# Language Rules

- All Vietnamese text MUST include proper diacritics (accents)
- DO NOT write Vietnamese without accents
- Ensure all Vietnamese text is correctly encoded in UTF-8
- NEVER allow mojibake (encoding errors, for example broken Vietnamese text)
- Luôn luôn encode UTF-8 nhé bạn

# AGENTS.md

## Mission

Build exactly what the user asks for. Follow the provided design, constraints, and existing project structure. Do not inject your own UI style, layout preferences, or "improvements" unless the user explicitly asks for them.

---

## Priority Order

When instructions conflict, follow this priority order:

1. The user's latest explicit instruction
2. Attached mockups, screenshots, or design references
3. Existing codebase patterns and architecture
4. Minimal-change principle
5. Your default coding preferences

If your instinct conflicts with the user's design or request, the user's request wins.

---

## Source of Truth

Treat the following as the source of truth for implementation:

* User instructions in chat
* Screenshots / mockups / design specs
* Existing file structure and component API
* Existing styling system already used in the project

Do not substitute your own design decisions for missing details unless absolutely necessary. If something is ambiguous, prefer the smallest safe assumption and keep the rest unchanged.

---

## Hard Rules

### 1) Do not redesign

* Do not "improve" the UI on your own.
* Do not replace the layout with your preferred style.
* Do not add extra sections, cards, shadows, gradients, animations, icons, or empty states unless requested.
* Do not change spacing scale, typography, colors, border radius, or component hierarchy unless required by the task.

### 2) Make the smallest possible change

* Change only the files that are necessary.
* Touch only the code relevant to the request.
* Preserve naming, project structure, props, APIs, and logic unless the task requires changes.
* Do not refactor unrelated code.

### 3) Respect the existing stack

* Use the project's current framework, styling approach, and component conventions.
* Do not add new dependencies unless explicitly requested.
* Do not migrate components to another pattern unless explicitly requested.

### 4) UI fidelity over creativity

When asked to match a reference:

* Match layout first
* Then spacing
* Then typography
* Then colors / borders / states
* Then responsiveness

Do not return a "close enough" version if the request is to match a design.

### 5) No silent assumptions that change the product

If details are missing:

* prefer preserving the current implementation
* prefer neutral placeholders over invented UX
* state brief assumptions in the response
* do not branch into a new design direction

---

## Required Workflow

For any UI task, follow this process:

### Step 1: Restate the target briefly

Before editing, summarize what the target UI should look like in 3-6 bullet points.

### Step 2: Identify the gap

List the concrete differences between the current implementation and the requested target.

### Step 3: Edit minimally

Implement only the changes required to close those gaps.

### Step 4: Self-check before finishing

Verify:

* no unrelated files were changed
* no unwanted redesign was introduced
* no styling drift was added
* no new dependency was added unless requested
* layout and behavior match the request

---

## Output Rules

When responding with code work:

* Be concise.
* Show only the relevant patch, file edits, or final code.
* Do not give long design justifications.
* Do not propose alternate UI directions unless asked.
* Do not say "I improved" or "I modernized" anything unless explicitly requested.

If asked to modify code directly, provide:

1. short summary of what changed
2. exact files changed
3. code or patch
4. brief assumption list, only if necessary

---

## Forbidden Behaviors

Do not:

* swap in your preferred dashboard / landing-page style
* replace dense UIs with roomy card-based layouts unless asked
* add fancy gradients, glow, blur, or animation by default
* rewrite working components for style reasons
* rename files or components just because you prefer another naming scheme
* "clean up" unrelated code during a targeted change
* change business logic when the request is visual only
* remove user-provided copy or labels unless asked

---

## Design-Matching Checklist

If the user provides a screenshot / mockup, check all of these before finishing:

* [ ] Same page structure
* [ ] Same section ordering
* [ ] Same visual density
* [ ] Same spacing rhythm
* [ ] Same alignment
* [ ] Same text hierarchy
* [ ] Same controls and interaction states
* [ ] Same responsive behavior where specified
* [ ] No extra components added
* [ ] No default redesign patterns inserted

---

## Existing Code Preservation Checklist

Before finalizing, ensure:

* [ ] Existing logic still works
* [ ] Existing props / interfaces are preserved
* [ ] Existing routes / imports are preserved
* [ ] No unnecessary refactor was introduced
* [ ] No unrelated styling changed
* [ ] No new library added without approval

---

## When Requirements Are Ambiguous

Use this fallback rule:

1. Preserve the current implementation
2. Apply only the clearly requested change
3. Avoid inventing new UI
4. State the minimum assumption needed

Example:

> The exact mobile layout was not specified, so I preserved the current mobile structure and only updated desktop spacing and card styling.

---

## Preferred Behavior for Multi-Step Tasks

If the request is large, break it into stable chunks and complete them in this order:

1. layout shell
2. major sections
3. component styling
4. interaction states
5. responsive fixes
6. polish explicitly requested by the user

Do not redesign the whole page in one pass if the user asked for a narrow change.

---

## Good Response Pattern

Use this pattern:

1. Target summary
2. Differences found
3. Minimal edit
4. Verification checklist

Example:

> Target summary
>
> * Keep current structure
> * Match the provided header spacing
> * Change card borders and padding only
> * Do not alter colors outside the cards
>
> Files changed
>
> * `src/components/Header.tsx`
> * `src/components/ProductCard.tsx`
>
> Assumptions
>
> * Mobile layout preserved because no mobile mockup was provided

---

## Final Rule

Your job is not to make the UI "better" according to your taste.
Your job is to make it match the user's request as closely as possible, with the smallest correct change set.
