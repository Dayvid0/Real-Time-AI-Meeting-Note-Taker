import type { SessionView } from './session-view';
import { formatTime } from './transcript';

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[<>]/g, char => char === '<' ? '&lt;' : '&gt;')
    .replace(/([`*_{}\[\]#!|])/g, '\\$1');
}
export function exportMarkdown(meeting: SessionView): string {
  const lines = [`# ${escape(meeting.title)}`, '',
    `Date: ${meeting.startedAt === null ? 'Unknown' : new Date(meeting.startedAt).toISOString()}`, ''];
  const notes = meeting.notes.final;
  if (notes) {
    lines.push('## Summary', '', escape(notes.summary), '');
    if (notes.partial) lines.push('> These notes cover only part of the meeting. Review the transcript.', '');
    lines.push('## Decisions', '', ...(notes.decisions.length ? notes.decisions.map(item => `- ${escape(item)}`) : ['- No decisions identified.']), '');
    lines.push('## Action items', '', ...(notes.actionItems.length ? notes.actionItems.map(item =>
      `- [ ] **${escape(item.owner)}:** ${escape(item.task)}${item.due ? ` (Due: ${escape(item.due)})` : ''}`) : ['- No action items identified.']), '');
  } else lines.push('## Notes', '', 'Final notes unavailable. The transcript is preserved below.', '');
  lines.push('## Transcript', '');
  for (const line of meeting.transcript.lines) {
    if (line.type === 'gap') lines.push(`> Audio gap: ${escape(line.message)}`, '');
    else lines.push(`**${formatTime(line.startMs)} · ${line.speaker === 'local' ? 'You' : 'Others'}${line.final ? '' : ' (unconfirmed)'}**`, '', escape(line.text), '');
  }
  return lines.join('\n');
}
export function exportFilename(meeting: SessionView): string {
  const title = meeting.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'meeting-notes';
  return `${title}.md`;
}
