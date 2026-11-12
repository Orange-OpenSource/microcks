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
package io.github.microcks.chaos;

import io.github.microcks.domain.chaos.ExperimentRun;
import io.github.microcks.domain.chaos.ExperimentState;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

/**
 * Resolves the logical timeline position of an experiment run from its persisted clock anchors. The wall clock is the
 * single {@link Clock} bean wired by {@link ChaosConfiguration}, shared with the whole chaos control plane.
 */
@Component
public class ChaosExperimentClock {

   private final Clock clock;

   public ChaosExperimentClock(Clock clock) {
      this.clock = clock;
   }

   /** Return the current instant of the chaos wall clock. */
   public Instant now() {
      return clock.instant();
   }

   /** Resolve the timeline position of a run against the supplied experiment duration. */
   public long positionAt(ExperimentRun run, long durationMs) {
      return positionAt(run.getState(), run.getAnchorPositionMs(), run.getAnchorWallTime(), durationMs,
            clock.instant());
   }

   public long positionAt(ExperimentState state, long anchorPositionMs, Instant anchorWallTime, long durationMs,
         Instant now) {
      long position;
      switch (state) {
         case RUNNING -> {
            if (anchorWallTime == null) {
               position = anchorPositionMs;
            } else {
               long elapsed = anchorPositionMs + Math.max(0, now.toEpochMilli() - anchorWallTime.toEpochMilli());
               // A running experiment loops over its duration until it is stopped.
               position = durationMs > 0 ? elapsed % durationMs : elapsed;
            }
         }
         default -> position = anchorPositionMs;
      }
      return Math.max(0, Math.min(durationMs, position));
   }
}
