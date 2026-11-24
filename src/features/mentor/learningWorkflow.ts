import type { ApiResponse, MentorLearningModule } from '../../services/apiClient';

export async function createDraftAndRefresh(
  create: () => Promise<ApiResponse<{ module: MentorLearningModule }>>,
  refresh: () => Promise<void>
): Promise<{ module: MentorLearningModule | null; error: string | null }> {
  const result = await create();
  if (result.error || !result.data) {
    return { module: null, error: result.error || 'Module could not be created.' };
  }
  await refresh();
  return { module: result.data.module, error: null };
}

export async function publishModuleAndRefresh(
  publish: () => Promise<ApiResponse<{ module: MentorLearningModule }>>,
  refresh: (module: MentorLearningModule) => Promise<void>
): Promise<{ module: MentorLearningModule | null; error: string | null }> {
  const result = await publish();
  if (result.error || !result.data) return { module: null, error: result.error || 'Module could not be published.' };
  await refresh(result.data.module);
  return { module: result.data.module, error: null };
}
