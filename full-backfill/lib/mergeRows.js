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
    if (!a.targetClient || !a.bucket) continue;
    const s = slackSummaries[i];
    // Eligible buckets with an AI error are skipped (user chose "continue with partial").
    if (a.eligible && s?.error) continue;
    result.push({
      targetClient: a.targetClient,
      fields: {
        'Engagement Date': a.date,
        'Type of Engagement': 'Slack messages',
        'Meeting Name': '',
        'Attendees': '',
        'Summary': (a.eligible && s?.summary) ? s.summary : '',
        'Action Items': '',
        'Slack Message': formatThreadBlock(a.bucket),
      },
    });
  }
  return result;
}
