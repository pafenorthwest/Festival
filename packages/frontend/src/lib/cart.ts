import type { RegistrationSelection } from "@festival/common";

export function buildSelection(classIds: string[], participantCountByClass: Record<string, number>): RegistrationSelection {
  return {
    classIds,
    participantsByClass: participantCountByClass
  };
}
