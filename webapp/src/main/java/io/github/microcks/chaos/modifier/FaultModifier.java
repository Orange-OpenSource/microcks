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
import io.github.microcks.domain.chaos.ModifierConfig;
import io.github.microcks.domain.chaos.ModifierType;

import org.springframework.http.ResponseEntity;

/**
 * Runtime implementation of a chaos modifier. Every implementation must describe itself through {@link #descriptor()}:
 * it feeds the management API (GET /api/chaos/modifiers) so editors render the modifier catalog, its parameter rows and
 * their constraints without hardcoding modifier types.
 */
public interface FaultModifier {

   ModifierType type();

   /**
    * Full description of the modifier served to editors: type, human label, editable parameters (probability first,
    * with their bounds and defaults) and supported interpolation modes.
    */
   ChaosModifierDescriptor descriptor();

   ResponseEntity<byte[]> inject(ModifierConfig modifier, long positionMs, ResponseEntity<byte[]> response);
}
