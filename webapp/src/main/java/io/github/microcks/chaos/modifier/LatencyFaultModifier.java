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
package io.github.microcks.chaos.modifier;

import io.github.microcks.chaos.ChaosModifierDescriptor;
import io.github.microcks.chaos.ChaosModifierParam;
import io.github.microcks.domain.chaos.LatencyModifierConfig;
import io.github.microcks.domain.chaos.ModifierConfig;
import io.github.microcks.domain.chaos.ModifierType;

import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Runtime implementation of the latency modifier: it delays the mocked response by a fixed amount of milliseconds,
 * blocking the request thread the way a slow downstream dependency would. The incoming response is returned unchanged,
 * so the modifier composes with the ones following it in track order.
 */
@Component
public class LatencyFaultModifier implements FaultModifier {

   /** Description served to editors through GET /api/chaos/modifiers; probability comes first. */
   private static final ChaosModifierDescriptor DESCRIPTOR = new ChaosModifierDescriptor(ModifierType.LATENCY.name(),
         "Latency",
         List.of(ChaosModifierParam.probability(),
               new ChaosModifierParam("latencyMs", "latency (ms)", 0d, (double) LatencyModifierConfig.MAX_LATENCY_MS,
                     true, (double) LatencyModifierConfig.DEFAULT_LATENCY_MS)),
         List.of("STEP"), "Delay the mocked response by a keyframed amount of milliseconds.");

   @Override
   public ModifierType type() {
      return ModifierType.LATENCY;
   }

   @Override
   public ChaosModifierDescriptor descriptor() {
      return DESCRIPTOR;
   }

   @Override
   public ResponseEntity<byte[]> inject(ModifierConfig config, long positionMs, ResponseEntity<byte[]> response) {
      LatencyModifierConfig modifier = (LatencyModifierConfig) config;
      long delay = Math.round(modifier.getLatencyMs().valueAt(positionMs));
      if (delay > 0) {
         try {
            Thread.sleep(delay);
         } catch (InterruptedException e) {
            // Restore the interruption and deliver the response without the full delay.
            Thread.currentThread().interrupt();
            return response;
         }
      }
      return response;
   }
}
