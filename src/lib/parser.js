/**
 * Parses Sybill meeting messages from Slack export JSON files.
 */

function isSybillMessage(msg) {
  return (
    msg.blocks &&
    Array.isArray(msg.blocks) &&
    msg.blocks.some((b) => b.block_id && b.block_id.startsWith('outcome$$'))
  );
}

function extractTitle(blocks) {
  const block = blocks.find(
    (b) => b.block_id && b.block_id.startsWith('title$$')
  );
  if (!block || !block.text || !block.text.text) return '';

  const raw = block.text.text;
  // Pattern: *<url|Meeting Title (65 min)> - Magic Summary (powered by Sybill)*
  const linkMatch = raw.match(/\|([^>]+)>/);
  if (!linkMatch) return raw;

  let title = linkMatch[1];
  // Strip duration like "(65 min)"
  title = title.replace(/\s*\(\d+\s*min\)\s*$/, '');
  // Strip " - Magic Summary..." suffix
  title = title.replace(/\s*-\s*Magic Summary.*$/, '');
  return title.trim();
}

function extractOutcome(blocks) {
  const block = blocks.find(
    (b) => b.block_id && b.block_id.startsWith('outcome$$')
  );
  if (!block || !block.text || !block.text.text) return '';

  let text = block.text.text;
  // Strip "*Outcome*\n" or "*Outcome* (Type)\n"
  text = text.replace(/^\*Outcome\*(?:\s*\([^)]*\))?\s*\n?/, '');
  return text.trim();
}

function extractActionItems(blocks) {
  const block = blocks.find(
    (b) => b.block_id && b.block_id.startsWith('action_items$$')
  );
  if (!block) return '';

  // a) Standard: text field with bullet points
  if (block.text && block.text.text) {
    let text = block.text.text;
    text = text.replace(/^\*Action Items\*\s*\n?/, '');
    return text.trim();
  }

  // b) Checkbox accessory format: options array with text.text
  if (block.accessory && block.accessory.type === 'checkboxes' && block.accessory.options) {
    return block.accessory.options
      .map((opt) => opt.text && opt.text.text ? opt.text.text : '')
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractAttendees(blocks) {
  const block = blocks.find(
    (b) => b.block_id && b.block_id.startsWith('attendees$$')
  );
  if (!block) return '';

  // Context block — elements array with plain_text
  if (block.elements && Array.isArray(block.elements)) {
    const el = block.elements.find((e) => e.type === 'plain_text' || e.text);
    if (el) {
      let text = typeof el === 'string' ? el : el.text || '';
      text = text.replace(/^Attendees:\s*/, '');
      return text.trim();
    }
  }

  return '';
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function tsToDate(ts) {
  const seconds = parseFloat(ts);
  const d = new Date(seconds * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseSybillMessages(jsonArray) {
  return jsonArray.filter(isSybillMessage).map((msg) => ({
    date: tsToDate(msg.ts),
    title: decodeHtmlEntities(extractTitle(msg.blocks)),
    summary: decodeHtmlEntities(extractOutcome(msg.blocks)),
    actionItems: decodeHtmlEntities(extractActionItems(msg.blocks)),
    attendees: decodeHtmlEntities(extractAttendees(msg.blocks)),
  }));
}
