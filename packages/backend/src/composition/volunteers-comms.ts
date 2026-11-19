import type { CreateAppOptions } from "../app.js";
import {
	type CommunicationRepository,
	InMemoryCommunicationRepository,
} from "../communication/communication-repository.js";
import { CommunicationService } from "../communication/communication-service.js";
import { PostgresCommunicationRepository } from "../communication/postgres-communication-repository.js";
import type { AppEnv } from "../config/env.js";
import { PostgresVolunteerRepository } from "../volunteers/postgres-volunteer-repository.js";
import {
	InMemoryVolunteerRepository,
	type VolunteerRepository,
} from "../volunteers/volunteer-repository.js";

export interface VolunteersCommsComposition {
	volunteerRepository: VolunteerRepository;
	communicationRepository: CommunicationRepository;
	communicationService: CommunicationService;
}

export async function createVolunteersCommsComposition(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<VolunteersCommsComposition> {
	const volunteerRepository =
		options.volunteerRepository ??
		(env.databaseSchema
			? new PostgresVolunteerRepository(env.databaseSchema)
			: new InMemoryVolunteerRepository());
	if (volunteerRepository instanceof PostgresVolunteerRepository) {
		await volunteerRepository.ensureReady();
	}

	const communicationRepository =
		options.communicationRepository ??
		(env.databaseSchema
			? new PostgresCommunicationRepository(env.databaseSchema)
			: new InMemoryCommunicationRepository());
	if (communicationRepository instanceof PostgresCommunicationRepository) {
		await communicationRepository.ensureReady();
	}

	const communicationService =
		options.communicationService ??
		new CommunicationService({
			repository: communicationRepository,
		});

	return {
		volunteerRepository,
		communicationRepository,
		communicationService,
	};
}
