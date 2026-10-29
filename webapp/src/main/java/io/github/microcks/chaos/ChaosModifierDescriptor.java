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

import java.util.List;

/**
 * Description of a chaos modifier type, served to the UI so the editor catalog, its parameter rows and their
 * constraints all come from the backend rather than being hardcoded in the client. The record lives with the runtime so
 * that modifiers describe themselves: the management API only aggregates what {@code FaultModifier#descriptor()}
 * provides.
 * @param type          Modifier type name (eg HTTP_ERROR)
 * @param label         Human label (eg HTTP error)
 * @param params        Editable parameters, probability first
 * @param interpolation Interpolation modes supported by this modifier's inputs
 * @param description   Human description of the fault
 */
public record ChaosModifierDescriptor(String type, String label, List<ChaosModifierParam> params,
      List<String> interpolation, String description) {
}
