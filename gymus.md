Personal Gym Tracking PWA (iOS)



\## Mission



Build a fully offline-capable Progressive Web App for personal gym session tracking. It runs on a single iOS device, added to the home screen via Safari. There is no server, no backend, no authentication, no user accounts, no membership layer, and no deployment pipeline. All data lives in the browser. Keep the architecture as flat and direct as possible — avoid unnecessary abstraction layers, utility wrappers, or boilerplate patterns not directly required by the feature set.



\-----



\## Tech Stack



|Layer       |Choice                               |Reason                                 |

|------------|-------------------------------------|---------------------------------------|

|UI Framework|\*\*Vue 3\*\* (CDN, no build step)       |Reactive, lightweight, zero-config     |

|Styling     |\*\*Tailwind CSS\*\* (CDN Play CDN)      |Utility-first, quick to iterate        |

|Database    |\*\*Dexie.js\*\* (CDN)                   |Clean promise-based IndexedDB API      |

|Charts      |\*\*Chart.js\*\* (CDN)                   |Simple, touch-friendly, well-documented|

|PWA         |`manifest.json` + `service-worker.js`|Standard PWA, no library needed        |

|Entry point |Single index.html                    |No bundler required                    |



All dependencies loaded via CDN (jsDelivr or cdnjs). No npm, no build step, no node\_modules. The app must work by simply opening index.html in Safari on iOS.



\-----



\## Design System



The design must feel soft, focused, and calming — optimised for use mid-workout with sweaty hands.



\- Palette: Warm off-white background (`#FAF9F6`). Muted sage or dusty warm tones for accents. No harsh blacks — use #2C2A27 for primary text. Avoid pure white and pure black.

\- Typography: Minimum 16px body. Exercise names and primary actions: 22–28px. Step-by-step input cards (weight, reps, RPE): 32px+ for the number/value being entered.

\- Touch targets: All interactive elements minimum 52px height. Buttons full-width in their container where possible.

\- Spacing: Generous padding — never crowded. Cards with 1.5rem internal padding.

\- Transitions: Subtle fade or slide (≤`200ms`). Nothing jarring.

\- Focus principle: At any given moment, only one thing demands the user’s attention. One exercise, one prompt, one number.

\- iOS specifics:

&#x20; - <meta name="apple-mobile-web-app-capable" content="yes">

&#x20; - <meta name="apple-mobile-web-app-status-bar-style" content="default">

&#x20; - Respect env(safe-area-inset-\*) on all edges

&#x20; - Prevent rubber-band scroll on the root, allow it inside scrollable lists

&#x20; - font-size: 16px on all inputs to prevent iOS auto-zoom



\-----



\## Data Models (Dexie.js — IndexedDB)



Call navigator.storage.persist() on app startup. If denied, show a one-time soft notice. Do not nag.



\### Store: programs

{

&#x20; id: Number (auto),

&#x20; name: String,

&#x20; sessionCount: Number,

&#x20; createdAt: Date

}



\### Store: sessionTemplates

{

&#x20; id: Number (auto),

&#x20; programId: Number,

&#x20; sessionIndex: Number,        // 0-based position in cycle

&#x20; name: String,                // e.g. "Session A", "Push", etc.

&#x20; exercises: \[

&#x20;   {

&#x20;     id: String (uuid v4),

&#x20;     name: String,

&#x20;     type: 'warmup' | 'main' | 'cooldown',

&#x20;     order: Number,           // if warmup is not skipped, it has the first order; if cooldown is not skipped, it has the last order

&#x20;     defaultSets: Number      // only relevant for 'main'; warmup/cooldown = null

&#x20;   }

&#x20; ]

}



\### Store: sessionLogs

