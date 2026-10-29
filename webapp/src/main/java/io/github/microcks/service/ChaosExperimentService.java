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
package io.github.microcks.service;

import io.github.microcks.chaos.ChaosExperimentClock;
import io.github.microcks.domain.chaos.ChaosExperiment;
import io.github.microcks.domain.chaos.ExperimentRun;
import io.github.microcks.domain.chaos.ExperimentState;
import io.github.microcks.domain.chaos.InvalidExperimentException;
import io.github.microcks.domain.chaos.ModifierTrack;
import io.github.microcks.repository.ChaosExperimentRepository;
import io.github.microcks.repository.ChaosExperimentRunRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Control-plane service for chaos experiments. It owns lifecycle transitions, validation and persistence: definitions
 * in {@link ChaosExperimentRepository}, current runs in {@link ChaosExperimentRunRepository}.
 */
@Service
public class ChaosExperimentService {

   private static final Logger log = LoggerFactory.getLogger(ChaosExperimentService.class);

   private final ChaosExperimentRepository repository;
   private final ChaosExperimentRunRepository runRepository;
   private final ChaosExperimentClock clock;

   public ChaosExperimentService(ChaosExperimentRepository repository, ChaosExperimentRunRepository runRepository,
         ChaosExperimentClock clock) {
      this.repository = repository;
      this.runRepository = runRepository;
      this.clock = clock;
   }

   public List<ExperimentWithRun> findAll() {
      List<ChaosExperiment> definitions = repository.findAll();
      List<ExperimentRun> runs = runRepository
            .findByExperimentIdIn(definitions.stream().map(ChaosExperiment::getId).toList());
      return withRuns(definitions, runs);
   }

   public List<ExperimentWithRun> findByState(ExperimentState state) {
      if (state == null) {
         return findAll();
      }
      List<ExperimentRun> runs = runRepository.findByStateIn(List.of(state));
      Map<String, ChaosExperiment> definitions = repository
            .findAllById(runs.stream().map(ExperimentRun::getExperimentId).toList()).stream()
            .collect(Collectors.toMap(ChaosExperiment::getId, Function.identity()));
      return runs.stream().filter(run -> definitions.containsKey(run.getExperimentId()))
            .map(run -> snapshot(definitions.get(run.getExperimentId()), run)).toList();
   }

   public ExperimentWithRun get(String id) {
      ChaosExperiment definition = repository.findById(id)
            .orElseThrow(() -> new ExperimentNotFoundException("Experiment " + id + " does not exist"));
      return snapshot(definition, runRepository.findByExperimentId(id).orElse(null));
   }

   public ExperimentWithRun create(ChaosExperiment definition) {
      if (definition.getName() == null || definition.getName().isBlank()) {
         throw new InvalidExperimentException("Experiment name is required");
      }
      if (repository.findByName(definition.getName()).isPresent()) {
         throw new InvalidExperimentException("An experiment named " + definition.getName() + " already exists");
      }
      definition.setId(null);
      resolveTrackWindows(definition);
      definition.validate();
      ChaosExperiment saved = repository.save(definition);
      log.info("Created chaos experiment [{}]", saved.getName());
      return snapshot(saved, null);
   }

   public ExperimentWithRun update(String id, ChaosExperiment replacement) {
      ChaosExperiment existing = repository.findById(id)
            .orElseThrow(() -> new ExperimentNotFoundException("Experiment " + id + " does not exist"));
      if (replacement.getName() != null && !replacement.getName().equals(existing.getName())) {
         Optional<ChaosExperiment> byName = repository.findByName(replacement.getName());
         if (byName.isPresent() && !byName.get().getId().equals(id)) {
            throw new InvalidExperimentException("An experiment named " + replacement.getName() + " already exists");
         }
      }
      existing.setName(replacement.getName() != null ? replacement.getName() : existing.getName());
      existing.setDescription(replacement.getDescription());
      existing.setDurationMs(replacement.getDurationMs());
      existing.setTracks(replacement.getTracks());
      resolveTrackWindows(existing);
      existing.validate();
      ChaosExperiment saved = repository.save(existing);
      return snapshot(saved, runRepository.findByExperimentId(id).orElse(null));
   }

   public ExperimentWithRun start(String id) {
      ChaosExperiment definition = repository.findById(id)
            .orElseThrow(() -> new ExperimentNotFoundException("Experiment " + id + " does not exist"));
      ExperimentRun run = runRepository.findByExperimentId(id)
            .orElseGet(() -> new ExperimentRun(id, ExperimentState.STOPPED, 0, null));
      if (run.getState() == ExperimentState.RUNNING) {
         return snapshot(definition, run);
      }
      run.setState(ExperimentState.RUNNING);
      run.setAnchorPositionMs(0);
      run.setAnchorWallTime(clock.now());
      runRepository.save(run);
      log.info("Started chaos experiment [{}]", definition.getName());
      return snapshot(definition, run);
   }

   public ExperimentWithRun stop(String id) {
      ChaosExperiment definition = repository.findById(id)
            .orElseThrow(() -> new ExperimentNotFoundException("Experiment " + id + " does not exist"));
      ExperimentRun run = runRepository.findByExperimentId(id).orElse(null);
      if (run == null || run.getState() != ExperimentState.RUNNING) {
         // Nothing to stop: the experiment never started or its run is already stopped.
         return snapshot(definition, run);
      }
      long position = clock.positionAt(run, definition.getDurationMs());
      run.setState(ExperimentState.STOPPED);
      run.setAnchorPositionMs(position);
      run.setAnchorWallTime(null);
      runRepository.save(run);
      log.info("Stopped chaos experiment [{}] at position [{}] ms", definition.getName(), position);
      return snapshot(definition, run);
   }

   public void delete(String id) {
      ChaosExperiment definition = repository.findById(id)
            .orElseThrow(() -> new ExperimentNotFoundException("Experiment " + id + " does not exist"));
      repository.delete(definition);
      runRepository.findByExperimentId(id).ifPresent(runRepository::delete);
      log.info("Deleted chaos experiment [{}]", definition.getName());
   }

   /** Compose definitions with their runs, preserving the order of the definitions. */
   private List<ExperimentWithRun> withRuns(List<ChaosExperiment> definitions, List<ExperimentRun> runs) {
      Map<String, ExperimentRun> byExperimentId = runs.stream()
            .collect(Collectors.toMap(ExperimentRun::getExperimentId, Function.identity()));
      return definitions.stream().map(definition -> snapshot(definition, byExperimentId.get(definition.getId())))
            .toList();
   }

   /** Resolve missing track windows against the experiment duration: an end of zero or less means the end. */
   private void resolveTrackWindows(ChaosExperiment definition) {
      for (ModifierTrack track : definition.getTracks()) {
         if (track.getEndMs() <= 0) {
            track.setEndMs(definition.getDurationMs());
         }
      }
   }

   /** Compose a definition with its run (nullable when the experiment never started) and its current position. */
   private ExperimentWithRun snapshot(ChaosExperiment definition, ExperimentRun run) {
      long position = run != null ? clock.positionAt(run, definition.getDurationMs()) : 0;
      return new ExperimentWithRun(definition, run, position);
   }

   /** A definition composed with its current run and the timeline position computed at read time. */
   public record ExperimentWithRun(ChaosExperiment experiment, ExperimentRun run, long currentPositionMs) {
   }

   /** Thrown when an experiment cannot be found. */
   public static class ExperimentNotFoundException extends RuntimeException {
      public ExperimentNotFoundException(String message) {
         super(message);
      }
   }
}
