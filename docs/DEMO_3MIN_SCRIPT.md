# x404-r Demo Video Script (3 Minutes)

## Slide Reference: docs/presentation.html

Open in browser, use arrow keys to navigate. Each slide has timer and script notes.

---

## [0:00 - 0:10] SLIDE 1: Title

**SHOW:** Title slide with logos

**SAY:**
> "x404-r - the crash-proof runtime for AI agents. Built on CockroachDB and AWS Lambda."

---

## [0:10 - 0:30] SLIDE 2: The Problem

**SHOW:** Side-by-side comparison of Traditional vs x404-r

**SAY:**
> "Traditional agents store state in memory. When they crash, everything is lost. You restart from zero."
>
> "x404-r stores state in CockroachDB. After a crash, new workers resume from the last checkpoint. Zero progress lost."

---

## [0:30 - 0:45] SLIDE 3: Why It Happens

**SHOW:** Grid of crash scenarios

**SAY:**
> "Lambda timeouts, memory limits, deployments, network issues - crashes are inevitable in production. The question is: do you lose your progress?"

---

## [0:45 - 1:00] SLIDE 4: The Solution

**SHOW:** Flow diagram: Worker → Checkpoint → CockroachDB → New Worker

**SAY:**
> "Workers are completely stateless and disposable. State lives in CockroachDB. Kill one worker, spin up another - it picks up exactly where the last one left off."

---

## [1:00 - 1:30] SLIDE 5-6: The SDK

**SHOW:** Code examples

**SAY:**
> "One npm package. Connect to CockroachDB. The magic is `ctx.checkpoint()` - call this to save state atomically."
>
> "If you crash and resume, `ctx.state` contains your last checkpoint. Continue from where you left off, not from zero."

---

## [1:30 - 2:00] SLIDE 7: Live Demo

**SHOW:** Terminal + Dashboard (or show the slide visualization)

**OPTION A: If you have the dashboard running:**
```bash
# Terminal 1: Start local server
cd aws-cockcroachdb-hack
npm run dev

# Terminal 2: Create demo job
curl -X POST http://localhost:3001/jobs/demo

# Show dashboard - tasks executing
# Wait for task 3 to be running, then:
curl -X POST http://localhost:3001/chaos/kill-worker \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_ID_HERE"}'

# Show task turning red, then green (recovered)
```

**OPTION B: Show the slide visualization**

**SAY:**
> "Watch: I create a demo job with 5 tasks. Task 3 starts running. Now I kill the worker mid-task."
>
> "Task goes red - worker died. But look - within seconds, a new worker claims it. It resumes from the checkpoint, not from the beginning."
>
> "Job completes. Zero progress lost. That's x404-r."

---

## [2:00 - 2:20] SLIDE 8: Comparison Results

**SHOW:** docs/comparison.html (take screenshot for video)

**SAY:**
> "Same task, 2 crashes each. Without x404-r: 235 API calls, $11 cost, 4.5 hours. With x404-r: 100 calls, $4.70, 1.8 hours."
>
> "That's 57% fewer tokens, $6.30 saved, 2.7 hours saved - on one task."

---

## [2:20 - 2:35] SLIDE 9: CockroachDB Features

**SHOW:** 3 feature cards

**SAY:**
> "Why CockroachDB? Three features: SKIP LOCKED for atomic task claiming without race conditions. Distributed transactions for consistent checkpoints. JSON and vectors for flexible agent state."

---

## [2:35 - 2:52] SLIDE 10: Architecture

**SHOW:** AWS architecture diagram

**SAY:**
> "EventBridge triggers Lambda workers every minute. Workers claim tasks from CockroachDB using SKIP LOCKED. Two modes: embedded with your own infrastructure, or cloud mode where Lambda handles everything."

---

## [2:52 - 2:56] SLIDE 11: Savings

**SHOW:** Savings metrics

**SAY:**
> "x404-r tracks everything. Crashes recovered, tokens saved, money saved. Context is never lost."

---

## [2:56 - 3:00] SLIDE 12: CTA

**SHOW:** Install command

**SAY:**
> "npm install @shalwin04/x404r-sdk. GitHub: shalwin04/x404-r. Context is never lost. That's the promise."

---

# Recording Tips

1. **Screen Setup:**
   - Open `docs/presentation.html` in Chrome
   - Use full screen (F11)
   - Use arrow keys to navigate slides

2. **Screenshots to Take:**
   - `docs/comparison.html` - Full page screenshot for slide 8
   - `docs/architecture-detailed.html` - For architecture reference
   - `docs/presentation.html` slide 7 - For live demo visualization

3. **Recording Software:**
   - OBS (free) or QuickTime (Mac)
   - Record at 1920x1080

4. **Audio Tips:**
   - Speak clearly and at moderate pace
   - Each section is timed - practice hitting marks
   - Brief pauses between slides are fine

5. **If No Live Dashboard:**
   - Use the slide visualizations
   - They show the same information
   - Pre-recorded terminal clips can be edited in

---

# Quick Checklist

- [ ] Slides open: `docs/presentation.html`
- [ ] Comparison screenshot: `docs/comparison.html`
- [ ] Practice run-through (should be ~2:45-3:00)
- [ ] Recording software ready
- [ ] Quiet environment
- [ ] Export as MP4 for DevPost upload
