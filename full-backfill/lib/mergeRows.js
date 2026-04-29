import { formatThreadBlock } from '../../slack-backfill/lib/slackParser.js';

export function buildSybillRows(autoAssigned, reviewAssigned) {
  return [...autoAssigned, ...reviewAssigned].map(({ meeting, client }) => ({
    targetClient: client,
    fields: {
      'Engagement Date': meeting.date,
      'Type of Engagement': 'Meeting',
      'Meeting Name': meeting.title,
      'Attendees': meeting.attendees,
      'Summary': meeting.summary,
      'Action Items': meeting.actionItems,
      'Slack Message': '',
    },
  }));
}

export function buildSlackRows(slackAssignments, slackSummaries) {
  const result = [];
  for (let i = 0; i < slackAssignments.length; i++) {
    const a = slackAssignments[i];
    const s = slackSummaries[i];
    if (!a.targetClient || !a.eligible || !a.bucket || !s?.summary) continue;
    result.push({
      targetClient: a.targetClient,
      fields: {
        'Engagement Date': a.date,
        'Type of Engagement': 'Slack messages',
        'Meeting Name': '',
        'Attendees': '',
        'Summary': s.summary,
        'Action Items': '',
        'Slack Message': formatThreadBlock(a.bucket),
      },
    });
  }
  return result;
}
