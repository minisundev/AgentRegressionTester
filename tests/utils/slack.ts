import axios from 'axios';
import { ResultRow } from '../types/type';

export async function sendSlackReport(successes: ResultRow[], failures: ResultRow[]) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const total = successes.length + failures.length;
  const passRate = ((successes.length / total) * 100).toFixed(1);
  const statusEmoji = Number(passRate) === 100 ? '❤️' : '❤️‍🩹';

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${statusEmoji} Agent API Test Results` }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `Total: ${total}` },
        { type: "mrkdwn", text: `Successes: ${successes.length}` },
        { type: "mrkdwn", text: `Failures: ${failures.length}` },
        { type: "mrkdwn", text: `Pass Rate: ${passRate}%` }
      ]
    }
  ];

  // 실패한 케이스 요약
  if (failures.length > 0) {
    const failSummary = failures.slice(0, 5).map(f => `• [${f.id}] ${f.reason}`).join('\n');
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `Main failure reasons: \n${failSummary}` }
    });
  }

  try {
    await axios.post(webhookUrl, { blocks });
  } catch (err) {
    console.error('Failed to send Slack report', err);
  }
}