{

&#x20; id: Number (auto),

&#x20; templateId: Number,

&#x20; cycleNumber: Number,

&#x20; sessionIndex: Number,

&#x20; startedAt: Date, (with hour and minute)

&#x20; endedAt: Date, (with hour and minute)

&#x20; totalDuration: Number, (minute)

&#x20; skipped: Boolean, (default: false)

&#x20; evaluation: {

&#x20;   // Physical Metrics

&#x20;   energyLevel: number;           // 0-10scale

&#x20;   oversllMuscleSoreness: number;        // 0-10 scale

&#x20;   jointComfort: number;          // 0-10 scale

&#x20;   bodyRecovery: boolean;     // 0-10 scale

&#x20;   sleepTime: number;           // 0-24h

&#x20;   preWorkoutNutrition: number;       // 0-10 scale



&#x20;   // Mental Metrics

&#x20;   mentalFocus: number;           // 0-10 scale

&#x20;   overallSessionRpe: number;     // 0-10 scale

sessionEnjoyment: number;      // 0-10 scale

&#x20;   preWorkoutStress: number;      // 0-10 scale

&#x20;   sleepQuality: number;          // 0-10 scale



&#x20;   notes: String

&#x20; },

&#x20; exerciseLogs: \[

&#x20;   {

&#x20;     exerciseId: String,      // uuid matching template

&#x20;     exerciseName: String,

&#x20;     type: 'warmup' | 'main' | 'cooldown',   

&#x20;     performedOrder: Number,  // actual order this exercise was done   // if warmup is not skipped, it has the first order; if cooldown is not skipped, it has the last order

&#x20;     duration: Number,      // total time on this exercise

&#x20;     note: String,            // sticky note captured at session time

&#x20;     sets: \[

&#x20;       {

&#x20;         setNumber: Number,

&#x20;         skipped: Boolean, (default: false)

&#x20;         weight: Number | null,

&#x20;         reps: Number | null, (can be also decimal)

&#x20;         rpe: Number | null, (can be also decimal)

&#x20;         setDurationMs: Number,

&#x20;         restDurationMs: Number

&#x20;       }

&#x20;     ]

&#x20;   }

&#x20; ]

}



\### Store: appState

{

&#x20; id: 1,                       // singleton row

&#x20; activeProgramId: Number | null,

&#x20; currentCycleNumber: Number,

&#x20; currentSessionIndex: Number,

&#x20; activeSessionLog: Object | null  // in-progress session, saved incrementally

}



Save activeSessionLog to this store after every completed set. This ensures data is not lost if the app is backgrounded or crashed mid-session.



\-----



\## App Structure



Avoid a traditional bottom navigation bar. Use a context-driven navigation; keep the Session screen as the main interface. Place Setup and Analytics inside a minimal top-header menu to maximize vertical space for the workout session. Easily retrieve suitable icons from the library. 



\[ Session ]

\-> \[ Setup ]

\-> \[ Analytics ]



\-----



\## Tab 1 — Setup



Used infrequently.  Accessible from the \[ Session ]



\### Sub-sections within Setup:



A. Configure Training Cycle



If a program is exist, this tab should be invisible (not transparent). Only, if the program is deleted or not exist, this section will become visible.

If not, follow these steps in order, but they must be isolated from each other. For example, the question "How many sessions will there be?" and the input field. Then, with a smooth transition, the question for step 2 will follow. Absolutely, all questions should not be in a single form. Even the session names should be taken separately:



&#x20;  1. Ask: “How many sessions are in your training cycle?” → A selection should be made on a number bar, with a default value of 3. This means that as you scroll left or right, you can select values ​​between 1 and 30. Instead of a bar, create an input element where the numbers are scrolled and the central number is selected. -> Confirm



&#x20;  2. For each session (1 to N), show a card and ask seperatly:

&#x20;  - Session name field (placeholder: “session name”, etc.) (cannot be null)

&#x20;  - Exercise list for this session (starts empty) (cannot be null)

&#x20;  - “Add exercise” button → opens an inline form (not a modal):

&#x20;    - Exercise name (text)

&#x20;    - Default sets (number, only shown if type = Main)

&#x20;    - “Add” / “Cancel”

&#x20;  - Each exercise row shows its name, type badge, and optional set count; tap to edit, swipe or long-press to delete.

&#x20;  - “Next session →” / “← Previous” navigation

&#x20;  

&#x20;  3. Final screen: summary of all sessions. Button: “Save programme”. This writes to programs and sessionTemplates.



B. Edit Existing Programme



If a program is not exist, this tab should be invisible (not transparent). Only, if the program is exist, this section will become visible.

If a programme already exists, the Setup tab shows:



\- Programme overview: session count, list of sessions

\- Tap any session to enter the same exercise-editing flow as above

\- “Delete session”, “Add session”, “Reorder sessions” (drag handle)

