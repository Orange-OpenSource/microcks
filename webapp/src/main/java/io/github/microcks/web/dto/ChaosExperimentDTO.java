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
package io.github.microcks.web.dto;

import io.github.microcks.domain.chaos.ExperimentState;
import io.github.microcks.domain.chaos.ModifierTrack;

import java.time.Instant;
import java.util.List;

/**
 * Flat API representation of a chaos experiment: its definition composed with the state and clock anchors of its
 * current run and the derived timeline position. Served by the management API and consumed by the timeline editor.
 * @param id                Experiment id
 * @param name              Experiment name
 * @param description       Experiment description
 * @param durationMs        Experiment duration
 * @param tracks            Modifier tracks of the timeline
 * @param state             State of the current run, STOPPED when the experiment never started
 * @param anchorPositionMs  Position anchor of the current run
 * @param anchorWallTime    Wall time anchor of the current run
 * @param currentPositionMs Derived timeline position at retrieval time
 */
public record ChaosExperimentDTO(String id, String name, String description, long durationMs,
      List<ModifierTrack> tracks, ExperimentState state, long anchorPositionMs, Instant anchorWallTime,
      long currentPositionMs) {
}
