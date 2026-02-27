const express = require('express');
const path = require('path');
const fs = require('fs');

// 修复 Windows 上传路径问题（Zeabur upload-codebase 在 Windows 会用反斜杠打包）
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  const rootFiles = fs.readdirSync(__dirname);
  for (const f of rootFiles) {
    if (f.startsWith('public\\') || f.startsWith('public/')) {
      const newName = f.replace(/^public[\\/]/, '');
      fs.renameSync(path.join(__dirname, f), path.join(publicDir, newName));
    }
  }
}
// 同样修复 api/ 目录
const apiDir = path.join(__dirname, 'api');
if (!fs.existsSync(apiDir)) {
  fs.mkdirSync(apiDir, { recursive: true });
  const rootFiles = fs.readdirSync(__dirname);
  for (const f of rootFiles) {
    if (f.startsWith('api\\') || f.startsWith('api/')) {
      const newName = f.replace(/^api[\\/]/, '');
      fs.renameSync(path.join(__dirname, f), path.join(apiDir, newName));
    }
  }
}

// 读取 .env 文件（不依赖 dotenv 包）
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 简单限流：每 IP 每分钟 5 次
const rateLimit = {};
function checkRate(ip) {
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < 60000);
  if (rateLimit[ip].length >= 5) return false;
  rateLimit[ip].push(now);
  return true;
}

// 从 AI 返回的文本中提取 JSON
function extractJSON(text) {
  // 去掉 markdown 代码块标记
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // 找到第一个 { 和最后一个 }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

// 验证 JSON 结构是否包含必要字段
function validateResult(obj) {
  if (!obj.valueProposition || typeof obj.valueProposition !== 'string') return false;
  if (!Array.isArray(obj.sellingPoints) || obj.sellingPoints.length < 1) return false;
  if (!obj.targetUser || typeof obj.targetUser !== 'string') return false;
  if (!obj.elevatorPitch || typeof obj.elevatorPitch !== 'string') return false;
  if (!obj.wechatCopy || typeof obj.wechatCopy !== 'string') return false;
  return true;
}

// 调用 AI API 一次
async function callAI(description, apiKey, apiBase, model) {
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
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI returned empty content');
  }

  console.log('[AI raw response]', content.slice(0, 200) + '...');

  const parsed = extractJSON(content);
  if (!validateResult(parsed)) {
    throw new Error('JSON structure invalid: missing required fields');
  }

  return parsed;
}

// API 路由
app.post('/api/generate', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRate(ip)) {
    return res.status(429).json({ error: '请求太频繁，请稍后再试' });
  }

  const { description } = req.body;
  if (!description || description.trim().length === 0) {
    return res.status(400).json({ error: '请输入产品描述' });
  }
  if (description.length > 500) {
    return res.status(400).json({ error: '产品描述不能超过500字' });
  }

  const apiKey = process.env.AI_API_KEY;
  const apiBase = process.env.AI_API_BASE || 'https://api.siliconflow.cn/v1';
  const model = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3';

  if (!apiKey) {
    return res.status(500).json({ error: '服务配置错误，请联系管理员' });
  }

  // 最多重试 2 次（共 3 次机会）
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Attempt ${attempt}] Generating for: "${description.trim().slice(0, 50)}..."`);
      const result = await callAI(description, apiKey, apiBase, model);
      console.log(`[Attempt ${attempt}] Success!`);
      return res.json({ result });
    } catch (err) {
      lastError = err;
      console.error(`[Attempt ${attempt}] Failed:`, err.message);
      if (attempt < 3) {
        console.log(`[Attempt ${attempt}] Retrying...`);
      }
    }
  }

  // 3 次都失败
  console.error('[Final] All attempts failed:', lastError.message);
  res.status(502).json({ error: 'AI 生成失败，请稍后重试' });
});

app.listen(PORT, () => {
  console.log(`卖点提炼器已启动: http://localhost:${PORT}`);
  console.log(`API Key: ${process.env.AI_API_KEY?.slice(0, 10)}...`);
  console.log(`Model: ${process.env.AI_MODEL}`);
});