\- Tap any exercise to edit name, type, default sets

\- Warning: editing does not retroactively alter logs. Show a note to this effect.



C. Import / Export (sub-tab or section within Setup)



Two large buttons:



\- Export JSON: serialises everything from all Dexie stores into a single JSON object → triggers a file download as training-backup-YYYY-MM-DD.json

\- Import JSON: file input (`.json`). Validate structure. (no merging)

\-----



\## Tab 2 — Session



This is the primary tab. It is shown first on app open.

If no program exists: show a single masculine, ironic and short welcome card. Button: “Configure training”. Navigate to “Configure Traning Cycle” in Setup section.



\### 2.1 — Pre-session screen



Displayed when no session is currently active.



\- Large card:

&#x20; - “Next up: \[Session Name]” (e.g. “Session B — Push”)

&#x20; - “Cycle \[N]”

&#x20; - Date (DD-MM) of the last time this specific session was performed (or “First time” if cycle 1)

\- Button: “Let's do it!” (large, prominent)

\- Button: “Skip ” (smaller, muted) → increments currentSessionIndex without creating a log; wraps around cycle as usual



Cycle logic:



\- currentSessionIndex runs from 0 to sessionCount - 1

\- After completing session at index N-1, set currentSessionIndex = 0 and increment currentCycleNumber

\- “Previous data” for an exercise in the current session = the most recent sessionLog where templateId matches the current session template and the exercise’s exerciseId appears in exerciseLogs

\- Skip does NOT create a log; it only advances the pointer



\### 2.2 — Active session



When “Start session” is pressed:



\- Create a new sessionLog record in appState.activeSessionLog with startedAt = now

\- Start the global session stopwatch



Layout — single panel, one exercise at a time:

Three appearances:

1\. in break or at start

┌──────────────────────────────────────┐

│ \[Global stopwatch]   \[Break timer] \[prev. session's exact set's break time (pale colored)]	|

│                                      │   

│  EXERCISE NAME  ↓ (tappable - exercise selection via dropdown menu if tapped.)         │

│                                      │

│ next set number of  Previous session's exact set data (if available):   (Indicate the current set number on the horizontal numbers.)           │

│  Set m: 8 reps × 80kg      │

│  RPE 7                     │

│                                      │

│  ┌────────────────────────────────┐  │

│  │ Note from previous session's exact exercise    │  │

│  │ "Focus on depth bottom third"  │  │

│  └────────────────────────────────┘  │

│                                      │

│  \[Ready!]  \[Skip set]

└──────────────────────────────────────┘

2\. in set

┌──────────────────────────────────────┐

│ \[Global stopwatch]   \[Exercise  timer] \[prev. session's exact set's exercise time (pale colored)]	|

│                                      │   

│  EXERCISE NAME   (not tappable)         │

│                                      │

│ next set number of  Previous session's exact set data (if available):   (Indicate the current set number on the horizontal numbers)           │

│  Set m: 8 reps × 80kg      │

│  RPE 7                     │

│                                      │

│  ┌────────────────────────────────┐  │

│  │ Note from previous session's exact exercise    │  │

│  │ "Focus on depth bottom third"  │  │

│  └────────────────────────────────┘  │

│                                      │

│  \[Done]  \[Skip set]

└──────────────────────────────────────┘

3\. after clicked \[Done] 

┌──────────────────────────────────────┐

│ next set number of  Previous session's exact set data (if available):   (Indicate the current set number on the horizontal numbers)           │

│  MASS / REPS / RPE                                  │

│  ┌────────────────────────────────┐  │

│  │ Note from previous session's exact exercise    │  │

│  │ "Focus on depth bottom third"  │  │

│  └────────────────────────────────┘  │

│                                      │

│  \[Next set / exercise]  \[Add set] (if set is the last set for this exercise)

└──────────────────────────────────────┘



Details:



