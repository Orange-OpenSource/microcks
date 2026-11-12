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

import io.github.microcks.domain.chaos.ChaosExperiment;
import io.github.microcks.domain.chaos.ExperimentState;
import io.github.microcks.domain.chaos.HttpErrorModifierConfig;
import io.github.microcks.domain.chaos.InvalidExperimentException;
import io.github.microcks.domain.chaos.Keyframe;
import io.github.microcks.domain.chaos.LatencyModifierConfig;
import io.github.microcks.domain.chaos.ModifierTrack;
import io.github.microcks.domain.chaos.ParameterCurve;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Unit tests for experiment validation, track matching and clock. */
class ChaosTimelineTest {


   @Test
   void testClockHonorsStateAnchors() {
      ChaosExperimentClock clock = new ChaosExperimentClock(Clock.systemUTC());
      Instant now = Instant.parse("2026-10-23T12:00:10Z");
      assertEquals(10_000,
            clock.positionAt(ExperimentState.RUNNING, 0, Instant.parse("2026-10-23T12:00:00Z"), 120_000, now));
      assertEquals(5_000, clock.positionAt(ExperimentState.STOPPED, 5_000, null, 120_000, now));
   }

   @Test
   void testRunningExperimentLoopsOverItsDuration() {
      ChaosExperimentClock clock = new ChaosExperimentClock(Clock.systemUTC());
      Instant start = Instant.parse("2026-10-23T12:00:00Z");
      // 130s into a 120s experiment: the position wrapped back to 10s.
      assertEquals(10_000, clock.positionAt(ExperimentState.RUNNING, 0, start, 120_000, start.plusSeconds(130)));
      // Exactly at the end of a cycle, the position wraps back to the beginning.
      assertEquals(0, clock.positionAt(ExperimentState.RUNNING, 0, start, 120_000, start.plusSeconds(120)));
   }

   @Test
   void testValidatorAcceptsAValidExperiment() {
      assertDoesNotThrow(() -> experiment().validate());
   }

   @Test
   void testValidatorRejectsInvalidHttpStatus() {
      ChaosExperiment experiment = experiment();
      HttpErrorModifierConfig modifier = (HttpErrorModifierConfig) experiment.getTracks().get(0).getModifier();
      modifier.setStatusCode(ParameterCurve.constant(200));

      assertThrows(InvalidExperimentException.class, experiment::validate);
   }

