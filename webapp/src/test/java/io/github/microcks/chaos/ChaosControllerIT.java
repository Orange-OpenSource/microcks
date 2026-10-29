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

import io.github.microcks.domain.Service;
import io.github.microcks.domain.chaos.ChaosExperiment;
import io.github.microcks.domain.chaos.HttpErrorModifierConfig;
import io.github.microcks.domain.chaos.LatencyModifierConfig;
import io.github.microcks.domain.chaos.ModifierTrack;
import io.github.microcks.domain.chaos.ParameterCurve;
import io.github.microcks.repository.ChaosExperimentRepository;
import io.github.microcks.repository.ChaosExperimentRunRepository;
import io.github.microcks.web.AbstractBaseIT;
import io.github.microcks.web.dto.ChaosExperimentDTO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for the chaos management API and REST fault injection.
 */
class ChaosControllerIT extends AbstractBaseIT {

   @Autowired
   private ChaosExperimentRepository chaosExperimentRepository;

   @Autowired
   private ChaosExperimentRunRepository chaosExperimentRunRepository;

   @AfterEach
   void cleanUp() {
      chaosExperimentRunRepository.deleteAll();
      chaosExperimentRepository.deleteAll();
   }

   @Test
   void catalogDescribesHttpErrorModifier() {
      ResponseEntity<ChaosModifierDescriptor[]> response = restTemplate.getForEntity("/api/chaos/modifiers",
            ChaosModifierDescriptor[].class);
      assertEquals(200, response.getStatusCode().value());
      ChaosModifierDescriptor[] descriptors = response.getBody();
      assertNotNull(descriptors);

      ChaosModifierDescriptor httpError = Arrays.stream(descriptors)
            .filter(descriptor -> "HTTP_ERROR".equals(descriptor.type())).findFirst().orElse(null);
      assertNotNull(httpError);

      Map<String, ChaosModifierParam> params = httpError.params().stream()
            .collect(Collectors.toMap(ChaosModifierParam::name, Function.identity()));
      assertTrue(params.get("probability").keyframeable());
      assertEquals(ChaosModifierParam.DEFAULT_PROBABILITY, params.get("probability").defaultValue());
      // The status code is a keyframed parameter with STEP semantics, bounded to synthetic error statuses.
      assertTrue(params.get("statusCode").keyframeable());
      assertEquals((double) HttpErrorModifierConfig.MIN_STATUS_CODE, params.get("statusCode").min());
      assertEquals((double) HttpErrorModifierConfig.MAX_STATUS_CODE, params.get("statusCode").max());
      assertEquals((double) HttpErrorModifierConfig.DEFAULT_STATUS_CODE, params.get("statusCode").defaultValue());
      assertFalse(params.get("responseBody").keyframeable());
   }

   @Test
   void catalogDescribesLatencyModifier() {
      ResponseEntity<ChaosModifierDescriptor[]> response = restTemplate.getForEntity("/api/chaos/modifiers",
            ChaosModifierDescriptor[].class);
      assertNotNull(response.getBody());

      ChaosModifierDescriptor latency = Arrays.stream(response.getBody())
            .filter(descriptor -> "LATENCY".equals(descriptor.type())).findFirst().orElse(null);
      assertNotNull(latency);

      Map<String, ChaosModifierParam> params = latency.params().stream()
            .collect(Collectors.toMap(ChaosModifierParam::name, Function.identity()));
      assertTrue(params.get("probability").keyframeable());
      assertTrue(params.get("latencyMs").keyframeable());
      assertEquals((double) LatencyModifierConfig.DEFAULT_LATENCY_MS, params.get("latencyMs").defaultValue());
   }

