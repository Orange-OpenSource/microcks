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
import io.github.microcks.domain.chaos.HttpErrorModifierConfig;
import io.github.microcks.domain.chaos.ModifierConfig;
import io.github.microcks.domain.chaos.ModifierType;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Runtime implementation of the synthetic HTTP error modifier.
 */
@Component
public class HttpErrorFaultModifier implements FaultModifier {

   /** Description served to editors through GET /api/chaos/modifiers; probability comes first. */
   private static final ChaosModifierDescriptor DESCRIPTOR = new ChaosModifierDescriptor(ModifierType.HTTP_ERROR.name(),
         "HTTP error",
         List.of(ChaosModifierParam.probability(),
               new ChaosModifierParam("statusCode", "status code", (double) HttpErrorModifierConfig.MIN_STATUS_CODE,
                     (double) HttpErrorModifierConfig.MAX_STATUS_CODE, true,
                     (double) HttpErrorModifierConfig.DEFAULT_STATUS_CODE),
               new ChaosModifierParam("responseBody", "response body", null, null, false, null)),
         List.of("STEP"), "Return a synthetic HTTP error with a configurable status code and response body.");

   @Override
   public ModifierType type() {
      return ModifierType.HTTP_ERROR;
   }

   @Override
   public ChaosModifierDescriptor descriptor() {
      return DESCRIPTOR;
   }

   @Override
   public ResponseEntity<byte[]> inject(ModifierConfig config, long positionMs, ResponseEntity<byte[]> response) {
      HttpErrorModifierConfig modifier = (HttpErrorModifierConfig) config;
      int status = modifier.statusCodeAt(positionMs);
      String body = modifier.getResponseBody() != null ? modifier.getResponseBody() : "";
      byte[] content = body.getBytes(StandardCharsets.UTF_8);
      // Preserve the generated response headers (CORS policy, content type and mock-defined headers) and only
      // adjust the content length to the size of the synthetic body.
      HttpHeaders headers = new HttpHeaders();
      headers.addAll(response.getHeaders());
      headers.setContentLength(content.length);
      return new ResponseEntity<>(content, headers, HttpStatusCode.valueOf(status));
   }
}