   @Test
   void testValidatorRejectsInvalidLatency() {
      ModifierTrack track = new ModifierTrack();
      track.setId("payment-latency");
      track.setServiceName("Payment");
      track.setOperationName("POST /payments");
      track.setEndMs(120_000);
      track.setProbability(ParameterCurve.constant(1));
      LatencyModifierConfig modifier = new LatencyModifierConfig();
      modifier.setLatencyMs(ParameterCurve.constant(70_000));
      track.setModifier(modifier);

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setId("exp-1");
      experiment.setName("payment-latency");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));

      assertThrows(InvalidExperimentException.class, experiment::validate);
   }

   @Test
   void testValidatorRejectsMissingEnd() {
      // Validation is pure: a missing end is rejected, the service resolves it to the duration before persisting.
      ModifierTrack track = experiment().getTracks().get(0);
      track.setEndMs(0);
      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setId("exp-1");
      experiment.setName("missing-end");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));

      assertThrows(InvalidExperimentException.class, experiment::validate);
      assertEquals(0, track.getEndMs());
   }

   @Test
   void testTrackMatchesServiceAndOperation() {
      ModifierTrack track = experiment().getTracks().get(0);

      assertTrue(FaultInjector.matches(track, "Payment", "POST /payments"));
      assertEquals(1.0, track.getProbability().valueAt(45_000), 0.0001);
      assertEquals(503, ((HttpErrorModifierConfig) track.getModifier()).statusCodeAt(45_000));
   }

   @Test
   void testNonMatchingOperationIsSkipped() {
      ModifierTrack track = experiment().getTracks().get(0);
      assertFalse(FaultInjector.matches(track, "Payment", "POST /refunds"));
   }

   @Test
   void testWildcardMatchesEveryServiceAndOperation() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setServiceName("*");
      track.setOperationName("*");

      assertTrue(FaultInjector.matches(track, "Payment", "POST /payments"));
      assertTrue(FaultInjector.matches(track, "Catalog", "GET /products"));
      assertTrue(FaultInjector.matches(track, null, null));
   }

   @Test
   void testWildcardOperationMatchesEveryOperationOfTheService() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setServiceName("Payment");
      track.setOperationName("*");

      assertTrue(FaultInjector.matches(track, "payment", "POST /payments"));
      assertTrue(FaultInjector.matches(track, "Payment", "GET /payments/{id}"));
      assertFalse(FaultInjector.matches(track, "Catalog", "GET /products"));
   }

   @Test
   void testWildcardServiceMatchesEveryServiceForExactOperation() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setServiceName("*");
      track.setOperationName("POST /payments");

      assertTrue(FaultInjector.matches(track, "Payment", "POST /payments"));
      assertTrue(FaultInjector.matches(track, "Catalog", "POST /payments"));
      assertFalse(FaultInjector.matches(track, "Payment", "POST /refunds"));
   }

   @Test
   void testTrailingWildcardMatchesOperationPrefix() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setServiceName("Payment");
      track.setOperationName("POST /pay*");

      assertTrue(FaultInjector.matches(track, "Payment", "POST /payments"));
      assertTrue(FaultInjector.matches(track, "Payment", "POST /pay"));
      assertFalse(FaultInjector.matches(track, "Payment", "POST /refunds"));

      track.setOperationName("GET *");
      assertTrue(FaultInjector.matches(track, "Payment", "get /payments"));
      assertFalse(FaultInjector.matches(track, "Payment", "POST /payments"));
   }

   @Test
   void testZeroProbabilityRemainsEvaluableButInactive() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setProbability(ParameterCurve.constant(0));

      assertEquals(0, track.getProbability().valueAt(45_000), 0.0001);
   }

   @Test
   void testProbabilityAtHonorsWindow() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setStartMs(20_000);
      track.setEndMs(30_000);

      assertEquals(0.0, track.probabilityAt(5_000), 0.0001);
      assertEquals(1.0, track.probabilityAt(20_000), 0.0001);
      assertEquals(1.0, track.probabilityAt(20_500), 0.0001);
      assertEquals(0.0, track.probabilityAt(30_000), 0.0001);
   }

   @Test
   void testValidatorRejectsInvertedWindow() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setStartMs(30_000);
      track.setEndMs(20_000);

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setId("exp-1");
      experiment.setName("inverted-window");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));

      assertThrows(InvalidExperimentException.class, experiment::validate);
   }

   @Test
   void testValidatorRejectsWindowBeyondDuration() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setEndMs(200_000);

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setId("exp-1");
      experiment.setName("window-beyond-duration");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));

      assertThrows(InvalidExperimentException.class, experiment::validate);
   }

   @Test
   void testProbabilityAtOutsideWindowIsZero() {
      ModifierTrack track = experiment().getTracks().get(0);
      track.setStartMs(20_000);
      track.setEndMs(30_000);

      assertEquals(0.0, track.probabilityAt(5_000), 0.0001);
      assertEquals(0.0, track.probabilityAt(30_000), 0.0001);
      assertEquals(0.0, track.probabilityAt(130_000), 0.0001);
   }

   private ChaosExperiment experiment() {
      ModifierTrack track = new ModifierTrack();
      track.setId("payment-error");
      HttpErrorModifierConfig modifier = new HttpErrorModifierConfig();
      modifier.setStatusCode(ParameterCurve.constant(503));
      track.setModifier(modifier);
      track.setServiceName("Payment");
      track.setOperationName("POST /payments");
      track.setEndMs(120_000);
      track.setProbability(
            new ParameterCurve(List.of(new Keyframe(0, 0), new Keyframe(20_000, 1), new Keyframe(90_000, 0))));

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setId("exp-1");
      experiment.setName("payment-resilience");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));
      return experiment;
   }


}
