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
package io.github.microcks.domain.chaos;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * The current run of a {@link ChaosExperiment}: its lifecycle state and the clock anchors used to resolve the logical
 * timeline position. Keeping the run out of the definition document lets definitions be edited and reused while run
 * state follows its own lifecycle. There is at most one run per experiment; an experiment without a run never started.
 */
@Document(collection = "chaos_experiment_runs")
public class ExperimentRun {

   @Id
   private String id;
   @Indexed
   private String experimentId;
   private ExperimentState state = ExperimentState.STOPPED;
   private long anchorPositionMs;
   private Instant anchorWallTime;

   public ExperimentRun() {
   }

   /** Build a run for the given experiment, anchored at the supplied position and wall time. */
   public ExperimentRun(String experimentId, ExperimentState state, long anchorPositionMs, Instant anchorWallTime) {
      this.experimentId = experimentId;
      this.state = state;
      this.anchorPositionMs = anchorPositionMs;
      this.anchorWallTime = anchorWallTime;
   }

   public String getId() {
      return id;
   }

   public void setId(String id) {
      this.id = id;
   }

   public String getExperimentId() {
      return experimentId;
   }

   public void setExperimentId(String experimentId) {
      this.experimentId = experimentId;
   }

   public ExperimentState getState() {
      return state;
   }

   public void setState(ExperimentState state) {
      this.state = state;
   }

   public long getAnchorPositionMs() {
      return anchorPositionMs;
   }

   public void setAnchorPositionMs(long anchorPositionMs) {
      this.anchorPositionMs = anchorPositionMs;
   }

   public Instant getAnchorWallTime() {
      return anchorWallTime;
   }

   public void setAnchorWallTime(Instant anchorWallTime) {
      this.anchorWallTime = anchorWallTime;
   }
}
