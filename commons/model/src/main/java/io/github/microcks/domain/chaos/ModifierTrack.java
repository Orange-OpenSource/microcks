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
 * A modifier track: a service/operation target, a modifier configuration and an occurrence probability curve. The
 * target names support the {@code *} wildcard: {@code *} alone matches any service or operation, and a trailing
 * {@code *} (eg {@code POST /payments*}) matches any name starting with the given prefix. The track is only active
 * inside its {@code [startMs, endMs)} window; the probability curve expresses the fault intensity within that window
 * and is not evaluated outside of it.
 */
public class ModifierTrack {

   private String id;
   private String serviceName;
   private String operationName;
   private long startMs;
   private long endMs;
   private ParameterCurve probability = ParameterCurve.constant(0);
   private ModifierConfig modifier = new HttpErrorModifierConfig();

   public ModifierTrack() {
   }

   /**
    * Validate this track against the experiment duration. This method has no side effect: an {@code endMs} of zero or
    * less is rejected, and callers persisting a track are expected to resolve a missing end against the experiment
    * duration beforehand.
    */
   public void validate(long durationMs) {
      if (id == null || id.isBlank()) {
         throw new InvalidExperimentException("Every modifier track must have a non-blank id");
      }
      if (serviceName == null || serviceName.isBlank() || operationName == null || operationName.isBlank()) {
         throw new InvalidExperimentException(
               "Modifier track " + id + " must target a service name and operation name");
      }
      if (startMs < 0) {
         throw new InvalidExperimentException("Modifier track " + id + " cannot start before the experiment beginning");
      }
      if (endMs <= 0) {
         throw new InvalidExperimentException("Modifier track " + id + " must have an end within the experiment");
      }
      if (endMs > durationMs) {
         throw new InvalidExperimentException("Modifier track " + id + " cannot end after the experiment end");
      }
      if (startMs >= endMs) {
         throw new InvalidExperimentException("Modifier track " + id + " must start strictly before its end");
      }
      if (probability == null) {
         throw new InvalidExperimentException("Modifier track " + id + " has no probability curve");
      }
      probability.validate("probability of " + id, durationMs);
      for (Keyframe keyframe : probability.getKeyframes()) {
         if (keyframe.getValue() < 0 || keyframe.getValue() > 1) {
            throw new InvalidExperimentException("Probability for track " + id + " must be in [0,1]");
         }
      }
      if (modifier == null) {
         throw new InvalidExperimentException("Modifier track " + id + " has no modifier");
      }
      modifier.validate(durationMs);
   }

   /**
    * Evaluate the track activation probability at a timeline position: 0 outside the {@code [startMs, endMs)} window,
    * the probability curve value inside it.
    */
   public double probabilityAt(long positionMs) {
      if (positionMs < startMs || positionMs >= endMs) {
         return 0;
      }
      return probability.valueAt(positionMs);
   }

   public String getId() {
      return id;
   }

   public void setId(String id) {
      this.id = id;
   }

   public String getServiceName() {
      return serviceName;
   }

   public void setServiceName(String serviceName) {
      this.serviceName = serviceName;
   }

   public String getOperationName() {
      return operationName;
   }

   public void setOperationName(String operationName) {
      this.operationName = operationName;
   }

   public long getStartMs() {
      return startMs;
   }

   public void setStartMs(long startMs) {
      this.startMs = startMs;
   }

   public long getEndMs() {
      return endMs;
   }

   public void setEndMs(long endMs) {
      this.endMs = endMs;
   }

   public ParameterCurve getProbability() {
      return probability;
   }

   public void setProbability(ParameterCurve probability) {
      this.probability = probability != null ? probability : ParameterCurve.constant(0);
   }

   public ModifierConfig getModifier() {
      return modifier;
   }

   public void setModifier(ModifierConfig modifier) {
      this.modifier = modifier != null ? modifier : new HttpErrorModifierConfig();
   }
}
