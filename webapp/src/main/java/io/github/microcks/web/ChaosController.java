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
package io.github.microcks.web;

import io.github.microcks.chaos.ChaosModifierDescriptor;
import io.github.microcks.chaos.modifier.FaultModifier;
import io.github.microcks.domain.chaos.ChaosExperiment;
import io.github.microcks.domain.chaos.ExperimentRun;
import io.github.microcks.domain.chaos.ExperimentState;
import io.github.microcks.domain.chaos.InvalidExperimentException;
import io.github.microcks.service.ChaosExperimentService;
import io.github.microcks.service.ChaosExperimentService.ExperimentNotFoundException;
import io.github.microcks.service.ChaosExperimentService.ExperimentWithRun;
import io.github.microcks.web.dto.ChaosExperimentDTO;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Management API for chaos experiments. The routes are intentionally separated from the mock-facing controller and are
 * protected by the API security filter chain. Create and update bind to the {@link ChaosExperiment} definition; the run
 * state of the current execution is composed back into {@link ChaosExperimentDTO} responses.
 */
@RestController
@RequestMapping("/api/chaos")
public class ChaosController {

   private final ChaosExperimentService experimentService;
   private final List<FaultModifier> faultModifiers;

   public ChaosController(ChaosExperimentService experimentService, List<FaultModifier> faultModifiers) {
      this.experimentService = experimentService;
      this.faultModifiers = faultModifiers;
   }

   @PostMapping("/experiments")
   public ResponseEntity<ChaosExperimentDTO> create(@RequestBody ChaosExperiment definition) {
      return ResponseEntity.status(HttpStatus.CREATED).body(toDto(experimentService.create(definition)));
   }

   @GetMapping("/experiments")
   public List<ChaosExperimentDTO> list(@RequestParam(value = "state", required = false) ExperimentState state) {
      return experimentService.findByState(state).stream().map(this::toDto).toList();
   }

   @GetMapping("/experiments/{id}")
   public ChaosExperimentDTO get(@PathVariable("id") String id) {
      return toDto(experimentService.get(id));
   }

   @PutMapping("/experiments/{id}")
   public ChaosExperimentDTO update(@PathVariable("id") String id, @RequestBody ChaosExperiment definition) {
      return toDto(experimentService.update(id, definition));
   }

   @DeleteMapping("/experiments/{id}")
   public ResponseEntity<Void> delete(@PathVariable("id") String id) {
      experimentService.delete(id);
      return ResponseEntity.noContent().build();
   }

   @PostMapping("/experiments/{id}/start")
   public ChaosExperimentDTO start(@PathVariable("id") String id) {
      return toDto(experimentService.start(id));
   }

   @PostMapping("/experiments/{id}/stop")
   public ChaosExperimentDTO stop(@PathVariable("id") String id) {
      return toDto(experimentService.stop(id));
   }

   @GetMapping("/modifiers")
   public List<ChaosModifierDescriptor> modifiers() {
      return faultModifiers.stream().map(FaultModifier::descriptor).toList();
   }

   @ExceptionHandler(ExperimentNotFoundException.class)
   public ResponseEntity<Map<String, String>> notFound(ExperimentNotFoundException e) {
      return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
   }

   @ExceptionHandler(InvalidExperimentException.class)
   public ResponseEntity<Map<String, String>> badRequest(InvalidExperimentException e) {
      return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
   }

   /** Map a definition composed with its run to the flat API representation. */
   private ChaosExperimentDTO toDto(ExperimentWithRun result) {
      ChaosExperiment definition = result.experiment();
      ExperimentRun run = result.run();
      ExperimentState state = run != null ? run.getState() : ExperimentState.STOPPED;
      long anchorPositionMs = run != null ? run.getAnchorPositionMs() : 0;
      Instant anchorWallTime = run != null ? run.getAnchorWallTime() : null;
      return new ChaosExperimentDTO(definition.getId(), definition.getName(), definition.getDescription(),
            definition.getDurationMs(), definition.getTracks(), state, anchorPositionMs, anchorWallTime,
            result.currentPositionMs());
   }
}