   @Test
   void testLatencyInjection() {
      uploadArtifactFile("target/test-classes/io/github/microcks/util/openapi/petstore-openapi.json", true);
      Service service = serviceRepository.findByNameAndVersion("PetStore API", "1.0.0");
      assertNotNull(service);

      ModifierTrack track = new ModifierTrack();
      track.setId("track-latency");
      track.setServiceName(service.getName());
      track.setOperationName("GET /pets");
      track.setProbability(ParameterCurve.constant(1));
      LatencyModifierConfig modifier = new LatencyModifierConfig();
      modifier.setLatencyMs(ParameterCurve.constant(500));
      track.setModifier(modifier);

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setName("chaos-latency");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));

      String experimentId = restTemplate.postForEntity("/api/chaos/experiments", experiment, ChaosExperimentDTO.class)
            .getBody().id();

      restTemplate.postForEntity("/api/chaos/experiments/" + experimentId + "/start", null, ChaosExperimentDTO.class);
      long start = System.currentTimeMillis();
      ResponseEntity<String> delayed = restTemplate.getForEntity("/rest/PetStore+API/1.0.0/pets", String.class);
      long elapsed = System.currentTimeMillis() - start;
      assertEquals(200, delayed.getStatusCode().value());
      assertTrue(elapsed >= 500, "The response should be delayed by at least 500ms but took " + elapsed + "ms");

      restTemplate.postForEntity("/api/chaos/experiments/" + experimentId + "/stop", null, ChaosExperimentDTO.class);
      long unstoppedStart = System.currentTimeMillis();
      ResponseEntity<String> normal = restTemplate.getForEntity("/rest/PetStore+API/1.0.0/pets", String.class);
      assertTrue(System.currentTimeMillis() - unstoppedStart < 500, "The response should not be delayed anymore");
      assertEquals(200, normal.getStatusCode().value());
   }

   @Test
   void testSyntheticHttpErrorAndStop() {
      uploadArtifactFile("target/test-classes/io/github/microcks/util/openapi/petstore-openapi.json", true);
      Service service = serviceRepository.findByNameAndVersion("PetStore API", "1.0.0");
      assertNotNull(service);

      ChaosExperiment experiment = experiment(service);
      ModifierTrack track = experiment.getTracks().get(0);
      ((HttpErrorModifierConfig) track.getModifier()).setStatusCode(ParameterCurve.constant(503));
      ((HttpErrorModifierConfig) track.getModifier()).setResponseBody("chaos-injected");

      ResponseEntity<ChaosExperimentDTO> created = restTemplate.postForEntity("/api/chaos/experiments", experiment,
            ChaosExperimentDTO.class);
      assertEquals(201, created.getStatusCode().value());
      assertNotNull(created.getBody());
      String experimentId = created.getBody().id();
      // A track without an explicit end is resolved against the experiment duration before persisting.
      assertEquals(120_000, created.getBody().tracks().get(0).getEndMs());

      restTemplate.postForEntity("/api/chaos/experiments/" + experimentId + "/start", null, ChaosExperimentDTO.class);
      ResponseEntity<String> faulted = restTemplate.getForEntity("/rest/PetStore+API/1.0.0/pets", String.class);
      assertEquals(503, faulted.getStatusCode().value());
      assertEquals("chaos-injected", faulted.getBody());
      // The synthetic error keeps the generated response headers (CORS policy, content type).
      assertNotNull(faulted.getHeaders().getContentType());

      restTemplate.postForEntity("/api/chaos/experiments/" + experimentId + "/stop", null, ChaosExperimentDTO.class);
      ResponseEntity<String> normal = restTemplate.getForEntity("/rest/PetStore+API/1.0.0/pets", String.class);
      assertEquals(200, normal.getStatusCode().value());
   }

   private ChaosExperiment experiment(Service service) {
      ModifierTrack track = new ModifierTrack();
      track.setId("track-http-error");
      track.setServiceName(service.getName());
      track.setOperationName("GET /pets");
      track.setProbability(ParameterCurve.constant(1));
      track.setModifier(new HttpErrorModifierConfig());

      ChaosExperiment experiment = new ChaosExperiment();
      experiment.setName("chaos-http-error");
      experiment.setDurationMs(120_000);
      experiment.setTracks(List.of(track));
      return experiment;
   }
}
