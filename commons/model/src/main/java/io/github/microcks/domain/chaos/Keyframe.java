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
 * A numeric keyframe in a timeline, evaluated with step semantics.
 */
public class Keyframe {

   private long timeMs;
   private double value;

   public Keyframe() {
   }

   public Keyframe(long timeMs, double value) {
      this.timeMs = timeMs;
      this.value = value;
   }

   public long getTimeMs() {
      return timeMs;
   }

   public void setTimeMs(long timeMs) {
      this.timeMs = timeMs;
   }

   public double getValue() {
      return value;
   }

   public void setValue(double value) {
      this.value = value;
   }
}
