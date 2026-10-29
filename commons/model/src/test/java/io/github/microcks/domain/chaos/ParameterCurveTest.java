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

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Unit tests for step-based timeline keyframe evaluation. */
class ParameterCurveTest {

   @Test
   void testStepAndBoundaries() {
      ParameterCurve curve = new ParameterCurve(
            List.of(new Keyframe(0, 0), new Keyframe(20_000, 1), new Keyframe(90_000, 0)));
      assertEquals(0, curve.valueAt(-10));
      assertEquals(0, curve.valueAt(0));
      assertEquals(0, curve.valueAt(19_999));
      assertEquals(1, curve.valueAt(20_000));
      assertEquals(1, curve.valueAt(89_999));
      assertEquals(0, curve.valueAt(90_000));
      assertEquals(0, curve.valueAt(200_000));
   }

   @Test
   void testValidationRejectsDuplicateAndOutOfRangeKeyframes() {
      ParameterCurve duplicate = new ParameterCurve(List.of(new Keyframe(10, 1), new Keyframe(10, 2)));
      assertThrows(IllegalArgumentException.class, () -> duplicate.validate("probability", 100));

      ParameterCurve outOfRange = new ParameterCurve(List.of(new Keyframe(101, 1)));
      assertThrows(IllegalArgumentException.class, () -> outOfRange.validate("probability", 100));
   }

}
