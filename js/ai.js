// Claude API 호출: (1) 모델명으로 정보 찾기  (2) 매장에서 찍은 옷과 집 옷 비교
export const MODELS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

async function ask({ key, model, content, tools, maxTokens = 2000, signal }) {
  if (!key) throw new Error('NO_KEY');
  const messages = [{ role: 'user', content }];
  const body = { model: model || MODELS.sonnet, max_tokens: maxTokens, messages };
  if (tools) body.tools = tools;
  let data;
  for (let turn = 0; turn < 3; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data?.error?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
    if (data.stop_reason !== 'pause_turn') break;
    body.messages = [...messages, { role: 'assistant', content: data.content }];
  }
  return data.content || [];
}

function extractJson(blocks) {
  let last = -1;
  blocks.forEach((b, i) => { if (b.type === 'web_search_tool_result') last = i; });
  const text = blocks.slice(last + 1).filter(b => b.type === 'text').map(b => b.text).join('\n')
    || blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[1]);
}

/** 모델명 → 브랜드·색상·소재·종류·출시가. 찾은 근거가 없으면 null. 저장하지 않고 제안만 합니다. */
export async function lookupModel({ key, model, brand, modelName, category, categories, signal }) {
  const text = `You help a couple catalogue clothes and accessories in their home wardrobe app.
Look up this exact product with web search and report the facts the owner can copy into the item card.

Brand (may be blank): ${brand || '(unknown)'}
Model name / product code: ${modelName}
Category the owner chose (may be blank): ${category || '(unknown)'}

ACCURACY RULE — a blank is better than a guess:
- Only fill a field when an official brand page or a reputable retailer you found states it for THIS product.
- If several colourways exist and the model code does not pin one down, list them in "color" separated by " / ".
- Never estimate prices or materials from similar products.

Allowed "category" keys: ${JSON.stringify(categories)}.
Write "color", "material" and "summary" in Korean (keep brand/product names in their original spelling).

Reply with ONLY one JSON object in a \`\`\`json code block:
{"brand": string|null, "name": "official product name"|null, "category": one key or null, "color": string|null, "material": string|null, "releasePrice": number in KRW or null, "releasePriceText": "price as shown with currency, e.g. '$120' or '159,000원'"|null, "summary": "1-2 sentence description"|null, "sources": ["url", "..."]}`;
  const blocks = await ask({
    key, model: model || MODELS.sonnet, signal, maxTokens: 1800,
    content: [{ type: 'text', text }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
  });
  const out = extractJson(blocks);
  const cited = new Set(Array.isArray(out.sources) ? out.sources : []);
  blocks.forEach(b => (b.citations || []).forEach(c => c.url && cited.add(c.url)));
  out.sources = [...cited].filter(u => /^https?:\/\//.test(u)).slice(0, 4);
  return out;
}

/**
 * 매장에서 찍은 옷 사진 + 집에 있는 옷 미리보기 → 비슷한 옷 / 같이 입기 좋은 옷.
 * owned = [{id, label, thumb:{data,type}}]  (id는 item.id)
 */
export async function matchShopping({ key, model, photo, photoType, catLabel, owned, signal }) {
  const content = [
    { type: 'text', text: `NEW ITEM — photographed in a shop, the owner is thinking of buying it. Category: ${catLabel || 'unknown'}.` },
    { type: 'image', source: { type: 'base64', media_type: photoType || 'image/jpeg', data: photo } },
    { type: 'text', text: `Below are items the owner already has at home. Each image is preceded by its id and a short label.` },
  ];
  owned.forEach(o => {
    content.push({ type: 'text', text: `[${o.id}] ${o.label}` });
    if (o.thumb) content.push({ type: 'image', source: { type: 'base64', media_type: o.thumb.type || 'image/jpeg', data: o.thumb.data } });
  });
  content.push({ type: 'text', text: `Help the owner decide in the shop. Answer in Korean, short and practical.
1. "similar": items at home that are close to the new item (same category and similar colour/shape/style) — the owner may not need another one. Only include real look-alikes.
2. "pairs": items at home from OTHER categories that would look good worn with the new item (up to 5), each with a one-line styling reason.
3. "verdict": 1-2 sentences, e.g. "비슷한 네이비 자켓이 이미 2벌 있어요" or "집에 없는 색이라 새로 사도 겹치지 않아요".
Use only ids from the list. Judge colours cautiously — shop lighting and home photos differ, so say "비슷해 보여요" rather than claiming an exact match.

Reply with ONLY one JSON object in a \`\`\`json code block:
{"similar": [{"id": "...", "reason": "..."}], "pairs": [{"id": "...", "reason": "..."}], "verdict": "..."}` });
  const blocks = await ask({ key, model: model || MODELS.sonnet, content, maxTokens: 1500, signal });
  const out = extractJson(blocks);
  const ids = new Set(owned.map(o => String(o.id)));
  const clean = a => (Array.isArray(a) ? a : []).filter(x => x && ids.has(String(x.id)));
  return { similar: clean(out.similar), pairs: clean(out.pairs), verdict: out.verdict || '' };
}
