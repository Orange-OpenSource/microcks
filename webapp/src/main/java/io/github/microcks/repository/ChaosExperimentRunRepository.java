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
package io.github.microcks.repository;

import io.github.microcks.domain.chaos.ExperimentRun;
import io.github.microcks.domain.chaos.ExperimentState;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for the runs of chaos experiments. There is at most one run per experiment.
 */
public interface ChaosExperimentRunRepository extends MongoRepository<ExperimentRun, String> {

   Optional<ExperimentRun> findByExperimentId(String experimentId);

   List<ExperimentRun> findByExperimentIdIn(List<String> experimentIds);

   List<ExperimentRun> findByStateIn(List<ExperimentState> states);
}
