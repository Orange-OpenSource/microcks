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

/**
 * Configuration of an artificial response delay.
 */
public class LatencyModifierConfig implements ModifierConfig {

   /** Maximum injected delay, keeping blocked mock request threads reasonable. */
   public static final long MAX_LATENCY_MS = 60000;
   /** Delay applied to new latency tracks. */
   public static final long DEFAULT_LATENCY_MS = 1000;

   /** Delay applied to the mocked response, in milliseconds, keyframed over the experiment timeline. */
   private ParameterCurve latencyMs = ParameterCurve.constant(DEFAULT_LATENCY_MS);

   @Override
   public ModifierType getType() {
      return ModifierType.LATENCY;
   }

   @Override
   public void validate(long durationMs) {
      latencyMs.validate("Latency", durationMs);
      for (Keyframe keyframe : latencyMs.getKeyframes()) {
         if (keyframe.getValue() < 0 || keyframe.getValue() > MAX_LATENCY_MS) {
            throw new InvalidExperimentException("LATENCY latencyMs must be between 0 and " + MAX_LATENCY_MS);
         }
      }
   }

   public ParameterCurve getLatencyMs() {
      return latencyMs;
   }

   public void setLatencyMs(ParameterCurve latencyMs) {
      this.latencyMs = latencyMs != null ? latencyMs : ParameterCurve.constant(DEFAULT_LATENCY_MS);
   }
}
