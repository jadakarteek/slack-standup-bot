require('dotenv').config();
const { App } = require('@slack/bolt');
const { google } = require('googleapis');
const cron = require('node-cron');
// Store standup message reference per user (for today)
const standupMessageMap = new Map();
// userId -> { channel, ts }


/***********************
 * Google Sheets setup
 ***********************/
const auth = new google.auth.GoogleAuth({
  keyFile: 'google-service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });


// 👉 PUT YOUR SHEET ID HERE
const SPREADSHEET_ID = '1WVQ0qMqFjcl8tbYae9boXJyHcQp1bG2Pc8SjmPgllcc';

/***********************
 * Slack App setup
 ***********************/
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// 👉 for now (testing)
const YOUR_USER_ID = 'U0A5MEBJ4R0';

// Team members who should get standup (Slack User IDs)
const TEAM_MEMBERS = [
  'U0A5MEBJ4R0', // replace with real IDs
  // add more users here
];

function todayIST() {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
  });
}

async function hasUserSubmittedToday(username) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A:F',
  });

  const rows = res.data.values || [];
  const today = todayIST();

  return rows.some(
    (row, index) =>
      index !== 0 && // skip header
      row[0] === today &&
      row[1] === username
  );
}

async function sendStandupDM(userId) {
  const dm = await app.client.conversations.open({
    users: userId,
  });

  const result = await app.client.chat.postMessage({
    channel: dm.channel.id,
    text: '🧍 Daily Standup',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🧍 Daily Standup*\nPlease submit before 11:00 AM',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Fill Standup' },
            style: 'primary',
            action_id: 'open_standup_modal',
          },
        ],
      },
    ],
  });

  // 👇 Return channel + ts so we can update it later
  return {
    channel: dm.channel.id,
    ts: result.ts,
  };
}


/***********************
 * Open Modal
 ***********************/
app.action('open_standup_modal', async ({ ack, body, client }) => {
  await ack();

  const userId = body.user.id;
  const username = body.user.username;

  // 🚫 Check BEFORE opening modal
  const alreadySubmitted = await hasUserSubmittedToday(username);

  if (alreadySubmitted) {
    // 🔁 Update the original message to remove the button
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: '✅ Standup already submitted',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *You’ve already submitted today’s standup.*\nThanks!',
          },
        },
      ],
    });

    return; // ❌ Do NOT open modal
  }

  // ✅ Otherwise, open modal
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'standup_modal',
      title: {
        type: 'plain_text',
        text: 'Daily Standup',
      },
      submit: {
        type: 'plain_text',
        text: 'Submit',
      },
      blocks: [
        {
          type: 'input',
          block_id: 'yesterday',
          label: {
            type: 'plain_text',
            text: 'Yesterday',
          },
          element: {
            type: 'plain_text_input',
            multiline: true,
            action_id: 'value',
          },
        },
        {
          type: 'input',
          block_id: 'today',
          label: {
            type: 'plain_text',
            text: 'Today',
          },
          element: {
            type: 'plain_text_input',
            multiline: true,
            action_id: 'value',
          },
        },
        {
          type: 'input',
          block_id: 'blockers',
          label: {
            type: 'plain_text',
            text: 'Blockers',
          },
          element: {
            type: 'plain_text_input',
            multiline: true,
            action_id: 'value',
          },
        },
      ],
    },
  });
});
app.view('standup_modal', async ({ ack, body, view }) => {
  await ack();

  const username = body.user.username;
  const values = view.state.values;

  const yesterday = values.yesterday.value.value;
  const today = values.today.value.value;
  const blockers = values.blockers.value.value;

  const date = todayIST();
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A:F',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[date, username, yesterday, today, blockers, time]],
    },
  });

  console.log(`✅ Standup saved for ${username}`);
});

/***********************
 * Start app
 ***********************/
(async () => {
  await app.start();
  console.log('⚡ Standup Bot is running');

  // Open a DM channel with the user
  const dm = await app.client.conversations.open({
    users: YOUR_USER_ID,
  });

  // Send the standup message to the DM channel
  await app.client.chat.postMessage({
    channel: dm.channel.id,
    text: '🧍 Daily Standup',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🧍 Daily Standup*\nClick below to submit your standup',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Fill Standup' },
            style: 'primary',
            action_id: 'open_standup_modal',
          },
        ],
      },
    ],
  });
})();

// Send standup every 2 minutes (for testing)
cron.schedule(
  '*/2 * * * *',
  //'0 9 * * 1-5',

  async () => {
    console.log('⏰ Sending daily standups');

    for (const userId of TEAM_MEMBERS) {
      const messageInfo = await sendStandupDM(userId);
standupMessageMap.set(userId, messageInfo);
    }
  },
  {
    timezone: 'Asia/Kolkata',
  }
);
