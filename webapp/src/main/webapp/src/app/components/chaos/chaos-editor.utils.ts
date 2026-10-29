/*
 * Copyright The Microcks Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  ChaosCurve,
  ChaosExperiment,
  ChaosKeyframe,
  ChaosModifierParam,
  ChaosTrack,
} from '../../models/chaos.model';

/** The track parameters that support keyframes; open so backend catalog params fit in. */
export type ChaosParamKey = 'probability' | (string & {});

/** The active window of a track within the experiment timeline. */
export interface ChaosWindow {
  startMs: number;
  endMs: number;
}

/** Display and edition metadata of a keyframeable parameter, built from the backend catalog. */
export interface ChaosParamSpec {
  key: ChaosParamKey;
  label: string;
  min: number;
  max: number;
  /** Initial value for new tracks, from the backend catalog. */
  defaultValue: number | null;
  format: (value: number) => string;
  /** Value rendered in the parameter input (probability is edited as a percentage). */
  inputValue: (value: number) => string;
  /** Parse the parameter input back into the stored value. */
  parseInput: (text: string) => number;
}

/** True when a catalog parameter is numeric (it declares bounds). */
export function isNumericParam(param: ChaosModifierParam): boolean {
  return param.min != null && param.max != null;
}

/** Current editor selection: a track, optionally one of its keyframes. */
export interface ChaosSelection {
  trackId: string;
  param?: ChaosParamKey;
  keyframeIndex?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Return the keyframes of a curve, sorted by time. */
export function sortedKeyframes(curve: ChaosCurve): ChaosKeyframe[] {
  return [...(curve?.keyframes ?? [])].sort((a, b) => a.timeMs - b.timeMs);
}

/** Sort keyframes and drop duplicated times, letting fault values win over boundary zeros. */
export function dedupeKeyframes(keyframes: ChaosKeyframe[]): ChaosKeyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
  const result: ChaosKeyframe[] = [];
  for (const keyframe of sorted) {
    const collision = result.find((existing) => existing.timeMs === keyframe.timeMs);
    if (!collision) {
      result.push(keyframe);
    } else if (collision.value <= 0 && keyframe.value > 0) {
      result.splice(result.indexOf(collision), 1, keyframe);
    }
  }
  return result;
}

/** Evaluate a curve at a timeline position using the STEP interpolation of the backend. */
export function curveValueAt(curve: ChaosCurve, timeMs: number): number {
  const keyframes = sortedKeyframes(curve);
  if (keyframes.length === 0) {
    return 0;
  }
  let value = keyframes[0].value;
  for (const keyframe of keyframes) {
    if (keyframe.timeMs > timeMs) {
      break;
    }
    value = keyframe.value;
  }
  return value;
}

/** Return the curve of a track holding the given keyframeable parameter. Probability lives on the track
 * itself; the other keyframeable parameters are curves inside the persisted modifier config. A legacy
 * static number (from before the parameter became keyframeable) is exposed as a constant curve. */
export function getParamCurve(track: ChaosTrack, param: ChaosParamKey): ChaosCurve {
  if (param === 'probability') {
    return track.probability;
  }
  const stored = (track.modifier as Record<string, unknown>)[param];
  if (isCurve(stored)) {
    return stored;
  }
  if (typeof stored === 'number' && !isNaN(stored)) {
    return { keyframes: [{ timeMs: 0, value: stored }] };
  }
  return { keyframes: [] };
}

/** Replace the curve of a track holding the given keyframeable parameter. */
export function withParamCurve(track: ChaosTrack, param: ChaosParamKey, curve: ChaosCurve): ChaosTrack {
  if (param === 'probability') {
    return { ...track, probability: curve };
  }
  return { ...track, modifier: { ...track.modifier, [param]: curve } };
}

function isCurve(value: unknown): value is ChaosCurve {
  return !!value && typeof value === 'object' && Array.isArray((value as ChaosCurve).keyframes);
}

/** A track is keyframed as soon as it holds more than a single keyframe. */
export function isKeyframed(curve: ChaosCurve): boolean {
  return (curve?.keyframes ?? []).length > 1;
}

/** Minimum number of keyframes a parameter keeps. */
export function minKeyframes(param: ChaosParamKey): number {
  void param;
  return 1;
}

/** A parameter is "animated" (stopwatch on) as soon as it holds more than a single keyframe. */
export function isParamAnimated(param: ChaosParamKey, curve: ChaosCurve): boolean {
  void param;
  return isKeyframed(curve);
}

/**
 * The active window of a modifier: its explicit start/end bounds, resolved against the experiment duration.
 * The window is the clip the user drags in the timeline; the probability curve only applies inside it.
 */