\- Exercise name (large, e.g. 24px bold`): tapping it opens a bottom  overlay listing all exercises in this session (with type badges). Tapping another exercise does NOT skip the current one — it simply scrolls/navigates to it. The current exercise continues. The order in which exercises are visited is tracked via `performedOrder.

\- Global stopwatch: shows HH:MM:SS counting up from session start. Always visible.

\- Exercise/Break timer: resets when the current exercise/break starts (first set added).

\- Previous session data: most prominent. Shows set number,  reps x weight and RPE for each prior set. For warmup/cooldown shows only duration and note. If no prior data (cycle 1), show “No previous data”.

\- Sticky note area: If clicked, the note in this exerciseLogs will be changed. If not clicked, the note from the previous log data for this exercise will be written by default. Same note is shown/edited across all sets of the same exercise within the same session.

\- Completed sets: compact inline list building up as sets are added.

\



Set completion flow (for Main exercises only):



When the set is complete, the user taps “Done". At that point, launch a step-by-step card sequence:



> Each card is full-panel, large text, single prompt. No forms. No multiple fields at once.



Card 1 — Mass



\- Heading: "MASS"

\- Large numeric input receiver: This isn't an ordinary input receiver. In the center, there's the remaining number from the previous sessions's exact set's mass. To the right, 1.25 more is shown faintly and in smaller font. To the left, 1.25 less is shown faintly and in smaller font. It's a horizontally sliding input receiver.

\- Confirm button: "→" (full width)



Card 2 — Reps



\- Heading: "REPs"

\- Large numeric input receiver: This isn't an ordinary input receiver. In the center, there's the remaining number from the previous sessions's exact set's reps. To the right, 1 more is shown faintly and in smaller font. To the left, 1 less is shown faintly and in smaller font. It's a horizontally sliding input receiver.

\- Confirm button: "→" (full width)



Card 3 — RPE



\- Heading: "RPE"

\- Large numeric input receiver: This isn't an ordinary input receiver. In the center, there's the remaining number from the previous sessions's exact set's RPE. To the right, 1 more is shown faintly and in smaller font. To the left, 1 less is shown faintly and in smaller font. It's a horizontally sliding input receiver.

\- Confirm button: "→" (full width)



After Card 3:

\-Show "Add set" or "done" (featured) options.

\- Append the completed set to the in-progress exerciseLogs entry

\- Save entire activeSessionLog to appState

\- Start a rest timer and navigate to 1. appearence for break (if session is not finished)

\- During rest, the panel remains active — user can view the next exercise, edit the sticky note or end rest and start the next set immediately (rest duration is recorded as actual elapsed time)



Skipping a set:



\- “Skip set” records the set with skipped: true, weight/reps/rpe = null, but still timestamps it. 



\### 2.3 — End of session



If the user finish the session or if the user skips one after another, ask "Want to end the session?" (with an overlay and a darkened background). If he agrees, go to the evaluation tab:



Step-by-step evaluation cards (same full-panel pattern with skip (if the user skips one after another, ask "Want to end the evaluation?" - this means all of the evaluation metrics are null)). The stopwatches have already stopped, so the panel will be even simpler. The card simply features a question and below it a modern, smooth-scrolling, horizontal number input acceptor:





&#x20;   // Physical Metrics

&#x20;   energyLevel: number;           // 0-10 scale (start with placeholder 7)

&#x20;   oversllMuscleSoreness: number;        // 0-10 scale (start with placeholder 7)

&#x20;   jointComfort: number;          // 0-10 scale (start with placeholder 7)

&#x20;   bodyRecovery: boolean;     // 0-10 scale (start with placeholder 7)

&#x20;   sleepTime: number;           // 0-24h scale (start with placeholder 7)

&#x20;   preWorkoutNutrition: number;       // 0-10 scale (start with placeholder 7)



&#x20;   // Mental Metrics

&#x20;   mentalFocus: number;           // 0-10 scale (start with placeholder 7)

&#x20;   overallSessionRpe: number;     // 0-10 scale (start with placeholder 8)

&#x20;   sessionEnjoyment: number;      // 0-10 scale (start with placeholder 7)

&#x20;   preWorkoutStress: number;      // 0-10 scale (start with placeholder 3)

&#x20;   sleepQuality: number;          // 0-10 scale (start with placeholder 7)



&#x20;   notes: String





Last of all show the button: “Save \& finish”



On save:



\- Write final sessionLog to Dexie

\- Clear appState.activeSessionLog

\- Advance currentSessionIndex (and cycle if needed)

\- Return to pre-session screen



\-----



\## Tab 3 — Analytics



Shown only if at least 2 session logs exist. Otherwise show a “Complete more sessions to see trends” placeholder.



\### Exercise selector



Dropdown or searchable list of all exercises that have been logged.



\### Per-exercise charts (Chart.js, line and scatter)



Toggle between charts using a horizontal segmented control or pill tabs:



|Chart            |X-axis                      |Y-axis               |

|-----------------|----------------------------|---------------------|

|Volume over time |Session date                |Total weight × reps  |

|Weight over time |Session date                |Max weight used      |

|Reps over time   |Session date                |Total reps           |

|Avg RPE over time|Session date                |Average RPE          |

|Time per set     |Session date                |Avg set duration (s) |

|Rest time        |Session date                |Avg rest duration (s)|

|Weight vs rest   |Rest duration (s)           |Weight (kg) — scatter|

|Weight vs order  |Exercise position in session|Weight (kg) — scatter|



Each chart:



\- Tap a data point: show tooltip with exact values + date

\- One chart visible at a time

\- Chart height: 250px

\- Clean minimal axes, no gridlines except horizontal, muted colours matching design palette



\### Session-level charts



A second section below the exercise charts:



|Chart           |X-axis      |Y-axis               |

|----------------|------------|---------------------|

|Session duration|Session date|Total duration (min) |

|Physical score  |Session date|Physical eval (1–10) |

|Emotional score |Session date|Emotional eval (1–10)|



\### Log browser (within Analytics)



Collapsible section: chronological list of session logs. Tap to expand a session and see exercise-level summary. Read-only. It shouldn't look like a boring Excel spreadsheet. It should have a modern and minimalist design.



\-----



\## PWA Requirements



\### manifest.json

{

&#x20; "name": "Gymus",

&#x20; "short\_name": "Gymus",

&#x20; "display": "standalone",

&#x20; "start\_url": "/",

&#x20; "theme\_color": "#FAF9F6",

&#x20; "background\_color": "#FAF9F6",

&#x20; "icons": \[

&#x20;   { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },

&#x20;   { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }

&#x20; ]

}



Provide simple placeholder icon PNGs (a dumbbell silhouette  lettermark on a muted background). Include proper Apple touch icon: <link rel="apple-touch-icon" href="icon-192.png">.



\### service-worker.js



\- Cache-first strategy for all local assets (HTML, CSS, JS, icons)

\- Version the cache (`CACHE\_NAME = 'gym-v1'`); bump on updates

\- No network fetches — this app is entirely local; the service worker only serves cached assets

\- Register from index.html



\### iOS-specific meta tags (in index.html `<head>`)

<meta name="apple-mobile-web-app-capable" content="yes">

<meta name="apple-mobile-web-app-status-bar-style" content="default">

<meta name="apple-mobile-web-app-title" content="Gym">

<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">



\-----



\## Key Constraints \& Non-Negotiables



1\. No server. No backend. No authentication. No security layers. This is a local personal tool.

1\. IndexedDB only for persistent data — no localStorage for any application data.

1\. `navigator.storage.persist()` must be called at startup to prevent browser from evicting data.

1\. In-progress session is saved after every set to appState.activeSessionLog. If the user closes Safari mid-session and reopens, the session should be resumable.

1\. Step-by-step input cards (weight → reps → RPE) must NEVER appear as a single form. One prompt per screen, always.

1\. No unnecessary dependencies. Do not add libraries not listed in the tech stack.

1\. All charts must be functional offline — Chart.js loaded via CDN must be included in the service worker cache.

1\. Sticky notes are per-exercise per session template, not per set. One note per exercise, shown across all sets, editable inline during the session.

1\. Cycle logic is strict: the 6th session in a 5-session cycle is always treated as session 1 of cycle 2. Historical data lookups always find the most recent prior occurrence of the same session template.

1\. Warmup and cooldown collect only duration. No exercise, weight, reps, or RPE prompts.



\-----



\## File Structure

index.html

manifest.json

service-worker.js

icon-192.png

icon-512.png



All Vue components, styles, Dexie schema, and Chart.js charts live inside index.html using <script type="module"> blocks or Vue’s CDN global. Keep the file organised with clearly commented sections. If the file grows beyond \~1000 lines, split into logical JS modules (`db.js`, session.js, `charts.js`) loaded as ES modules.

