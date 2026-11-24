type LinkEntity = { id: string; ownerId: string; status: string; code: string };

export function validateDraftAssessmentModuleLink(input: {
  assessment: LinkEntity & { originModuleId?: string | null };
  module: LinkEntity;
  actorId: string;
  role: string;
  originModule?: LinkEntity | null;
  existingLinks: Array<{ moduleId: string }>;
}): { ok: true; alreadyLinked: boolean } | { ok: false; status: 403 | 409; error: string } {
  const { assessment, module } = input;
  if (assessment.ownerId !== input.actorId && input.role !== 'admin') return { ok: false, status: 403, error: 'Assessment ownership is required.' };
  if (module.ownerId !== assessment.ownerId) return { ok: false, status: 409, error: 'Assessment and module must have the same owner.' };
  if (assessment.status !== 'draft' || module.status !== 'draft') return { ok: false, status: 409, error: 'Only draft assessments can be linked to draft modules.' };
  if (assessment.originModuleId && assessment.originModuleId !== module.id
    && (!input.originModule || input.originModule.ownerId !== module.ownerId || input.originModule.code !== module.code)) {
    return { ok: false, status: 409, error: 'Assessment can link only to its origin module or a matching owned module version.' };
  }
  if (input.existingLinks.some(link => link.moduleId === module.id)) return { ok: true, alreadyLinked: true };
  if (input.existingLinks.length) return { ok: false, status: 409, error: 'Assessment is already linked to another module.' };
  return { ok: true, alreadyLinked: false };
}