export function trackWindow(track: ChaosTrack, durationMs: number): ChaosWindow {
  const startMs = Math.max(0, Math.round(track.startMs ?? 0));
  const endMs = Math.round(track.endMs ?? 0) > 0 ? Math.round(track.endMs as number) : durationMs;
  return {
    startMs,
    endMs: clamp(endMs, Math.min(startMs + 1, Math.max(1, durationMs)), Math.max(1, durationMs)),
  };
}

/**
 * Live activation probability of a track at a timeline position: 0 outside the active window, the STEP
 * evaluation of the probability curve inside it — mirroring the backend ModifierTrack.probabilityAt.
 */
export function trackProbabilityAt(track: ChaosTrack, durationMs: number, timeMs: number): number {
  const window = trackWindow(track, durationMs);
  if (timeMs < window.startMs || timeMs >= window.endMs) {
    return 0;
  }
  return curveValueAt(track.probability, timeMs);
}

/**
 * Migrate a legacy track whose clip boundaries were encoded as 0% keyframes: derive the active window from
 * the first positive keyframe and the first 0% keyframe after it, then strip those boundary keyframes so the
 * curve only carries the intensity shape inside the window.
 */
export function migrateTrackBounds(
  track: ChaosTrack,
  durationMs: number,
): { startMs: number; endMs: number; keyframes: ChaosKeyframe[] } {
  const keyframes = sortedKeyframes(track.probability);
  const firstPositive = keyframes.find((keyframe) => keyframe.value > 0);
  if (keyframes.length <= 1 || !firstPositive) {
    return {
      startMs: 0,
      endMs: durationMs,
      keyframes: keyframes.length > 0 ? [keyframes[0]] : [{ timeMs: 0, value: 0 }],
    };
  }
  let endMs = durationMs;
  let lastPositiveIndex = -1;
  for (let i = keyframes.length - 1; i >= 0; i--) {
    if (keyframes[i].value > 0) {
      lastPositiveIndex = i;
      break;
    }
  }
  for (let i = lastPositiveIndex + 1; i < keyframes.length; i++) {
    if (keyframes[i].value <= 0) {
      endMs = keyframes[i].timeMs;
      break;
    }
  }
  const kept = keyframes.filter((keyframe) =>
    keyframe.value > 0
      ? keyframe.timeMs >= firstPositive.timeMs && keyframe.timeMs < endMs
      : keyframe.timeMs > firstPositive.timeMs && keyframe.timeMs < endMs,
  );
  if (kept.length === 0) {
    kept.push({ timeMs: firstPositive.timeMs, value: firstPositive.value });
  }
  return { startMs: firstPositive.timeMs, endMs, keyframes: kept };
}

/** Format a timeline position as a compact human label, eg "1m 05.2s". */
export function formatTime(timeMs: number): string {
  const negative = timeMs < 0;
  const total = Math.abs(timeMs) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  const secondsLabel = seconds < 10 ? '0' + seconds.toFixed(1) : seconds.toFixed(1);
  const label = minutes > 0 ? minutes + 'm ' + secondsLabel + 's' : seconds.toFixed(1) + 's';
  return negative ? '-' + label : label;
}

