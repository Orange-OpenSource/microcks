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
  curveValueAt,
  formatTick,
  formatTime,
  isParamAnimated,
  newTrack,
  niceTickMs,
  sortedKeyframes,
  stepCurvePath,
  trackProbabilityAt,
  trackWindow,
  uniqueTrackId,
  validateExperiment,
} from './chaos-editor.utils';
import { ChaosExperiment, ExperimentState } from '../../models/chaos.model';

/** Build a test track with an HTTP error modifier, like the editor does from the backend catalog. */
function newHttpErrorTrack(id: string, durationMs: number) {
  return newTrack(id, durationMs, { type: 'HTTP_ERROR', statusCode: 503, responseBody: '' }, 0.8);
}

describe('chaos-editor utils', () => {
  describe('curveValueAt', () => {
    it('evaluates the STEP semantics of a curve', () => {
      const curve = {
        keyframes: [
          { timeMs: 0, value: 0.2 },
          { timeMs: 5000, value: 0.8 },
          { timeMs: 10000, value: 0 },
        ],
      };
      expect(curveValueAt(curve, 0)).toBe(0.2);
      expect(curveValueAt(curve, 4999)).toBe(0.2);
      expect(curveValueAt(curve, 5000)).toBe(0.8);
      expect(curveValueAt(curve, 20000)).toBe(0);
    });

    it('holds the first keyframe value before its time', () => {
      const curve = { keyframes: [{ timeMs: 3000, value: 0.5 }] };
      expect(curveValueAt(curve, 0)).toBe(0.5);
      expect(curveValueAt(curve, 2999)).toBe(0.5);
    });

    it('returns 0 for an empty curve', () => {
      expect(curveValueAt({ keyframes: [] }, 100)).toBe(0);
    });
  });

  describe('sortedKeyframes and isParamAnimated', () => {
    it('sorts keyframes by time', () => {
      const sorted = sortedKeyframes({
        keyframes: [
          { timeMs: 2000, value: 1 },
          { timeMs: 0, value: 0 },
        ],
      });
      expect(sorted.map((keyframe) => keyframe.timeMs)).toEqual([0, 2000]);
    });

    it('detects animated parameters', () => {
      expect(isParamAnimated('probability', { keyframes: [{ timeMs: 0, value: 1 }] })).toBeFalse();
      expect(isParamAnimated('probability', { keyframes: [{ timeMs: 0, value: 1 }, { timeMs: 10, value: 0 }] }))
        .toBeTrue();
    });
  });

  describe('trackWindow', () => {
    it('defaults to the whole duration when the bounds are missing', () => {
      const track = newHttpErrorTrack('t', 60000);
      delete track.startMs;
      delete track.endMs;
      expect(trackWindow(track, 60000)).toEqual({ startMs: 0, endMs: 60000 });
    });

    it('uses the explicit bounds of the track', () => {
      const track = newHttpErrorTrack('t', 60000);
      track.startMs = 10000;
      track.endMs = 20000;
      expect(trackWindow(track, 60000)).toEqual({ startMs: 10000, endMs: 20000 });
    });

    it('keeps at least one millisecond of window and clamps to the duration', () => {
      const track = newHttpErrorTrack('t', 60000);
      track.startMs = 30000;
      track.endMs = 30000;
      expect(trackWindow(track, 60000)).toEqual({ startMs: 30000, endMs: 30001 });
      track.startMs = 70000;
      track.endMs = 80000;
      expect(trackWindow(track, 60000).endMs).toBe(60000);
    });
  });

  describe('trackProbabilityAt', () => {
    it('is 0 outside the active window and follows the curve inside it', () => {
      const track = newHttpErrorTrack('t', 60000);
      track.startMs = 10000;
      track.endMs = 20000;
      track.probability = { keyframes: [{ timeMs: 0, value: 0.8 }] };
      expect(trackProbabilityAt(track, 60000, 5000)).toBe(0);
      expect(trackProbabilityAt(track, 60000, 15000)).toBe(0.8);
      expect(trackProbabilityAt(track, 60000, 20000)).toBe(0);
    });
  });

  describe('stepCurvePath with a window', () => {
    it('draws the inactive plateaus outside of the window', () => {
      const curve = { keyframes: [{ timeMs: 0, value: 0.8 }] };
      const path = stepCurvePath(curve, 60000, 600, 40, 0, 1, { startMs: 10000, endMs: 20000 });
      // Starts flat at the bottom, jumps at the window start, holds, drops at the window end.
      expect(path).toBe('M 0.00 36.00 H 100.00 V 10.40 H 200.00 V 36.00 H 600');
    });

    it('draws a plain hold when no window is supplied', () => {
      const curve = { keyframes: [{ timeMs: 0, value: 0.8 }] };
      expect(stepCurvePath(curve, 60000, 600, 40, 0, 1)).toBe('M 0.00 10.40 H 600');
    });
  });

  describe('uniqueTrackId', () => {
    it('suffixes duplicate names', () => {
      const experiment: ChaosExperiment = {
        name: 'exp',
        durationMs: 60000,
        state: ExperimentState.STOPPED,
        anchorPositionMs: 0,
        tracks: [
          newHttpErrorTrack('HTTP error', 60000),
          newHttpErrorTrack('HTTP error 2', 60000),
        ],
      };
      expect(uniqueTrackId(experiment, 'HTTP error')).toBe('HTTP error 3');
      expect(uniqueTrackId(experiment, 'Latency')).toBe('Latency');
    });
  });

  describe('validateExperiment', () => {
    it('accepts a consistent experiment', () => {
      const experiment: ChaosExperiment = {
        id: '1',
        name: 'exp',
        durationMs: 60000,
        state: ExperimentState.STOPPED,
        anchorPositionMs: 0,
        tracks: [newHttpErrorTrack('HTTP error', 60000)],
      };
      experiment.tracks[0].serviceName = 'API';
      experiment.tracks[0].operationName = 'GET /';
      expect(validateExperiment(experiment)).toEqual([]);
    });

    it('reports missing targets, invalid probabilities and broken windows', () => {
      const experiment: ChaosExperiment = {
        name: 'exp',
        durationMs: 60000,
        state: ExperimentState.STOPPED,
        anchorPositionMs: 0,
        tracks: [newHttpErrorTrack('HTTP error', 60000)],
      };
      const problems = validateExperiment(experiment);
      expect(problems.some((problem) => problem.includes('service'))).toBeTrue();

      experiment.tracks[0].probability.keyframes = [{ timeMs: 0, value: 2 }];
      expect(validateExperiment(experiment).length).toBeGreaterThan(0);

      experiment.tracks[0].probability.keyframes = [{ timeMs: 0, value: 0.5 }];
      experiment.tracks[0].endMs = 80000;
      expect(validateExperiment(experiment).some((problem) => problem.includes('experiment end'))).toBeTrue();

      experiment.tracks[0].endMs = 10000;
      experiment.tracks[0].startMs = 10000;
      expect(validateExperiment(experiment).some((problem) => problem.includes('start before'))).toBeTrue();
    });
  });

  describe('formatting helpers', () => {
    it('formats time labels', () => {
      expect(formatTime(0)).toBe('0.0s');
      expect(formatTime(12500)).toBe('12.5s');
      expect(formatTime(90000)).toBe('1m 30.0s');
    });

    it('formats ruler ticks', () => {
      expect(formatTick(0)).toBe('0s');
      expect(formatTick(30000)).toBe('30s');
      expect(formatTick(90000)).toBe('1m30');
      expect(formatTick(120000)).toBe('2m');
    });

    it('picks readable tick intervals', () => {
      expect(niceTickMs(0.001)).toBe(600000);
      expect(niceTickMs(0.01)).toBe(10000);
      expect(niceTickMs(1)).toBe(100);
    });
  });
});
