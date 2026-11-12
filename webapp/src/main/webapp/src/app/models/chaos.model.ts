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

export enum ExperimentState {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
}



/** One editable input of a modifier, as described by the backend catalog. */
export type ChaosModifierParam = {
  name: string;
  label: string;
  min?: number | null;
  max?: number | null;
  keyframeable: boolean;
  /** Initial value for new tracks; null means an empty text input. */
  defaultValue?: number | null;
};

/** One modifier type of the backend catalog (GET /api/chaos/modifiers). */
export type ChaosModifierDescriptor = {
  type: string;
  label: string;
  params: ChaosModifierParam[];
  interpolation: string[];
  description: string;
};

export type ChaosKeyframe = {
  timeMs: number;
  value: number;
};

export type ChaosCurve = {
  keyframes: ChaosKeyframe[];
};

/** Persisted configuration of one modifier; its shape is described by the backend catalog. */
export type ChaosModifierConfig = {
  type: string;
  [param: string]: unknown;
};


export type ChaosTrack = {
  id: string;
  serviceName?: string;
  operationName?: string;
  /** Active window of the modifier within the experiment; 0/undefined ends are resolved against the duration. */
  startMs?: number;
  endMs?: number;
  probability: ChaosCurve;
  modifier: ChaosModifierConfig;
};

export type ChaosExperiment = {
  id?: string;
  name: string;
  description?: string;
  durationMs: number;
  state: ExperimentState;
  anchorPositionMs: number;
  anchorWallTime?: string;
  tracks: ChaosTrack[];
  currentPositionMs?: number;
};






export function emptyCurve(value: number = 0): ChaosCurve {
  return {
    keyframes: [{ timeMs: 0, value }],
  };
}

