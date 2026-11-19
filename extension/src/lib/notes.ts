export type ActionItem = { owner: string; task: string; due?: string | null };
export type FinalNotes = { summary: string; decisions: string[]; actionItems: ActionItem[]; partial: boolean };
export type SummaryState = {
  rolling: string; atMs: number; partial: boolean;
  final: FinalNotes | null; status: 'waiting' | 'ready' | 'unavailable'; reason: string;
};
export function emptyNotes(): SummaryState {
  return { rolling: '', atMs: 0, partial: false, final: null, status: 'waiting', reason: '' };
}
export function parseNotes(value: Record<string, unknown>): FinalNotes {
  if (typeof value.summary !== 'string' || value.summary.length > 6000
      || !Array.isArray(value.decisions) || value.decisions.length > 100
      || !value.decisions.every(item => typeof item === 'string')
      || !Array.isArray(value.actionItems) || value.actionItems.length > 100
      || typeof value.partial !== 'boolean') throw new Error('Invalid notes');
  for (const item of value.actionItems) {
    if (!item || typeof item !== 'object' || typeof item.owner !== 'string' || !item.owner
      || item.owner.length > 200 || typeof item.task !== 'string' || !item.task || item.task.length > 2000
      || (item.due !== undefined && item.due !== null && (typeof item.due !== 'string' || item.due.length > 200))) {
      throw new Error('Invalid action item');
    }
  }
  return { summary: value.summary, decisions: value.decisions, actionItems: value.actionItems, partial: value.partial } as FinalNotes;
}
