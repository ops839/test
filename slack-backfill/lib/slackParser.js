import JSZip from 'jszip';

// Parse a slackdump v3+ export (from a ZIP file or a directly selected folder)
// into a flat list of day-buckets.
//
// Returns:
//   {
//     channels: [{ name, folderPath, dayBuckets: [...] }],
//     totalMessages: number,
//     userMap: Map<userId, displayName>,
//   }
//
// A day-bucket looks like:
//   { channelName, date: "YYYY-MM-DD", messages: [{ author, text, ts, permalink, replies }] }

const ALLOWED_SUBTYPES = new Set([null, undefined, '', 'thread_broadcast']);

function buildUserMap(usersJson) {
  const map = new Map();
  if (!Array.isArray(usersJson)) return map;
  for (const u of usersJson) {
    const id = u.id;
    if (!id) continue;
    const profile = u.profile || {};
    const display =
      profile.display_name?.trim() ||
      profile.real_name?.trim() ||
      u.real_name?.trim() ||
      u.name ||
      id;
    map.set(id, display);
  }
  return map;
}

// Strip Slack formatting tokens we don't want to preserve raw.
// Resolves <@UID> -> @display, <#CID|name> -> #name, <url|label> -> label.
function resolveFormatting(text, userMap) {
  if (!text) return '';
  return text
    .replace(/<@([UW][A-Z0-9]+)(\|[^>]+)?>/g, (_, uid) => {
      const name = userMap.get(uid);
      return name ? `@${name}` : `@${uid}`;
    })
    .replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, (_, name) => `#${name}`)
    .replace(/<#[CG][A-Z0-9]+>/g, '#channel')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url, label) => `${label} (${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, (_, name) => `@${name}`)
    .replace(/<!channel>/g, '@channel')
    .replace(/<!here>/g, '@here')
    .replace(/<!everyone>/g, '@everyone');
}

function tsToDate(ts) {
  // Slack ts is like "1714325512.000123" — UTC seconds. Use UTC date.
  const seconds = parseFloat(ts);
  if (!Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dateKey(d) {
  // YYYY-MM-DD in UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStr(d) {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mn = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${mn}`;
}

function permalinkFor(workspaceUrl, channelId, ts) {
  if (!workspaceUrl || !channelId || !ts) return null;
  const tsClean = String(ts).replace('.', '');
  const base = workspaceUrl.replace(/\/$/, '');
  return `${base}/archives/${channelId}/p${tsClean}`;
}

function isAllowedMessage(msg) {
  if (msg.type && msg.type !== 'message') return false;
  const sub = msg.subtype;
  if (!ALLOWED_SUBTYPES.has(sub)) return false;
  if (msg.bot_id && !msg.user) return false;
  return true;
}

function buildMessageRecord(msg, userMap, channelId, workspaceUrl) {
  const d = tsToDate(msg.ts);
  if (!d) return null;
  const author = userMap.get(msg.user) || msg.username || msg.user || 'unknown';
  return {
    author,
    text: resolveFormatting(msg.text, userMap),
    ts: msg.ts,
    date: dateKey(d),
    time: timeStr(d),
    permalink: permalinkFor(workspaceUrl, channelId, msg.ts),
    threadTs: msg.thread_ts || null,
    isParent: msg.thread_ts === msg.ts || (!msg.thread_ts && (msg.reply_count > 0 || msg.replies)),
    replies: [],
  };
}

// ─── Source abstractions ───────────────────────────────────────────
//
// A Source exposes:
//   listJsonPaths(): string[]   — relative paths of all .json files
//   readJson(path): Promise<any> — parsed JSON for that path

class ZipSource {
  constructor(zip) {
    this.zip = zip;
    this.paths = [];
    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      if (!relativePath.endsWith('.json')) return;
      this.paths.push(relativePath);
    });
  }
  listJsonPaths() {
    return this.paths;
  }
  async readJson(path) {
    const entry = this.zip.file(path);
    if (!entry) throw new Error(`Path not found in ZIP: ${path}`);
    return JSON.parse(await entry.async('string'));
  }
}

class FolderSource {
  constructor(fileList) {
    this.fileMap = new Map();
    for (const file of fileList) {
      const path = file.webkitRelativePath || file.name;
      if (!path.endsWith('.json')) continue;
      this.fileMap.set(path, file);
    }
  }
  listJsonPaths() {
    return [...this.fileMap.keys()];
  }
  async readJson(path) {
    const file = this.fileMap.get(path);
    if (!file) throw new Error(`Path not found in folder: ${path}`);
    return JSON.parse(await file.text());
  }
}

