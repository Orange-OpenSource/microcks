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

/**
 * Thrown when a chaos experiment definition or one of its components does not satisfy the model constraints. It extends
 * {@link IllegalArgumentException} so that code catching invalid arguments keeps working, while allowing callers to
 * distinguish a validation rejection from a programming error.
 */
public class InvalidExperimentException extends IllegalArgumentException {

   public InvalidExperimentException(String message) {
      super(message);
   }
}
