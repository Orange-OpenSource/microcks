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
 * Configuration of a synthetic HTTP error. The status code is a keyframed parameter over the experiment timeline
 * (evaluated with step semantics), while the response body is a static text.
 */
public class HttpErrorModifierConfig implements ModifierConfig {

   /** Minimum permitted HTTP status code for a synthetic error. */
   public static final int MIN_STATUS_CODE = 400;
   /** Maximum permitted HTTP status code for a synthetic error. */
   public static final int MAX_STATUS_CODE = 599;
   /** Status code applied to new synthetic errors. */
   public static final int DEFAULT_STATUS_CODE = 503;

   /** HTTP status code returned by the synthetic error response, keyframed over the experiment timeline. */
   private ParameterCurve statusCode = ParameterCurve.constant(DEFAULT_STATUS_CODE);
   private String responseBody = "";

   @Override
   public ModifierType getType() {
      return ModifierType.HTTP_ERROR;
   }

   @Override
   public void validate(long durationMs) {
      statusCode.validate("status code", durationMs);
      for (Keyframe keyframe : statusCode.getKeyframes()) {
         if (keyframe.getValue() < MIN_STATUS_CODE || keyframe.getValue() > MAX_STATUS_CODE) {
            throw new InvalidExperimentException(
                  "HTTP_ERROR statusCode must be between " + MIN_STATUS_CODE + " and " + MAX_STATUS_CODE);
         }
      }
   }

   /** Evaluate the HTTP status code at the supplied timeline position. */
   public int statusCodeAt(long positionMs) {
      return (int) Math.round(statusCode.valueAt(positionMs));
   }

   public ParameterCurve getStatusCode() {
      return statusCode;
   }

   public void setStatusCode(ParameterCurve statusCode) {
      this.statusCode = statusCode != null ? statusCode : ParameterCurve.constant(DEFAULT_STATUS_CODE);
   }

   public String getResponseBody() {
      return responseBody;
   }

   public void setResponseBody(String responseBody) {
      this.responseBody = responseBody;
   }
}