// Slackdump v3+ writes each channel as a folder with daily JSON files
// named YYYY-MM-DD.json. Threads can be inline (parent.replies array of
// full message objects) or in a sibling threads/ folder. We look for both.
async function readChannelMessages(source, channelFolder, userMap, channelId, workspaceUrl) {
  const allMessages = [];
  const threadsByParentTs = new Map();

  const filePaths = source
    .listJsonPaths()
    .filter((p) => p.startsWith(channelFolder + '/'));

  for (const relativePath of filePaths) {
    const fileName = relativePath.slice(channelFolder.length + 1);
    const isThreadFile = fileName.startsWith('threads/') || fileName.includes('/threads/');
    let payload;
    try {
      payload = await source.readJson(relativePath);
    } catch {
      continue;
    }
    const messages = Array.isArray(payload) ? payload : payload.messages || [];

    if (isThreadFile) {
      for (const m of messages) {
        const parentTs = m.thread_ts || m.parent_user_id || null;
        if (!parentTs) continue;
        if (!threadsByParentTs.has(parentTs)) threadsByParentTs.set(parentTs, []);
        threadsByParentTs.get(parentTs).push(m);
      }
      continue;
    }

    for (const m of messages) {
      if (!isAllowedMessage(m)) continue;
      allMessages.push(m);

      // Inline replies (slackdump sometimes embeds them directly)
      if (Array.isArray(m.replies_full) && m.replies_full.length) {
        threadsByParentTs.set(m.ts, [...(threadsByParentTs.get(m.ts) || []), ...m.replies_full]);
      } else if (Array.isArray(m.replies) && m.replies.length && typeof m.replies[0] === 'object' && m.replies[0].text) {
        threadsByParentTs.set(m.ts, [...(threadsByParentTs.get(m.ts) || []), ...m.replies]);
      }
    }
  }

  // Build records; attach replies to parents
  const records = [];
  const recordByTs = new Map();
  for (const m of allMessages) {
    const r = buildMessageRecord(m, userMap, channelId, workspaceUrl);
    if (!r) continue;
    records.push(r);
    recordByTs.set(r.ts, r);
  }

  for (const [parentTs, replyMsgs] of threadsByParentTs.entries()) {
    const parent = recordByTs.get(parentTs);
    if (!parent) continue;
    for (const reply of replyMsgs) {
      if (!isAllowedMessage(reply)) continue;
      if (reply.ts === parentTs) continue; // skip self
      const r = buildMessageRecord(reply, userMap, channelId, workspaceUrl);
      if (!r) continue;
      parent.replies.push(r);
    }
    parent.replies.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  }

  // Filter top-level: drop replies that aren't parents (they belong inside parent.replies)
  const topLevel = records.filter((r) => !r.threadTs || r.threadTs === r.ts);

  return topLevel;
}

function groupByDay(messages, channelName) {
  const buckets = new Map();
  for (const m of messages) {
    if (!buckets.has(m.date)) {
      buckets.set(m.date, { channelName, date: m.date, messages: [] });
    }
    buckets.get(m.date).messages.push(m);
  }
  for (const b of buckets.values()) {
    b.messages.sort((a, b2) => parseFloat(a.ts) - parseFloat(b2.ts));
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function parseFromSource(source) {
  const allPaths = source.listJsonPaths();

  // Locate users.json and channels.json (may be nested under a top folder)
  let usersPath = null;
  let channelsPath = null;
  let rootPrefix = '';

  for (const path of allPaths) {
    const base = path.split('/').pop();
    if (base === 'users.json' && (!usersPath || path.length < usersPath.length)) {
      usersPath = path;
      rootPrefix = path.slice(0, path.length - 'users.json'.length);
    }
    if (base === 'channels.json' && !channelsPath) {
      channelsPath = path;
    }
  }

  if (!usersPath) {
    throw new Error('users.json not found — is this a slackdump export?');
  }

  const usersJson = await source.readJson(usersPath);
  const userMap = buildUserMap(usersJson);

  let channelsJson = [];
  if (channelsPath) {
    try {
      channelsJson = await source.readJson(channelsPath);
    } catch {
      channelsJson = [];
    }
  }
  const channelMetaByName = new Map();
  for (const c of channelsJson) {
    if (c.name) channelMetaByName.set(c.name, c);
  }

  // Discover channel folders: any direct folder under rootPrefix that
  // contains a YYYY-MM-DD.json file. Files at the root level (no parent
  // folder beneath rootPrefix) are skipped — we need a folder name to use
  // as the channel name.
  const channelFolders = new Set();
  for (const path of allPaths) {
    if (!path.startsWith(rootPrefix)) continue;
    const rel = path.slice(rootPrefix.length);
    const parts = rel.split('/');
    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1];
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(fileName)) continue;
    const folderPath = rootPrefix + parts[0];
    channelFolders.add(folderPath);
  }

  const workspaceUrl = null;

  const channels = [];
  let totalMessages = 0;

  for (const folderPath of [...channelFolders].sort()) {
    const folderName = folderPath.split('/').pop();
    const channelMeta = channelMetaByName.get(folderName) || null;
    const channelId = channelMeta?.id || null;
    const channelName = channelMeta?.name || folderName;

    const messages = await readChannelMessages(source, folderPath, userMap, channelId, workspaceUrl);
    const dayBuckets = groupByDay(messages, channelName);
    const msgCount = messages.reduce((n, m) => n + 1 + m.replies.length, 0);
    totalMessages += msgCount;
    channels.push({ name: channelName, folderPath, dayBuckets, messageCount: msgCount });
  }

  return { channels, totalMessages, userMap };
}

export async function parseSlackdumpZip(file) {
  const zip = await JSZip.loadAsync(file);
  return parseFromSource(new ZipSource(zip));
}

export async function parseSlackdumpFolder(fileList) {
  return parseFromSource(new FolderSource(fileList));
}

// Format a day-bucket's messages into the column-G text block.
export function formatThreadBlock(bucket) {
  const blocks = [];
  for (const m of bucket.messages) {
    const lines = [];
    const head = `[${m.time}] <${m.author}>: ${m.text || ''}`.trim();
    lines.push(head);
    if (m.permalink) lines.push(m.permalink);
    for (const r of m.replies) {
      lines.push(`└ [${r.time}] <${r.author}>: ${r.text || ''}`.trim());
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

// Build the user prompt sent to Claude for one day-bucket.
export function buildPrompt(bucket) {
  const lines = [];
  lines.push(`Channel: #${bucket.channelName}`);
  lines.push(`Date: ${bucket.date}`);
  lines.push('');
  lines.push('Messages:');
  for (const m of bucket.messages) {
    lines.push(`[${m.time}] ${m.author}: ${m.text || ''}`);
    for (const r of m.replies) {
      lines.push(`    [${r.time}] ${r.author}: ${r.text || ''}`);
    }
  }
  return lines.join('\n');
}