/** Compact label for timeline ruler ticks, eg "30s", "1m30" or "2m". */
export function formatTick(timeMs: number): string {
  const totalSeconds = Math.round(timeMs / 1000);
  if (totalSeconds < 60) {
    return totalSeconds + 's';
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return seconds > 0 ? minutes + 'm' + (seconds < 10 ? '0' + seconds : seconds) : minutes + 'm';
}

/** Format a duration input in seconds with one decimal. */
export function formatSeconds(timeMs: number): string {
  return (Math.round(timeMs / 100) / 10).toFixed(1);
}

/** Parse a duration expressed in seconds into milliseconds. */
export function parseSeconds(text: string): number {
  const value = parseFloat(text);
  return isNaN(value) ? 0 : Math.round(value * 1000);
}

/** Choose a ruler tick interval (ms) that keeps labels at least ~80px apart. */
export function niceTickMs(pxPerMs: number): number {
  const candidates = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
  for (const candidate of candidates) {
    if (candidate * pxPerMs >= 80) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

/** Everything in the editor snaps to whole seconds. */
export const SNAP_MS = 1000;

/** Snap a timeline position to the nearest whole second. */
export function snapToSecond(timeMs: number): number {
  return Math.round(timeMs / SNAP_MS) * SNAP_MS;
}

/** Distinct colors used for modifier tracks, indexed by position in the timeline. */
export const TRACK_COLORS = ['#0088ce', '#ec7a08', '#3f9c35', '#e10098', '#9c27b0', '#cc0000', '#004368'];

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

/**
 * Build the SVG path of a STEP curve fitted in a box of the given size, holding the last keyframe value
 * until the right edge. When a window is supplied, the modifier is inactive outside of it: the curve is
 * flat at the minimum value before the window start and drops back to it at the window end. Used to draw
 * parameter curves inline in the timeline lanes.
 */
export function stepCurvePath(
  curve: ChaosCurve,
  durationMs: number,
  width: number,
  height: number,
  minValue: number,
  maxValue: number,
  window?: ChaosWindow,
  padding: number = 4,
): string {
  const keyframes = sortedKeyframes(curve);
  if (keyframes.length === 0 || durationMs <= 0 || width <= 0 || height <= 0) {
    return '';
  }
  const points: { timeMs: number; value: number }[] = [];
  if (window && window.startMs > 0) {
    // Inactive before the window, then jump to the value the curve holds at the window start.
    points.push({ timeMs: 0, value: minValue });
    points.push({ timeMs: window.startMs, value: curveValueAt(curve, window.startMs) });
  }
  for (const keyframe of keyframes) {
    if (!window || (keyframe.timeMs >= window.startMs && keyframe.timeMs < window.endMs)) {
      points.push(keyframe);
    }
  }
  if (window) {
    if (points.length === 0) {
      points.push({ timeMs: window.startMs, value: minValue });
    }
    if (window.endMs < durationMs) {
      points.push({ timeMs: window.endMs, value: minValue });
    }
  }
  if (points.length === 0) {
    points.push(keyframes[0]);
  }

  const x = (timeMs: number) => (timeMs / durationMs) * width;
  const span = maxValue - minValue;
  const usable = height - 2 * padding;
  const y = (value: number) => {
    const ratio = span === 0 ? 0.5 : (value - minValue) / span;
    return padding + (1 - ratio) * usable;
  };
  let path = 'M ' + x(points[0].timeMs).toFixed(2) + ' ' + y(points[0].value).toFixed(2);
  for (let i = 1; i < points.length; i++) {
    path += ' H ' + x(points[i].timeMs).toFixed(2) + ' V ' + y(points[i].value).toFixed(2);
  }
  path += ' H ' + width;
  return path;
}

/** Build a fresh track spanning the whole experiment, with the given modifier config. */
export function newTrack(
  id: string,
  durationMs: number,
  modifier: { type: string } & Record<string, unknown>,
  initialProbability: number,
): ChaosTrack {
  return {
    id,
    serviceName: '',
    operationName: '',
    startMs: 0,
    endMs: Math.max(1, durationMs),
    probability: { keyframes: [{ timeMs: 0, value: initialProbability }] },
    modifier,
  };
}

/** Generate a track id unique within the experiment, eg "HTTP error 2". */
export function uniqueTrackId(experiment: ChaosExperiment, base: string): string {
  const existing = new Set(experiment.tracks.map((track) => track.id));
  if (!existing.has(base)) {
    return base;
  }
  let index = 2;
  while (existing.has(base + ' ' + index)) {
    index++;
  }
  return base + ' ' + index;
}

/** Light client-side validation mirroring the backend rules. Returns a list of problems. */
export function validateExperiment(experiment: ChaosExperiment): string[] {
  const problems: string[] = [];
  if (!experiment.name || !experiment.name.trim()) {
    problems.push('The experiment name is required.');
  }
  if (experiment.durationMs <= 0) {
    problems.push('The experiment duration must be strictly positive.');
  }
  const ids = new Set<string>();
  for (const track of experiment.tracks) {
    if (!track.id || !track.id.trim()) {
      problems.push('Every modifier must have a non-empty name.');
    } else if (ids.has(track.id)) {
      problems.push('Duplicate modifier name: ' + track.id);
    }
    ids.add(track.id);
    if (!track.serviceName || !track.operationName) {
      problems.push('Modifier "' + track.id + '" must target a service and an operation.');
    }
    const window = trackWindow(track, experiment.durationMs);
    if (window.endMs > experiment.durationMs) {
      problems.push('Modifier "' + track.id + '" cannot end after the experiment end.');
    }
    if (window.startMs >= window.endMs) {
      problems.push('Modifier "' + track.id + '" must start before its end.');
    }
    for (const keyframe of track.probability.keyframes) {
      if (keyframe.value < 0 || keyframe.value > 1) {
        problems.push('Probability of "' + track.id + '" must be between 0% and 100%.');
        break;
      }
    }
  }
  return problems;
}
