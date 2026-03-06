# Gesture Control Panel

A real-time hand gesture recognition widget built with MediaPipe and React. Uses computer vision to classify hand gestures via webcam and map them to UI actions.

## Demo

> Start camera → show a gesture → action triggers in under 1.5 seconds

## Gestures

| Gesture | Action |
|---|---|
| ☝️ Index Finger Point | Confirm |
| ✋ Open Palm | Stop |
| ✌️ Peace Sign | Next |
| ✊ Fist | Reset |

## How It Works

**Gesture Classification**
Each gesture is detected by analyzing 21 hand landmarks provided by MediaPipe. For each of the 4 fingers, the algorithm compares the distance from the fingertip to the wrist against the distance from the PIP joint (middle knuckle) to the wrist. If the tip distance exceeds the PIP distance by a 1.10x threshold, the finger is classified as extended. Gesture identity is determined by the specific combination of extended and curled fingers.

**Noise Reduction**
Raw webcam input is noisy — a single misclassified frame can trigger false actions. To solve this, every incoming frame is added to a rolling window of the last 5 frames. A gesture is only considered stable if it appears in at least 3 of those 5 frames (majority vote). This eliminates flickering without adding noticeable lag.

**Action Debouncing**
Actions fire when a gesture changes OR after holding the same gesture for 2 seconds. A 1.5 second debounce prevents the same action from firing repeatedly. The stability threshold (2/5, 3/5, or 4/5 frames) is adjustable via a slider in the UI.

## Tech Stack

- React (hooks, refs, callbacks)
- MediaPipe Hands — 21-landmark hand tracking model
- HTML5 Canvas — real-time landmark overlay rendering
- JavaScript — custom classification and smoothing algorithms

## Running Locally

```bash
npm install
npm run dev
```

Requires webcam access. Grant camera permissions when prompted.

## Key Files

```
src/
├── App.jsx          # Main gesture control component
├── main.tsx         # Entry point
└── styles.css       # Base styles
```
