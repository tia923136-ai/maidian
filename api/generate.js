// Vercel Serverless Function

function extractJSON(text) {
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object found');
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

function validateResult(obj) {
  return obj.valueProposition && obj.sellingPoints?.length >= 1
    && obj.targetUser && obj.elevatorPitch && obj.wechatCopy;
}

async function callAI(description) {
  const apiKey = process.env.AI_API_KEY;
  const apiBase = process.env.AI_API_BASE || 'https://api.siliconflow.cn/v1';
  const model = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3';

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `你是一位产品卖点提炼专家。你的任务是：根据用户提供的【产品描述】，提炼该产品的营销卖点。

重要规则：
- 你必须严格围绕用户描述的产品来提炼，不要编造或替换成其他产品
- 只输出 JSON，不要输出任何其他文字、标题、解释、markdown标记
- 确保 JSON 格式正确，可以被直接解析`
        },
        {
          role: 'user',
          content: `我的产品是：${description.trim()}

请为【这个产品】提炼以下内容，直接输出JSON（不要代码块标记）：
{
  "valueProposition": "一句话价值主张，不超过30字",
  "sellingPoints": [
    {"title": "卖点标题1(4-6字)", "description": "一句话解释(不超过30字)"},
    {"title": "卖点标题2(4-6字)", "description": "一句话解释(不超过30字)"},
    {"title": "卖点标题3(4-6字)", "description": "一句话解释(不超过30字)"}
  ],
  "targetUser": "目标用户画像，2-3句话",
  "elevatorPitch": "30秒电梯演讲稿，100-150字，口语化，像跟朋友聊天",
  "wechatCopy": "一条朋友圈文案，有吸引力，让人想评论"
}`
        }
      ],
      temperature: 0.4,
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response');

  const parsed = extractJSON(content);
  if (!validateResult(parsed)) throw new Error('Invalid structure');
  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { description } = req.body || {};
  if (!description?.trim()) {
    return res.status(400).json({ error: '请输入产品描述' });
  }
  if (description.length > 500) {
    return res.status(400).json({ error: '产品描述不能超过500字' });
  }
  if (!process.env.AI_API_KEY) {
    return res.status(500).json({ error: '服务配置错误' });
  }

  // 最多重试 3 次
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await callAI(description);
      return res.status(200).json({ result });
    } catch (err) {
      lastError = err;
    }
  }

  res.status(502).json({ error: 'AI 生成失败，请稍后重试' });
}
