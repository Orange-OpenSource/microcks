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

import io.github.microcks.chaos.modifier.FaultModifier;
import io.github.microcks.domain.chaos.ChaosExperiment;
import io.github.microcks.domain.chaos.ExperimentRun;
import io.github.microcks.domain.chaos.ExperimentState;
import io.github.microcks.domain.chaos.ModifierTrack;
import io.github.microcks.domain.chaos.ModifierType;
import io.github.microcks.repository.ChaosExperimentRepository;
import io.github.microcks.repository.ChaosExperimentRunRepository;
import io.github.microcks.service.OpenTelemetryResolverService;
import io.github.microcks.util.tracing.CommonAttributes;
import io.github.microcks.util.tracing.TraceUtil;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Evaluates active experiments from MongoDB on each mock request and asks the selected modifier to transform the
 * generated response. Every applied injection runs in a dedicated child span so that injected faults show up in traces.
 * The MongoDB access on the mock hot path is a known trade-off: caching will be added in a later optimization.
 */
@Component
public class FaultInjector {

   private static final Logger log = LoggerFactory.getLogger(FaultInjector.class);

   private final ChaosExperimentRepository repository;
   private final ChaosExperimentRunRepository runRepository;
   private final ChaosExperimentClock clock;
   private final OpenTelemetryResolverService opentelemetryResolverService;
   private final Map<ModifierType, FaultModifier> modifiers = new EnumMap<>(ModifierType.class);

   public FaultInjector(ChaosExperimentRepository repository, ChaosExperimentRunRepository runRepository,
         ChaosExperimentClock clock, OpenTelemetryResolverService opentelemetryResolverService,
         List<FaultModifier> faultModifiers) {
      this.repository = repository;
      this.runRepository = runRepository;
      this.clock = clock;
      this.opentelemetryResolverService = opentelemetryResolverService;
      faultModifiers.forEach(modifier -> this.modifiers.put(modifier.type(), modifier));
   }

   /**
    * Apply selected modifiers to the response in track order, tracing every injection.
    */
   public ResponseEntity<byte[]> inject(String serviceName, String operationName, ResponseEntity<byte[]> response) {
      ResponseEntity<byte[]> result = response;
      for (ActiveExperiment active : findActive()) {
         long position = clock.positionAt(active.run(), active.experiment().getDurationMs());
         for (ModifierTrack track : active.experiment().getTracks()) {
            FaultModifier modifier = modifiers.get(track.getModifier().getType());
            if (modifier == null || !matches(track, serviceName, operationName)) {
               continue;
            }
            double probability = track.probabilityAt(position);
            if (probability <= 0) {
               continue;
            }
            // ThreadLocalRandom because the shared RandomGenerator.getDefault() is not thread-safe.
            if (probability < 1 && ThreadLocalRandom.current().nextDouble() >= probability) {
               continue;
            }
            result = injectWithSpan(serviceName, operationName, active.experiment(), track, modifier, probability,
                  position, result);
         }
      }
      return result;
   }

   /** Load the running experiments: their runs first, then the matching definitions. */
   private List<ActiveExperiment> findActive() {
      List<ExperimentRun> runs = runRepository.findByStateIn(List.of(ExperimentState.RUNNING));
      if (runs.isEmpty()) {
         return List.of();
      }
      Map<String, ChaosExperiment> definitions = repository
            .findAllById(runs.stream().map(ExperimentRun::getExperimentId).toList()).stream()
            .collect(Collectors.toMap(ChaosExperiment::getId, Function.identity()));
      List<ActiveExperiment> active = new ArrayList<>();
      for (ExperimentRun run : runs) {
         ChaosExperiment definition = definitions.get(run.getExperimentId());
         if (definition != null) {
            active.add(new ActiveExperiment(definition, run));
         }
      }
      return active;
   }

   /**
    * Apply one modifier within a dedicated INTERNAL child span of the mock invocation span, marked for explain tracing
    * so that injected faults are visible and correlated in Live Traces.
    */
   private ResponseEntity<byte[]> injectWithSpan(String serviceName, String operationName, ChaosExperiment experiment,
         ModifierTrack track, FaultModifier modifier, double probability, long positionMs,
         ResponseEntity<byte[]> response) {
      Tracer tracer = opentelemetryResolverService.getOpenTelemetry().getTracer(FaultInjector.class.getName());
      Span injectionSpan = tracer.spanBuilder("chaosFaultInjection").setSpanKind(SpanKind.INTERNAL).startSpan();

      try (Scope ignored = injectionSpan.makeCurrent()) {
         TraceUtil.enableExplainTracing();
         injectionSpan.setAttribute(CommonAttributes.CHAOS_EXPERIMENT_ID, experiment.getId());
         injectionSpan.setAttribute(CommonAttributes.CHAOS_EXPERIMENT_NAME, experiment.getName());
         injectionSpan.setAttribute(CommonAttributes.CHAOS_TRACK_ID, track.getId());
         injectionSpan.setAttribute(CommonAttributes.CHAOS_FAULT_TYPE, modifier.type().name());
         injectionSpan.setAttribute(CommonAttributes.CHAOS_POSITION_MS, positionMs);
         injectionSpan.setAttribute(CommonAttributes.CHAOS_PROBABILITY, probability);

         log.info("Chaos fault [{}] injected on [{} / {}] by experiment [{}] (track [{}]) at position [{}] ms",
               modifier.type(), Objects.requireNonNullElse(serviceName, "unknown"),
               Objects.requireNonNullElse(operationName, "unknown"), experiment.getName(), track.getId(), positionMs);
         return modifier.inject(track.getModifier(), positionMs, response);
      } finally {
         injectionSpan.end();
      }
   }

   /**
    * Check whether a track target matches the requested service and operation. A target value is either the {@code *}
    * wildcard, matching any service or operation (including a null one), a {@code prefix*} pattern matching
    * case-insensitively any value starting with the prefix, or an exact case-insensitive name.
    */
   static boolean matches(ModifierTrack track, String serviceName, String operationName) {
      return matchesTarget(track.getServiceName(), serviceName)
            && matchesTarget(track.getOperationName(), operationName);
   }

   private static boolean matchesTarget(String pattern, String value) {
      if (pattern == null) {
         return false;
      }
      String trimmed = pattern.trim();
      if ("*".equals(trimmed)) {
         return true;
      }
      if (value == null) {
         return false;
      }
      if (trimmed.endsWith("*")) {
         String prefix = trimmed.substring(0, trimmed.length() - 1).toLowerCase(Locale.ROOT);
         return value.toLowerCase(Locale.ROOT).startsWith(prefix);
      }
      return trimmed.equalsIgnoreCase(value);
   }

   /** A running experiment: the definition holding the tracks and the run holding the clock anchors. */
   private record ActiveExperiment(ChaosExperiment experiment, ExperimentRun run) {
   }
}
