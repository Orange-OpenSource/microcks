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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * A keyframed parameter curve using step semantics: the latest keyframe on or before the requested position wins.
 */
public class ParameterCurve {

   private List<Keyframe> keyframes = new ArrayList<>();

   public ParameterCurve() {
   }

   public ParameterCurve(List<Keyframe> keyframes) {
      this.keyframes = keyframes != null ? keyframes : new ArrayList<>();
   }

   public static ParameterCurve constant(double value) {
      return new ParameterCurve(List.of(new Keyframe(0, value)));
   }

   public List<Keyframe> getKeyframes() {
      return keyframes;
   }

   public void setKeyframes(List<Keyframe> keyframes) {
      this.keyframes = keyframes != null ? keyframes : new ArrayList<>();
   }

   /** Return a sorted, defensive copy of the keyframes. */
   public List<Keyframe> sortedKeyframes() {
      List<Keyframe> sorted = new ArrayList<>(keyframes);
      sorted.sort(Comparator.comparingLong(Keyframe::getTimeMs));
      return sorted;
   }

   /** Evaluate the numeric curve at the supplied timeline position. */
   public double valueAt(long positionMs) {
      List<Keyframe> sorted = sortedKeyframes();
      if (sorted.isEmpty()) {
         return 0;
      }
      double value = sorted.get(0).getValue();
      for (Keyframe keyframe : sorted) {
         if (keyframe.getTimeMs() > positionMs) {
            break;
         }
         value = keyframe.getValue();
      }
      return value;
   }

   /**
    * Validate this curve against the experiment duration.
    * @param name       Name of the parameter, used in error messages
    * @param durationMs Experiment duration
    */
   public void validate(String name, long durationMs) {
      if (durationMs <= 0) {
         throw new InvalidExperimentException("Experiment durationMs must be strictly positive");
      }
      List<Keyframe> sorted = sortedKeyframes();
      long previous = -1;
      for (Keyframe keyframe : sorted) {
         if (keyframe.getTimeMs() < 0 || keyframe.getTimeMs() > durationMs) {
            throw new InvalidExperimentException(
                  "Keyframe timeMs for " + name + " must be between 0 and " + durationMs);
         }
         if (keyframe.getTimeMs() == previous) {
            throw new InvalidExperimentException("Duplicate keyframe timeMs for " + name + ": " + previous);
         }
         if (!Double.isFinite(keyframe.getValue())) {
            throw new InvalidExperimentException("Keyframe value for " + name + " must be finite");
         }
         previous = keyframe.getTimeMs();
      }
   }
}
