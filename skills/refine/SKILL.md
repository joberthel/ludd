---
name: refine
description: Refines a task in refinement status into a clear, testable Statement of Intent through an interactive MCP interview loop with the user.
---

# Refine

## Overview

Refine a task in `'refinement'` status through an interactive question-and-answer interview loop with the user. You interact with the user exclusively through the `ludd-refine` MCP tools.

## Protocol & Rules

1. **Call `get_initial_context` First:**
   - At the start of the refinement session, invoke the `get_initial_context` MCP tool to retrieve the user's initial description of what they want to build or refine.
   - Do NOT ask questions or call `complete_refinement` before obtaining this initial context.

2. **Ground in Workspace Context:**
   - After receiving the initial context, inspect relevant workspace files using read-only tools (e.g. `read_file`) to understand existing project structure, terminology, and patterns.

3. **Use MCP Tools Exclusively for User Interaction:**
   - **NEVER** ask questions or request user input via plain text model responses.
   - All questions to the user **MUST** be asked by invoking the `ask_question` MCP tool (`confidence`, `question`, `guess`).
   - Call only **ONE** question tool call at a time. Wait for the user's response before asking the next question.

4. **Interview Loop Discipline:**
   - **Attach a guess:** Every question must include a `guess` with your reasoning. This gives the user something concrete to react to or accept with a single keystroke.
   - **Confidence score:** Provide an honest confidence score (0–100%) indicating how close you are to understanding the complete requirements.
   - **Listen for root desires:** Distinguish what the user actually wants from conventions or buzzwords. If the user gives a generic answer, probe what they specifically care about.

5. **Completing Refinement:**
   - When confidence reaches ≥95% (you can accurately predict the user's answers to downstream questions), call the `complete_refinement` MCP tool with the six Statement of Intent fields:
     - `outcome`: One-line summary of what is being built
     - `user`: Who benefits from this task
     - `whyNow`: Why this task is needed now
     - `success`: Testable conditions for how we know it worked
     - `constraint`: Binding architectural or product constraints
     - `outOfScope`: What we are explicitly not doing
   - If `complete_refinement` returns `{ confirmed: false, feedback: "..." }`:
     - The user supplied feedback to refine the intent.
     - Fold their feedback into your understanding. Ask a clarifying `ask_question` if needed, or call `complete_refinement` again with updated fields.
   - If `complete_refinement` returns `{ confirmed: true }`:
     - The user confirmed the statement of intent.
     - **STOP IMMEDIATELY.** Do not call any further tools or output additional text.
