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

/**
 * Description of one editable input of a chaos modifier, served to the UI so the editor can render the parameter row
 * (value bounds, default and keyframability) without hardcoding modifier types.
 * @param name         Parameter name as used in the persisted modifier config (eg statusCode)
 * @param label        Human label for editors (eg status code)
 * @param min          Minimum permitted value, or null for non numeric parameters
 * @param max          Maximum permitted value, or null for non numeric parameters
 * @param keyframeable Whether the parameter accepts keyframes over the timeline
 * @param defaultValue Value applied to new tracks, or null for empty text inputs
 */
public record ChaosModifierParam(String name, String label, Double min, Double max, boolean keyframeable,
      Double defaultValue) {

   /**
    * Probability applied to new tracks in editors. It is an editing convenience, not a persistence default: a persisted
    * track without a probability curve deserializes to 0 and stays inactive.
    */
   public static final double DEFAULT_PROBABILITY = 0.8;

   /** Description of the standard, keyframeable probability parameter shared by every modifier. */
   public static ChaosModifierParam probability() {
      return new ChaosModifierParam("probability", "probability", 0d, 1d, true, DEFAULT_PROBABILITY);
   }
}
