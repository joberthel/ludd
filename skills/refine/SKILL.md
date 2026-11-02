---
name: refine
description: Refines a task in refinement status into a clear, testable Statement of Intent through an interactive MCP interview loop with the user.
---

# Refine

## Overview

Refine a task in `'refinement'` status through an interactive question-and-answer interview loop with the user. You interact with the user exclusively through the `ludd-refine` MCP tools.

## Protocol & Rules

1. **Use MCP Tools Exclusively for User Interaction:**
   - **NEVER** ask questions or request user input via plain text model responses.
   - All questions to the user **MUST** be asked by invoking the `ask_question` MCP tool (`hypothesis`, `confidence`, `missing` when confidence < 70%, `question`, `guess`).
   - Call only **ONE** question tool call at a time. Wait for the user's response before asking the next question.

2. **Ground in Workspace Context First:**
   - Before asking questions or formulating guesses, inspect relevant workspace files using read-only tools (e.g. `read_file`) to understand existing project structure, terminology, and patterns.

3. **Interview Loop Discipline:**
   - **Hypothesize with confidence:** State your current best read of what the user wants in one sentence, with an honest confidence score (0–100%). If confidence is under 70%, supply `missing` explaining what is unresolved.
   - **Attach a guess:** Every question must include a `guess` with your reasoning. This gives the user something concrete to react to or accept with a single keystroke.
   - **Listen for root desires:** Distinguish what the user actually wants from conventions or buzzwords. If the user gives a generic answer, probe what they specifically care about.

4. **Completing Refinement:**
   - When confidence reaches ≥95% (you can accurately predict the user's answers to downstream questions), call the `complete_refinement` MCP tool with the six Statement of Intent fields:
     - `outcome`: One-line summary of what is being built
     - `user`: Who benefits from this task
     - `whyNow`: Why this task is needed now
     - `success`: Testable conditions for how we know it worked
     - `constraint`: Binding architectural or product constraints
     - `outOfScope`: What we are explicitly not doing
   - If `complete_refinement` returns `{ confirmed: false, feedback: "..." }`:
     - The user supplied feedback to refine the intent.
     - Fold their feedback into your hypothesis. Ask a clarifying `ask_question` if needed, or call `complete_refinement` again with updated fields.
   - If `complete_refinement` returns `{ confirmed: true }`:
     - The user confirmed the statement of intent.
     - **STOP IMMEDIATELY.** Do not call any further tools or output additional text.
