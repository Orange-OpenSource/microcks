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

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A persisted chaos experiment definition: the reusable timeline of modifier tracks, independent of any run. The
 * lifecycle state and clock anchors of the current run live in {@link ExperimentRun}, so a definition can be edited
 * without carrying run state along. The document is intentionally kept out of the imported {@code Operation} model.
 */
@Document(collection = "chaos_experiments")
public class ChaosExperiment {

   @Id
   private String id;
   @Indexed
   private String name;
   private String description;
   private long durationMs;
   private List<ModifierTrack> tracks = new ArrayList<>();

   public ChaosExperiment() {
   }

   /** Maximum supported experiment duration. */
   public static final long MAX_DURATION_MS = 24L * 60 * 60 * 1000;

   /** Validate this experiment and all of its tracks. */
   public void validate() {
      if (durationMs <= 0 || durationMs > MAX_DURATION_MS) {
         throw new InvalidExperimentException("durationMs must be between 1 and " + MAX_DURATION_MS + " milliseconds");
      }
      for (ModifierTrack track : tracks) {
         // Track validation rejects blank ids; duplicate detection can then rely on the ids.
         track.validate(durationMs);
      }
      Set<String> identifiers = new HashSet<>();
      for (ModifierTrack track : tracks) {
         if (!identifiers.add(track.getId())) {
            throw new InvalidExperimentException("Duplicate modifier track id: " + track.getId());
         }
      }
   }

   public String getId() {
      return id;
   }

   public void setId(String id) {
      this.id = id;
   }

   public String getName() {
      return name;
   }

   public void setName(String name) {
      this.name = name;
   }

   public String getDescription() {
      return description;
   }

   public void setDescription(String description) {
      this.description = description;
   }

   public long getDurationMs() {
      return durationMs;
   }

   public void setDurationMs(long durationMs) {
      this.durationMs = durationMs;
   }

   public List<ModifierTrack> getTracks() {
      return tracks;
   }

   public void setTracks(List<ModifierTrack> tracks) {
      this.tracks = tracks != null ? tracks : new ArrayList<>();
   }
}
