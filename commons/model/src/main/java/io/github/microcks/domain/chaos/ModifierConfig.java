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

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

/**
 * Persisted configuration of a chaos modifier.
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.EXISTING_PROPERTY, property = "type", visible = false)
@JsonSubTypes({ @JsonSubTypes.Type(value = HttpErrorModifierConfig.class, name = "HTTP_ERROR"),
      @JsonSubTypes.Type(value = LatencyModifierConfig.class, name = "LATENCY") })
public interface ModifierConfig {

   ModifierType getType();

   /**
    * Validate modifier-specific inputs against the experiment duration.
    * @param durationMs Experiment duration
    */
   default void validate(long durationMs) {
   }
}
