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

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * Wiring of the chaos runtime. The wall clock is exposed as a single bean: the control plane anchors and the runtime
 * playhead both read from it, so time can be frozen consistently for the whole feature.
 */
@Configuration
public class ChaosConfiguration {

   /** The wall clock of the chaos feature. */
   @Bean
   public Clock clock() {
      return Clock.systemUTC();
   }
}
