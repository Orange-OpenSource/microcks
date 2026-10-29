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
/** Icon of a modifier type; unknown types fall back to the generic bolt. */
export function modifierIcon(type: string): string {
  if (type === 'HTTP_ERROR') {
    return 'fa-exclamation-circle';
  }
  if (type === 'LATENCY') {
    return 'fa-hourglass-half';
  }
  return 'fa-bolt';
}
